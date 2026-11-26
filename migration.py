"""Prepare the agent entrypoints while retaining a project's own instructions."""
from pathlib import Path
import re

MARKER = "<!-- pdh-workflow -->"
ROUTE = f"""{MARKER}
# 新しいチケットを開くとき

製品の変更・再開は `.claude/skills/pdh/SKILL.md`、共通の操作は `tickets/PDH.md` に従う。製品固有の制約・試験・利用中の環境に関する規則はこのファイルの記述を使う。旧stage、チェックリスト、役割への指示は移行前からあるチケットと旧方式のGitHub coding-botで使う。
<!-- /pdh-workflow -->
"""
IMPORT = re.compile(r"^@(\S+)")
GENERATED = "<!-- この file は scripts/gen-agents-md.sh が CLAUDE.md から作る。"


def routed(text):
    if MARKER in text:
        if ROUTE.rstrip() not in text:
            raise ValueError("PDH workflow block was edited; reconcile the entrypoint first")
        return text
    # Keep the old contract available to existing work without importing it into every session.
    text = re.sub(r"^@(?:\./)?PDH-AGENTS\.md(?=\s|$).*?$",
                  "旧チケットの共通手順は [PDH-AGENTS.md](PDH-AGENTS.md) を読む。", text, flags=re.M)
    text = text.replace("**再開するとき・context の compaction の後は、作業を続ける前に `bash scripts/pdh-stage-checklist.sh --show`", "**旧stageチケットを再開するとき・その context の compaction の後は、作業を続ける前に `bash scripts/pdh-stage-checklist.sh --show`")
    return ROUTE + "\n" + text


def expanded(target, source, changed, stack=()):
    """Follow the same Markdown imports as the supported project generator."""
    source = source.resolve()
    if source.name == "CLAUDE.local.md":
        return ""
    if not source.is_relative_to(target) or source in stack:
        raise ValueError(f"invalid or circular project Markdown import: {source.name}")
    text = changed[source] if source in changed else source.read_text()
    lines = []
    for line in text.splitlines(keepends=True):
        match = IMPORT.match(line)
        if match:
            included = expanded(target, source.parent / match[1], changed, (*stack, source))
            lines.append(included)
            if included and not included.endswith("\n"):
                lines.append("\n")
        else:
            lines.append(line)
    return "".join(lines)


def plan_migration(target: Path, release: Path, engines: tuple[str, ...]):
    target = target.resolve()
    plan = {}
    changed = {}
    claude = target / "CLAUDE.md"
    agents = target / "AGENTS.md"
    for path in (claude, agents):
        if path.is_symlink():
            if path.resolve() not in (claude, agents) or not path.is_file():
                raise ValueError(f"unsupported project entrypoint symlink: {path.name}")
    before = claude.read_text() if claude.exists() else ""
    if not claude.is_symlink():
        changed[claude] = routed(before)
    old_agents = agents.read_text() if agents.exists() else ""
    if agents.is_symlink():
        pass  # The canonical Claude entrypoint is updated above.
    elif old_agents.startswith(GENERATED):
        script = target / "scripts/gen-agents-md.sh"
        original = release / "claude/templates/gen-agents-md.sh"
        if script.is_symlink() or script.read_bytes() != original.read_bytes():
            raise ValueError("custom AGENTS generator: update its input and run it before installation")
        header, separator, _ = old_agents.partition("\n\n")
        rules = sorted((target / ".claude/rules").glob("*.md"))

        def render(changes):
            return (header + separator + expanded(target, claude, changes)
                    + "".join("\n" + expanded(target, rule, changes) for rule in rules))

        if render({}) != old_agents:
            raise ValueError("AGENTS.md differs from its inputs; run bash scripts/gen-agents-md.sh first")
        changed[agents] = render(changed)
    elif old_agents.strip() in ("@CLAUDE.md", "@./CLAUDE.md"):
        pass
    else:
        changed[agents] = routed(old_agents)
    for path, value in changed.items():
        if not path.exists() or value != path.read_text():
            plan[path.name] = value.encode()

    # The previous SessionStart helper only understands stage tickets. Preserve other hooks verbatim.
    for name in (".claude/settings.json", ".codex/hooks.json"):
        path = target / name
        if path.is_file():
            old = path.read_text()
            new = old.replace("/scripts/pdh-session-hook.sh", "/scripts/pdh-session-context.sh")
            if new != old:
                plan[name] = new.encode()
    return plan
