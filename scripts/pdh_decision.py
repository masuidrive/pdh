"""Build and verify one ticket's independent acceptance review."""
import hashlib
import json
import os
import re
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile

from pdh_judge_api import (EFFORT, INSTRUCTIONS, MODEL, VERDICT_SCHEMA,
                           judge, packet_instructions, validate, verdict_schema)

RECEIPT = "decision.json"
LIMITS = "docs/known-limits.md"
MAX_PACKET = 900_000
COVERAGE_MATRIX = "tests/coverage.tsv"
COVERAGE_RESULTS = "coverage-results.json"


def encode(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2)


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_rows(path):
    if not path.exists():
        return []
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        raise ValueError("検収記録が空か不正です")
    required = {"model", "agreement", "candidate", "scope_sha256", "input_sha256",
                "request_sha256", "followup", "result", "receipt_sha256"}
    for row in rows:
        if not isinstance(row, dict) or row.keys() not in (required, required | {"backend", "effort"},
                                                          required | {"backend", "effort", "criterion_id"}):
            raise ValueError("検収記録の項目が不正です")
        if any(not isinstance(row[key], str) or not re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", row[key])
               for key in ("agreement", "candidate")) or type(row["followup"]) is not bool:
            raise ValueError("判定対象の commit SHA が不正です")
        if digest(encode({k: v for k, v in row.items() if k != "receipt_sha256"})) != row["receipt_sha256"]:
            raise ValueError("検収記録が保存時と一致しません")
        if "backend" in row and (row["backend"] not in ("codex", "responses", "claude") or row["effort"] != EFFORT):
            raise ValueError("検収記録の実行方式または effort が不正です")
        validate(row["result"])
    return rows


def committed_materials(root, work, head, git, coverage=False):
    # Only committed materials can substantiate the recorded observations.
    materials = ["product-brief.md", f"{work}/scope.md", f"{work}/evidence.md",
                 f"{work}/checklist.md", f"{work}/suite-pass", LIMITS]
    if coverage:
        materials.extend((f"{work}/{COVERAGE_MATRIX}", f"{work}/{COVERAGE_RESULTS}"))
    for name in materials:
        current = root / name
        entry = git("ls-tree", head, "--", name)
        if not entry and name == LIMITS and not current.exists():
            continue
        if (not entry.startswith((b"100644 blob ", b"100755 blob ")) or current.is_symlink()
                or current.read_bytes() != git("show", f"{head}:{name}")
                or git("diff", "--cached", head, "--", name)):
            raise ValueError(f"{name} を commit してから検収してください")

    return materials


def committed_receipts(git, work, agreed, head, rows):
    name = f"{work}/{RECEIPT}"
    history = git("log", "--first-parent", "--reverse", "--format=%H", f"{agreed}..{head}", "--", name)
    count = 0
    for revision in history.decode().splitlines():
        if not git("ls-tree", revision, "--", name):
            raise ValueError("commit 済みの検収記録が削除されています")
        saved = json.loads(git("show", f"{revision}:{name}"))
        if not isinstance(saved, list) or len(saved) < count or rows[:len(saved)] != saved:
            raise ValueError("commit 済みの検収記録が変更されています")
        count = len(saved)
    return count


def make_packet(git, changed, work, agreed, agreement, candidate, materials):
    contents = {name: git("show", f"{candidate}:{name}").decode() for name in materials
                if git("ls-tree", candidate, "--", name)}
    # Keep other tickets and their records out of the transmitted evidence.
    paths = [p for p in sorted(changed(agreed, candidate))
             if (not p.startswith(("tickets/", "work/")) or p.startswith(f"{work}/tests/"))
             and p not in materials]
    patch = git("diff", "--no-ext-diff", "--no-textconv", "--no-renames", agreed, candidate, "--", *paths) if paths else b""
    history = git("log", "--no-decorate", "--format=%H %s", f"{agreed}..{candidate}", "--",
                  *paths, *materials)
    payload = {"ticket": work, "initial_agreement": agreed, "agreement": agreement,
               "candidate": candidate, "materials": contents, "history": history.decode(),
               "diff": patch.decode(errors="replace")}
    if f"{work}/{COVERAGE_RESULTS}" in contents:
        from pdh_coverage import read_source

        results = json.loads(contents[f"{work}/{COVERAGE_RESULTS}"])
        source_paths = {path for row in results["rows"] if row["mode"] == "auto"
                        for path in row["sources"]}
        sources = {}
        remaining = MAX_PACKET
        for path in sorted(source_paths):
            source = read_source(git, candidate, path, work)
            remaining -= len(source.encode("utf-8"))
            if remaining < 0:
                raise ValueError("判定資料が送信上限を超えました。独立検収を保留して人に戻してください")
            sources[path] = source
        payload["coverage_test_sources"] = sources
    if agreed != agreement:
        initial_scope = f"{work}/scope.md"
        if not git("ls-tree", agreed, "--", initial_scope):
            initial_scope = "work/" + work.split("/")[-1] + "/scope.md"
        progress = git("show", f"{candidate}:{work}/progress.md").decode()
        payload["original_scope"] = git("show", f"{agreed}:{initial_scope}").decode()
        payload["original_brief"] = git("show", f"{agreed}:product-brief.md").decode()
        payload["scope_changes"] = [line for line in progress.splitlines() if line.startswith("- 再合意 | ")]
    return payload


