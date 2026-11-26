#!/usr/bin/env python3
"""Run the full suite and check recorded evidence against the current source."""

import argparse
import fcntl
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from tempfile import NamedTemporaryFile


class GateError(Exception):
    pass


ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})")
# Older approvals retain the record format in use when they were committed.
REAGREEMENT_FORMAT = ("変更を提案する根拠", "維持案の得失", "変更案の得失", "人の明示回答")
SCRIPTS = "pdh/scripts"
CHECKS = "pdh/checks"
PROSE = f"{SCRIPTS}/pdh-prose.txt"
BRIEF = "product-brief.md"
TICKET_NAME_EXCEPTIONS = "tickets/ignore.md"
RECORDS = ("scope.md", "evidence.md", "checklist.md", "suite-pass", "progress.md", "decision.json", "coverage-results.json")


def git(*args):
    result = subprocess.run(
        ["git", "--literal-pathspecs", *args], cwd=ROOT, capture_output=True, check=False
    )
    if result.returncode:
        raise GateError(result.stderr.decode(errors="replace").strip() or f"git {args[0]} failed")
    return result.stdout


def tracked_at(revision, *paths):
    # Tracked capabilities stay in force regardless of where PDH lived at agreement.
    # If both locations exist, use the current namespace for the source.
    for path in paths:
        if git("ls-tree", "--name-only", revision, "--", path):
            return path
    return None


def ancestor(older, newer):
    if not SHA.fullmatch(older):
        raise GateError(f"expected a full commit SHA, got {older!r}")
    if git("rev-parse", "--verify", f"{older}^{{commit}}").decode().strip() != older:
        raise GateError(f"{older} does not identify a full commit SHA")
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", older, newer], cwd=ROOT, check=False
    )
    if result.returncode:
        raise GateError(f"{older} is not an ancestor of {newer}")


def repo_path(value):
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value or value == "." or ".." in path.parts:
        raise GateError(f"expected a canonical repository-relative path, got {value!r}")
    return path


def lines(path, *, headings=False):
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        if re.match(r"^#{1,6} ", line):
            if headings:
                yield number, line
            continue
        if not line.startswith("- ") or not line[2:].strip():
            raise GateError(f"{path.relative_to(ROOT)}:{number}: expected a nonempty '- ' entry")
        yield number, line


def read_scope(path):
    criteria = [line[2:].strip() for _, line in lines(path)]
    if not criteria:
        raise GateError(f"{path.relative_to(ROOT)}: expected at least one criterion")
    if len(set(criteria)) != len(criteria) or any(" | " in item for item in criteria):
        raise GateError(f"{path.relative_to(ROOT)}: duplicate criterion or reserved ' | ' separator")
    return set(criteria)


def changed_paths(*range_args):
    output = git("diff", "--no-renames", "--name-only", "-z", *range_args, "--")
    return {os.fsdecode(path) for path in output.split(b"\0") if path}


def exclusions(work, head):
    result = {f"{work}/{name}" for name in RECORDS}
    ticket_tests = ticket_tests_prefix(work)
    if not git("ls-tree", "--name-only", head, "--", PROSE):
        return result
    for raw in git("show", f"{head}:{PROSE}").decode("utf-8").splitlines():
        if not raw.strip() or raw.startswith("#"):
            continue
        path = repo_path(raw)
        if path.suffix == ".md" and raw not in {BRIEF, TICKET_NAME_EXCEPTIONS}:
            if not ticket_tests or not raw.startswith(ticket_tests):
                result.add(raw)
        else:
            raise GateError(f"{PROSE}: cannot exclude {path}")
    return result


def require_no_changes(paths, allowed, context):
    unexpected = sorted(paths - allowed)
    if unexpected:
        raise GateError(f"{context}: {', '.join(repr(path) for path in unexpected)}")


