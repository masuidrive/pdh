#!/usr/bin/env bash
# application-test: import の展開結果と上限を生成時・照合時の双方で守る。
set -euo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
python3 - "$ROOT_DIR" <<'PY'
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
checks = 0
with tempfile.TemporaryDirectory(prefix="gen-agents-test-") as tmp:
    repo = Path(tmp)
    scripts = repo / "scripts"
    scripts.mkdir()
    shutil.copy2(root / "scripts/gen-agents-md.sh", scripts / "gen-agents-md.sh")
    (repo / ".codex").mkdir()
    config = repo / ".codex/config.toml"
    config.write_text("project_doc_max_bytes = 131072\n")
    source = repo / "CLAUDE.md"
    source.write_text("# Main\n@one.md を参照すること\n@CLAUDE.local.md\n  @literal.md\n")
    (repo / "one.md").write_text("# One\n@sub/two.md\n")
    (repo / "sub").mkdir()
    (repo / "sub/two.md").write_text("二\n@../CLAUDE.local.md\n@three.md\n")
    (repo / "sub/three.md").write_text("三")
    (repo / "CLAUDE.local.md").write_text("secret local context\n@missing.md\n")
    target = repo / "AGENTS.md"

    def run(*args, code=0, message=""):
        global checks
        result = subprocess.run(["bash", str(scripts / "gen-agents-md.sh"), *args],
                                cwd=repo / "sub", text=True, capture_output=True)
        assert result.returncode == code, (result.returncode, result.stdout, result.stderr)
        assert message in result.stderr, result.stderr
        checks += 1

    run("--check", code=1, message="生成元とずれている")
    run()
    expected = target.read_bytes()
    text = expected.decode()
    assert text.startswith("<!-- この file は scripts/gen-agents-md.sh が CLAUDE.md から作る。")
    assert text.endswith("# Main\n# One\n二\n三\n  @literal.md\n"), text
    assert "secret local" not in text and "@CLAUDE.local.md" not in text
    run("--check")
    target.write_bytes(expected + b"drift\n")
    run("--check", code=1, message="生成元とずれている")
    assert target.read_bytes() == expected + b"drift\n", "--check wrote output"
    run()
    assert target.read_bytes() == expected

    # 上限は文字数でなく UTF-8 byte 数。境界ちょうどは許し、1 byte 下は両 mode で拒否する。
    config.write_text(f"project_doc_max_bytes = {len(expected)}\n")
    run()
    run("--check")
    config.write_text(f"project_doc_max_bytes = {len(expected) - 1}\n")
    for args in ((), ("--check",)):
        run(*args, code=1, message=f"{len(expected)} bytes exceeds project_doc_max_bytes = {len(expected) - 1}")
        assert target.read_bytes() == expected, "oversize generation changed output"
    config.write_text("project_doc_max_bytes = 131072\n")

    for content, diagnostic in (("@one.md\n", "circular import"),
                                ("@absent.md\n", "absent.md")):
        (repo / "sub/three.md").write_text(content.replace("@one.md", "@../one.md"))
        for args in ((), ("--check",)):
            run(*args, code=1, message=diagnostic)
            assert target.read_bytes() == expected, "failed generation changed output"
    (repo / "sub/three.md").write_text("三")
    # 同じファイルを別の枝から使うことは循環ではない。
    source.write_text("@one.md\n@one.md\n")
    run()
    assert target.read_text().count("# One\n") == 2
    run("--check")
    # local context が無くても取り込まない。
    source.write_text("@CLAUDE.local.md\nvisible\n")
    (repo / "CLAUDE.local.md").unlink()
    run()
    assert target.read_text().endswith("\n\nvisible\n")

    rules = repo / ".claude/rules"
    rules.mkdir(parents=True)
    (rules / "z.md").write_text("# Z rule\n@../../one.md\n")
    (rules / "a.md").write_text("# A rule\n")
    run()
    text = target.read_text()
    assert "# A rule\n" in text and "# Z rule\n# One\n" in text, text
    assert text.index("# A rule") < text.index("# Z rule")
    run("--check")
    (rules / "a.md").write_text("# A changed rule\n")
    run("--check", code=1, message="生成元とずれている")

print(f"PASS: gen agents md ({checks} commands)")
PY