def observations(evidence, criterion):
    # A heading, another AC, or the same observation at another revision is insufficient.
    records = []
    for line in evidence.splitlines():
        fields = line.split(" | ")
        if fields[0] == "- " + criterion or fields[0] in {"- 問題なし", "- 許容"}:
            records.append([fields[0], *fields[2:]])
    return records


def coverage_observations(results, criterion_id, read):
    observations = set()
    evidence = set()
    for row in json.loads(results)["rows"]:
        scenarios = {scenario for ac, scenario, _, _ in row["mapping"] if ac == criterion_id}
        if not scenarios:
            continue
        text = row["observation"]
        observations.update((scenario, text) for scenario in scenarios)
        check = {"mode": row["mode"], "observation": text}
        if row["mode"] == "auto":
            check.update(runner=row["runner"], junit=row["junit"],
                         sources={path: digest(read(path)) for path in row["sources"]})
        evidence.add(encode(check))
    return sorted(observations), evidence


def save_receipt(path, rows, row):
    row["receipt_sha256"] = digest(encode(row))
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
        temp_path = Path(tmp.name)
        try:
            tmp.write(encode([*rows, row]) + "\n")
            tmp.close()
            temp_path.replace(path)
        finally:
            temp_path.unlink(missing_ok=True)


def review(command, root, work, agreed, agreement, head, scope, send, git, changed, check_stable,
           backend=None, *, coverage=False):
    directory = root / work
    path = directory / RECEIPT
    materials = committed_materials(root, work, head, git, coverage)
    rows = load_rows(path)
    committed = committed_receipts(git, work, agreed, head, rows)
    last = rows[-1] if rows else None
    # Human approval and the receipt commit can follow the reviewed candidate.
    candidate = head
    if last and last["agreement"] == agreement:
        old = last["candidate"]
        if git("merge-base", old, head).decode().strip() != old:
            raise ValueError("判定対象版が現在の履歴にありません")
        if not changed(old, head) - {f"{work}/{RECEIPT}", f"{work}/progress.md"}:
            candidate = old
    payload = make_packet(git, changed, work, agreed, agreement, candidate, materials)
    base_hash = digest(encode(payload))
    same = last and last["input_sha256"] == base_hash
    previous = (rows[-2] if len(rows) > 1 else None) if same else last
    followup = previous and previous["agreement"] == agreement and previous["result"]["verdict"] == "hold"
    scope_text = payload["materials"][f"{work}/scope.md"]
    ordered = [line[2:].strip() for line in scope_text.splitlines() if line.startswith("- ")]
    choices = {f"C{i}": criterion for i, criterion in enumerate(ordered, 1)}
    if followup:
        if previous["followup"]:
            prefix = f"- 独立検収再開 | {previous['receipt_sha256']} | "
            progress = git("show", f"{candidate}:{work}/progress.md").decode()
            answers = [line[len(prefix):].strip() for line in progress.splitlines() if line.startswith(prefix)]
            if len(answers) != 1 or not answers[0]:
                raise ValueError("再確認でも保留です。未解決のACと証拠を人に戻してください")
            payload["human_restart"] = answers[0]
        filename = f"{work}/evidence.md"
        criterion = previous["result"]["criterion"]
        before = observations(git("show", f"{previous['candidate']}:{filename}").decode(), criterion)
        after = observations(payload["materials"][filename], criterion)
        payload["recheck"] = {"previous_result": previous["result"], "previous_observations": before}
        coverage_changed = False
        if coverage:
            coverage_name = f"{work}/{COVERAGE_RESULTS}"
            criterion_id = next((key for key, value in choices.items() if value == criterion), None)
            from pdh_coverage import read_source

            prior_candidate = previous["candidate"]
            prior_observations, prior_evidence = [], set()
            if git("ls-tree", prior_candidate, "--", coverage_name):
                prior_observations, prior_evidence = coverage_observations(
                    git("show", f"{prior_candidate}:{coverage_name}"), criterion_id,
                    lambda name: read_source(git, prior_candidate, name, work),
                )
            _, new_evidence = coverage_observations(
                payload["materials"][coverage_name], criterion_id,
                payload["coverage_test_sources"].__getitem__,
            )
            coverage_changed = bool(new_evidence - prior_evidence)
            payload["recheck"]["previous_coverage_observations"] = prior_observations
        if after == before and not coverage_changed:
            target = f"evidence.md または {COVERAGE_RESULTS}" if coverage else "evidence.md"
            raise ValueError(f"保留されたACまたは反例確認の新しい観察を {target} に残してください")
    # Older receipts keep the exact packet and schema originally sent.
    use_ids = not same or "criterion_id" in last
    if use_ids:
        payload["criteria"] = choices
    packet = encode(payload)
    if len(packet.encode()) > MAX_PACKET:
        raise ValueError("判定資料が送信上限を超えました。独立検収を保留して人に戻してください")
    # Keep the transport fixed for this agreement, including its one allowed recheck.
    if last and last["agreement"] == agreement:
        recorded = last.get("backend", "responses")
        if backend and backend != recorded:
            raise ValueError("同じ合意の判定方式は変更できません")
        backend = recorded
    backend = backend or ("claude" if os.environ.get("CLAUDECODE") == "1" else "codex")
    if backend == "claude":
        from pdh_judge_claude import MODEL as model
    else:
        model = MODEL
    instructions = packet_instructions(packet) if use_ids else INSTRUCTIONS
    request = {"model": model, "instructions": instructions, "packet": packet}
    if not (same and "backend" not in last):
        request.update(backend=backend, effort=EFFORT, schema=verdict_schema(choices) if use_ids else VERDICT_SCHEMA)
    signature = digest(encode(request))
    if same and last["request_sha256"] != signature:
        raise ValueError("判定の指示またはモデルが変わりました。検収条件を再合意してください")

    if same and (last["result"]["criterion"] not in scope or last["model"] != model
                 or last["scope_sha256"] != digest(payload["materials"][f"{work}/scope.md"])):
        raise ValueError("検収記録のACまたはモデルが一致しません")

    if same and use_ids and choices.get(last["criterion_id"]) != last["result"]["criterion"]:
        raise ValueError("検収記録のAC番号と原文が一致しません")

    if command == "ready":
        if not same or committed != len(rows) or git("diff", "--cached", head, "--", f"{work}/{RECEIPT}"):
            raise ValueError("現在の版・証拠に対応する decision.json を生成して commit してください")
    elif send is None:
        print(packet)
        print(f"{backend} / {model} / {EFFORT}。資料を確認後、同じコマンドに --backend {backend} --send {signature} を付けて実行", file=sys.stderr)
        return
    elif send != signature:
        raise ValueError("プレビューのハッシュと送信資料が一致しません")
    elif not same:
        if backend == "codex":
            from pdh_judge_codex import judge as judge_codex
            result = validate(judge_codex(packet, choices))
        elif backend == "claude":
            from pdh_judge_claude import judge as judge_claude
            result = validate(judge_claude(packet, choices))
        else:
            result = validate(judge(packet, choices))
        if result["criterion"] not in scope:
            raise ValueError("判定が参照したACが scope.md の原文と一致しません")
        check_stable()
        committed_materials(root, work, head, git, coverage)
        if load_rows(path) != rows:
            raise ValueError("実行中に検収記録が変わりました")
        row = {"model": model, "effort": EFFORT, "backend": backend, "agreement": agreement, "candidate": candidate,
               "scope_sha256": digest(payload["materials"][f"{work}/scope.md"]), "input_sha256": base_hash,
               "request_sha256": signature, "followup": bool(followup), "result": result}
        row["criterion_id"] = next(k for k, v in choices.items() if v == result["criterion"])
        save_receipt(path, rows, row)
        last = row
    result = last["result"]
    if result["verdict"] == "hold":
        handback = " 再確認でも保留のため人に戻してください。" if last["followup"] else ""
        raise ValueError(f"hold — {result['criterion']} — {result['reason']} — {result['next']}{handback}")
    print(f"present — {result['criterion']} — {result['reason']} — {result['next']}")