def revised_agreement(work, agreed, head):
    progress = f"{work}/progress.md"
    if not git("ls-tree", "--name-only", head, "--", progress):
        return agreed
    revision = agreed
    for number, line in enumerate(git("show", f"{head}:{progress}").decode("utf-8").splitlines(), 1):
        if not re.match(r"^-\s+再合意(?:\s*\||\s*$)", line):
            continue
        fields = [field.strip() for field in line.split(" | ")]
        legacy = False
        if len(fields) == 4:
            recorded = git("blame", "--porcelain", "-L", f"{number},{number}", head, "--", progress)
            approval_commit = recorded.split(maxsplit=1)[0].decode("ascii")
            gate_path = tracked_at(approval_commit, f"{SCRIPTS}/pdh.py", "scripts/pdh.py")
            if gate_path:
                previous_gate = git("show", f"{approval_commit}:{gate_path}")
                legacy = b"\nREAGREEMENT_FORMAT = " not in previous_gate
        if ((len(fields) != 3 + len(REAGREEMENT_FORMAT) and not legacy) or not all(fields) or fields[0] != "- 再合意"
                or fields[1] != agreed or fields[2] == revision):
            raise GateError(f"{progress}:{number}: expected 再合意 | {agreed} | revised SHA | "
                            + " | ".join(REAGREEMENT_FORMAT))
        ancestor(fields[2], head)
        ancestor(revision, fields[2])
        revision = fields[2]
    return revision


def scope_at_agreement(work, revision):
    path = f"{work}/scope.md"
    parts = PurePosixPath(work).parts
    if len(parts) == 2 and parts[0] == "tickets":
        # A ticket moved after agreement keeps the scope pinned to that revision.
        if not git("ls-tree", "--name-only", revision, "--", path):
            path = f"work/{parts[1]}/scope.md"
    return git("show", f"{revision}:{path}")


def ticket_tests_prefix(work):
    parts = PurePosixPath(work).parts
    if len(parts) == 2 and parts[0] == "tickets":
        return f"{work}/tests/"
    return None


def coverage_required(work, agreed, head):
    locations = [f"{work}/tests/coverage.tsv"]
    if work.startswith("tickets/"):
        locations.append(f"work/{Path(work).name}/tests/coverage.tsv")
    agreed_check = tracked_at(agreed, f"{CHECKS}/verify-coverage.sh",
                              "scripts/pdh-checks/verify-coverage.sh")
    return bool(agreed_check or git("log", "-1", "--format=%H", head, "--", *locations))


def run_ticket_checks(work, agreed, head, command):
    environment = {**os.environ, "PDH_PHASE": "ready" if command == "decision" else command}
    if command == "decision":
        environment.pop("OPENAI_API_KEY", None)
    checks_dir = Path(CHECKS)
    files = git("ls-tree", "-r", "--name-only", "-z", head, "--", str(checks_dir))
    coverage = command != "test" and coverage_required(work, agreed, head)
    if coverage and os.fsencode(checks_dir / "verify-coverage.sh") not in files.split(b"\0"):
        raise GateError("the agreed coverage check is missing")
    for name in sorted(path for path in files.split(b"\0") if path):
        path = Path(os.fsdecode(name))
        if path.parent != checks_dir or path.suffix != ".sh":
            continue
        if (ROOT / path).is_symlink() or not (ROOT / path).is_file():
            raise GateError(f"{path}: expected a regular check script")
        result = subprocess.run(["bash", str(path), work, agreed], cwd=ROOT, check=False,
                                stdout=sys.stderr if command == "decision" else None,
                                env=environment)
        if result.returncode != 0:
            raise GateError(f"{path}: check failed (exit {result.returncode})")
    return coverage


