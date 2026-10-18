#!/usr/bin/env bash
# Generate Codex custom agents from the canonical Claude agent definitions.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 - "$repo_root" "$@" <<'PY'
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
args = sys.argv[2:]
if args not in ([], ["--check"]):
    sys.exit("usage: scripts/gen-codex-agents.sh [--check]")
check = bool(args)


def basic_string(value):
    # JSON's string escapes are also valid TOML basic-string escapes.
    return json.dumps(value, ensure_ascii=False).replace("\x7f", r"\u007f")


def render(source):
    # Byte reads avoid newline normalization; keep every character of the body.
    lines = source.read_bytes().decode("utf-8").splitlines(keepends=True)
    if not lines or lines[0].rstrip("\r\n") != "---":
        raise ValueError(f"{source}: missing frontmatter")
    end = next(
        (i for i in range(1, len(lines)) if lines[i].rstrip("\r\n") == "---"),
        None,
    )
    if end is None:
        raise ValueError(f"{source}: unclosed frontmatter")
    # Canonical agents use one-line plain scalars for these two fields.
    fields = {}
    for line in lines[1:end]:
        key, separator, value = line.partition(":")
        if separator and key in ("name", "description"):
            value = value.strip()
            if not value or value.startswith(("'", '"', "|", ">")) or key in fields:
                raise ValueError(f"{source}: {key} must be one plain, single-line scalar")
            fields[key] = value
    for key in ("name", "description"):
        if key not in fields:
            raise ValueError(f"{source}: missing {key}")
    body = "".join(lines[end + 1:])
    # Escape each line independently so literal backslashes and quotes survive,
    # while real LF characters remain readable. TOML trims the added first LF.
    escaped_body = "\n".join(basic_string(line)[1:-1] for line in body.split("\n"))
    relative = source.relative_to(root).as_posix()
    return (
        f"# この file は scripts/gen-codex-agents.sh が {relative} から作る。手で直さない。\n"
        f"name = {basic_string(fields['name'])}\n"
        f"description = {basic_string(fields['description'])}\n"
        f'developer_instructions = """\n{escaped_body}"""\n'
    ).encode("utf-8")


sources = sorted((root / ".claude/agents").glob("pdh-*.md"))
if not sources:
    sys.exit("no sources found: .claude/agents/pdh-*.md")
# Validate all sources before writing any output.
outputs = [(root / ".codex/agents" / f"{source.stem}.toml", render(source)) for source in sources]
different = False
for target, expected in outputs:
    if check:
        if not target.is_file() or target.read_bytes() != expected:
            print(target.relative_to(root).as_posix())
            different = True
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(expected)
sys.exit(1 if different else 0)
PY
