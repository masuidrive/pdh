#!/usr/bin/env bash
# application-test: 再開の情報は branch から一意に選び、hook の失敗は session に伝えない。
set -euo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
python3 - "$ROOT_DIR" <<'PY'
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
env = {k: v for k, v in os.environ.items()
       if not k.startswith("GIT_") and k != "PDH_ROLE"}
env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null", GIT_TEMPLATE_DIR="",
           GIT_AUTHOR_NAME="Hook test", GIT_AUTHOR_EMAIL="test@example.invalid",
           GIT_COMMITTER_NAME="Hook test", GIT_COMMITTER_EMAIL="test@example.invalid")
checks = 0

with tempfile.TemporaryDirectory(prefix="pdh-session-test-") as tmp:
    repo = Path(tmp) / "repo with spaces"
    scripts = repo / "scripts"
    scripts.mkdir(parents=True)
    for name in ("pdh-stage-checklist.sh", "pdh-session-hook.sh"):
        shutil.copy2(root / "scripts" / name, scripts / name)
    skill = repo / ".claude/skills/pdh-implement/SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("- [ ] PDH-implement: skill からは表示しない\n")
    config = repo / ".ticket-config.yaml"
    config.write_text('branch_prefix: "work/"\n')
    note = repo / "tickets/example/note.md"
    note.parent.mkdir(parents=True)
    original = ('## Status: PDH-implement (Implementing)\n\n## Checklist\n'
                '- [ ] PDH-implement: "引用" と \\ と改行\n'
                '- [x] PDH-implement: 済んだ行\n- [-] PDH-implement: 省いた行 - skip: 理由\n'
                '- [ ] PDH-review: 別の stage\n\n## Other\n- [ ] PDH-implement: 別の節\n')
    note.write_text(original)
    (repo / "current-note.md").symlink_to(note)

    def run(*args, cwd=repo, extra=None, code=0, stdin=None):
        global checks
        result = subprocess.run(args, cwd=cwd, env={**env, **(extra or {})},
                                input=stdin, text=True, capture_output=True)
        assert result.returncode == code, (args, result.returncode, result.stdout, result.stderr)
        if str(scripts / "pdh-session-hook.sh") in args:
            assert result.stderr == "", result.stderr
        checks += 1
        return result.stdout

    def show(*args):
        return run("bash", str(scripts / "pdh-stage-checklist.sh"), "--show", *args)

    def hook(cwd=repo, extra=None):
        output = run("bash", str(scripts / "pdh-session-hook.sh"), cwd=cwd, extra=extra,
                     stdin="not even JSON\n")
        return output

    run("git", "init", "-q", "-b", "work/example")
    run("git", "add", ".")
    run("git", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
    output = show()
    assert 'ticket: example\nStatus: PDH-implement\n' in output, output
    assert 'PM が読む skill: .claude/skills/pdh-implement/SKILL.md' in output
    assert '- [ ] PDH-implement: "引用" と \\ と改行' in output
    assert all(text not in output for text in ("済んだ行", "省いた行", "別の stage", "別の節", "skill からは"))
    assert note.read_text() == original, "--show changed the note"
    decoded = json.loads(hook())["hookSpecificOutput"]
    assert decoded == {"hookEventName": "SessionStart", "additionalContext": output.rstrip("\n")}
    for role in ("pdh-coding-engineer", ""):
        assert hook(extra={"PDH_ROLE": role}) == ""
    nested = repo / "a/b"
    nested.mkdir(parents=True)
    assert json.loads(hook(cwd=nested))["hookSpecificOutput"] == decoded

    # 設定に書かれた command 自体も、下の階層から同じ情報を返す。
    for filename in (".claude/settings.json", ".codex/hooks.json"):
        entry = json.loads((root / filename).read_text())["hooks"]["SessionStart"][-1]
        assert entry["matcher"] == "startup|resume|compact"
        command = entry["hooks"][0]
        assert command["timeout"] == 5
        result = run("sh", "-c", command["command"], cwd=nested,
                     extra={"CLAUDE_PROJECT_DIR": str(repo)}, stdin="{}")
        assert json.loads(result)["hookSpecificOutput"] == decoded

    # 元 repo から読んだ codex の command は、session の worktree を選ぶ。
    worktree = Path(tmp) / "other worktree"
    run("git", "worktree", "add", "-qb", "work/other", str(worktree))
    other_note = worktree / "tickets/other/note.md"
    other_note.parent.mkdir(parents=True)
    other_note.write_text("## Status: PDH-implement\n## Checklist\n- [ ] PDH-implement: worktree の行\n")
    command = json.loads((root / ".codex/hooks.json").read_text())["hooks"]["SessionStart"][0]["hooks"][0]["command"]
    assert "worktree の行" in json.loads(run("sh", "-c", command, cwd=worktree, stdin="{}"))["hookSpecificOutput"]["additionalContext"]

    note.write_text(original.replace("PDH-implement (Implementing)", "調査中"))
    assert "Status は PDH-stage ではない: 調査中" in show()
    note.write_text(original.replace("PDH-implement (Implementing)", "PDH-unknown"))
    assert "Status は PDH-stage ではない: PDH-unknown" in show()
    note.write_text(original.replace("PDH-implement (Implementing)", "PDH-implement2"))
    assert "Status は PDH-stage ではない: PDH-implement2" in show()
    note.write_text(original + "\n")
    long_note = original.replace('"引用" と \\ と改行', "長" * 2000)
    note.write_text(long_note)
    assert len(show()) == 1500
    assert note.read_text() == long_note
    note.write_text("## Status: PDH-implement\n## Checklist\n")
    assert "未了の行:\n（無し）" in show()
    note.write_text(original)

    unresolved = "PDH の ticket は未確定（この worktree の branch に対応する note が無い）\n"
    run("git", "checkout", "-qb", "work/missing")
    assert show() == unresolved
    assert show(str(note)) == output, "explicit note must not depend on branch"
    run("git", "checkout", "--detach", "-q")
    assert show() == unresolved
    run("git", "checkout", "-q", "work/example")
    for duplicate in ("other/", "work/", '""'):
        config.write_text(f"branch_prefix: work/\nbranch_prefix: {duplicate}\n")
        assert show() == unresolved, "ambiguous config picked a candidate"
    config.write_text('branch_prefix: "work/"\n')

    # 途中まで出力して失敗した --show の内容も、hook は出さない。
    (scripts / "pdh-stage-checklist.sh").write_text("#!/usr/bin/env bash\nprintf 'partial output\\n'\nprintf 'error\\n' >&2\nexit 1\n")
    assert hook() == ""
    (scripts / "pdh-stage-checklist.sh").unlink()
    assert hook() == ""
    assert hook(cwd=Path(tmp)) == "", "git failure leaked output"
    shutil.copy2(root / "scripts/pdh-stage-checklist.sh", scripts / "pdh-stage-checklist.sh")
    broken_bin = Path(tmp) / "bin"
    broken_bin.mkdir()
    broken_python = broken_bin / "python3"
    broken_python.write_text("#!/bin/sh\nexit 1\n")
    broken_python.chmod(0o755)
    assert hook(extra={"PATH": str(broken_bin) + os.pathsep + env["PATH"]}) == ""

print(f"PASS: pdh session hook ({checks} commands)")
PY