def check_tree(work, agreed):
    head = git("rev-parse", "HEAD").decode().strip()
    ancestor(agreed, head)
    agreement = revised_agreement(work, agreed, head)
    original = (git("show", f"{agreed}:{BRIEF}"), scope_at_agreement(work, agreed))
    expected_files = original if agreement == agreed else (
        git("show", f"{agreement}:{BRIEF}"), scope_at_agreement(work, agreement)
    )
    for path, expected in zip((BRIEF, f"{work}/scope.md"), expected_files):
        current = git("show", f"{head}:{path}")
        if agreement == agreed and current != expected:
            raise GateError(
                f"{path} differs from the agreement at {agreed}; "
                f"{work}/progress.md has no committed re-agreement"
            )
        if (current != expected or git("show", f":{path}") != expected
                or (ROOT / path).read_bytes() != expected):
            raise GateError(f"{path} differs from the agreement at {agreement}")
    allowed = exclusions(work, head)
    untracked = git("ls-files", "--others", "--exclude-standard", "-z")
    dirty = changed_paths() | changed_paths("--cached", head)
    if git("ls-files", "--others", "--", TICKET_NAME_EXCEPTIONS):
        dirty.add(TICKET_NAME_EXCEPTIONS)
    dirty.update(os.fsdecode(path) for path in untracked.split(b"\0") if path)
    require_no_changes(dirty, allowed, "uncommitted paths must be committed before validation")
    return head, allowed, agreement


def check_revision(revision, head, allowed, agreement, *, ticket_tests=None, coverage_work=None):
    ancestor(revision, head)
    ancestor(agreement, revision)
    changed = changed_paths(revision, head)
    if coverage_work:
        allowed = coverage_exclusions(coverage_work, revision, head, allowed)
    if ticket_tests:
        changed = {path for path in changed if not path.startswith(ticket_tests)}
    require_no_changes(changed, allowed, f"validated files differ since {revision}")


def coverage_exclusions(work, revision, head, allowed):
    # Later mapping and additional ticket probes do not change an earlier measurement.
    additions = git("diff", "--no-renames", "--diff-filter=A", "--name-only", "-z",
                    revision, head, "--", f"{work}/tests/")
    return allowed | {f"{work}/tests/coverage.tsv"} | {
        os.fsdecode(path) for path in additions.split(b"\0") if path}


def check_counterexample(record, context, head, allowed, agreement, work=None):
    fields = [field.strip() for field in record.split(" | ")]
    if len(fields) != 5 or not all(fields):
        raise GateError(f"{context}: expected 判定 | SHA | 操作 | 観察結果 | 処置")
    verdict, revision, _, observation, action = fields
    if verdict in {"要修正", "約束変更", "未確認"}:
        raise GateError(f"{context}: {verdict}: {observation} / {action}")
    if verdict not in {"問題なし", "許容"}:
        raise GateError(f"{context}: unexpected verdict {verdict!r}")
    if verdict == "許容":
        details = [field.strip() for field in action.split(" / ")]
        if len(details) != 3 or not all(details):
            raise GateError(f"{context}: 許容 requires 影響 / 回避 / 再判断条件")
    check_revision(revision, head, allowed, agreement, coverage_work=work)


def check_evidence(path, scope, head, allowed, agreement, work=None):
    seen = set()
    checked = set()
    counterexample_section = False
    in_counterexample = False
    counterexample = None
    for number, line in lines(path, headings=True):
        context = f"{path.relative_to(ROOT)}:{number}"
        if line.startswith("#"):
            if re.fullmatch(r"#{1,6}\s+反例確認(?:\s+#+)?\s*", line):
                if line != "## 反例確認":
                    raise GateError(f"{context}: expected the heading ## 反例確認")
                if counterexample_section:
                    raise GateError(f"{context}: duplicate 反例確認 section")
                counterexample_section = in_counterexample = True
            elif in_counterexample:
                if line.startswith("###"):
                    raise GateError(f"{context}: unexpected heading in 反例確認 section")
                in_counterexample = False
            continue
        record = line[2:].strip()
        if in_counterexample:
            if counterexample is not None:
                raise GateError(f"{context}: expected exactly one 反例確認 entry")
            counterexample = (record, context)
            continue
        fields = [field.strip() for field in record.split(" | ", 2)]
        if len(fields) != 3 or not all(fields):
            raise GateError(f"{context}: expected criterion | SHA | evidence")
        criterion, revision, _ = fields
        if criterion not in scope or criterion in seen:
            raise GateError(f"{context}: unexpected or duplicate criterion {criterion!r}")
        if revision not in checked:
            check_revision(revision, head, allowed, agreement, coverage_work=work)
            checked.add(revision)
        seen.add(criterion)
    if scope - seen:
        raise GateError(f"{path.relative_to(ROOT)}: missing evidence for {', '.join(sorted(scope - seen))}")
    if counterexample is None:
        raise GateError(f"{path.relative_to(ROOT)}: expected a ## 反例確認 section with one entry")
    check_counterexample(*counterexample, head, allowed, agreement, work)


