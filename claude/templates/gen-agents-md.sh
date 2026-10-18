#!/usr/bin/env bash
# CLAUDE.md の import と .claude/rules/*.md を展開し、Codex が常時読む AGENTS.md を作る。
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 - "$repo_root" "$@" <<'PY'
from pathlib import Path
import re
import sys
if sys.version_info < (3, 11):
    sys.exit("gen-agents-md: Python 3.11 以降が必要です（tomllib を使います）")
import tomllib

root = Path(sys.argv[1])
args = sys.argv[2:]
if args not in ([], ["--check"]):
    sys.exit("usage: scripts/gen-agents-md.sh [--check]")


def expand(source, stack=()):
    if source.name == "CLAUDE.local.md":
        return ""
    source = source.resolve()
    if source.name == "CLAUDE.local.md":
        return ""
    if source in stack:
        raise ValueError(f"circular import: {' -> '.join(str(p) for p in (*stack, source))}")
    result = []
    for line in source.read_bytes().decode("utf-8").splitlines(keepends=True):
        match = re.match(r"^@(\S+)", line)
        if match:
            included = expand(source.parent / match[1], (*stack, source))
            result.append(included)
            if included and not included.endswith("\n"):
                result.append("\n")
        else:
            result.append(line)
    return "".join(result)


try:
    config = tomllib.loads((root / ".codex/config.toml").read_text())
    limit = config.get("project_doc_max_bytes", 32768)
    if type(limit) is not int or limit <= 0:
        raise ValueError("project_doc_max_bytes must be a positive integer")
    expected = (
        "<!-- この file は scripts/gen-agents-md.sh が CLAUDE.md から作る。手で直さない。"
        "直すときは CLAUDE.md と .claude/rules/*.md を直して作り直す。 -->\n\n"
        + expand(root / "CLAUDE.md")
        + "".join("\n" + expand(rule) for rule in sorted((root / ".claude/rules").glob("*.md")))
    ).encode("utf-8")
    if len(expected) > limit:
        raise ValueError(f"AGENTS.md: {len(expected)} bytes exceeds project_doc_max_bytes = {limit}")
    target = root / "AGENTS.md"
    if args:
        if not target.is_file() or target.read_bytes() != expected:
            sys.exit("AGENTS.md が生成元とずれている。bash scripts/gen-agents-md.sh で生成し直す")
    else:
        target.write_bytes(expected)
except (OSError, ValueError) as error:
    sys.exit(f"gen-agents-md: {error}")
PY