def run(command, work, agreed, send=None, backend=None):
    directory = ROOT / repo_path(work)
    if directory.resolve() != directory or not directory.is_dir():
        raise GateError(f"{work}: expected a repository directory without symlinks")
    for name in RECORDS:
        path = directory / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise GateError(f"{work}/{name}: expected a regular file")
    marker = directory / "suite-pass"
    lock = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise GateError(f"{work}: test or ready is already running") from error
        if command == "test":
            marker.unlink(missing_ok=True)
        head, allowed, agreement = check_tree(work, agreed)
        coverage = run_ticket_checks(work, agreed, head, command)
        scope = read_scope(directory / "scope.md")
        if command == "test":
            if subprocess.run(["bash", "scripts/test-all.sh"], cwd=ROOT, check=False).returncode:
                raise GateError(f"scripts/test-all.sh failed for {head}")
            if check_tree(work, agreed)[0] != head:
                raise GateError("HEAD changed during scripts/test-all.sh")
            with NamedTemporaryFile(dir=directory, delete=False) as output:
                temporary = Path(output.name)
                try:
                    output.write(f"{head}\n".encode())
                    output.close()
                    temporary.replace(marker)
                finally:
                    temporary.unlink(missing_ok=True)
            print(f"Suite passed for {head}. Recorded in {work}/suite-pass.")
        else:
            # Committed naming exceptions affect admission, not product observations.
            allowed = (allowed - {f"{work}/scope.md"}) | {TICKET_NAME_EXCEPTIONS}
            check_revision(marker.read_text(encoding="utf-8").strip(), head, allowed, agreement,
                           ticket_tests=ticket_tests_prefix(work))
            check_evidence(directory / "evidence.md", scope, head, allowed, agreement, work if coverage else None)
            if check_tree(work, agreed)[0] != head:
                raise GateError("HEAD changed during readiness validation")
            named_ticket = ticket_tests_prefix(work) is not None
            standard_review = named_ticket and tracked_at(agreed, f"{SCRIPTS}/pdh_judge_codex.py",
                                                          "scripts/pdh_judge_codex.py")
            selected_review = "## 独立検収" in (directory / "scope.md").read_text(encoding="utf-8").splitlines()
            if command == "decision" and not (standard_review or selected_review):
                raise GateError("以前のチケットで独立検収を使うには scope.md の再合意が必要です")
            if standard_review or selected_review:
                sys.dont_write_bytecode = True
                import pdh_decision

                def stable():
                    if check_tree(work, agreed)[0] != head:
                        raise GateError("HEAD changed during independent review")

                pdh_decision.review(command, ROOT, work, agreed, agreement, head, scope,
                                    send, git, changed_paths, stable, backend, coverage=coverage)
                if command == "decision":
                    return
                stable()
            print(f"Evidence and full suite recorded for {head} under agreement {agreement}.")
    finally:
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("test", "decision", "ready"))
    parser.add_argument("work")
    parser.add_argument("agreed")
    parser.add_argument("--send", metavar="SHA256", help="send the previewed decision packet")
    parser.add_argument("--backend", choices=("codex", "responses", "claude"), help="select the first judge transport")
    args = parser.parse_args()
    if (args.send is not None or args.backend) and args.command != "decision":
        parser.error("--send and --backend are valid only for decision")
    try:
        run(args.command, args.work, args.agreed, args.send, args.backend)
    except (GateError, OSError, ValueError, RuntimeError) as error:
        print(f"pdh: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
