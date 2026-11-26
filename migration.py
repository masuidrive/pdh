"""Prepare the agent entrypoints while retaining a project's own instructions."""
from pathlib import Path
import hashlib
import json
import re

ENTRY = "pdh-flow.md"
IMPORT_ROUTE = f"@{ENTRY}"
MARKER = "<!-- pdh-workflow -->"
IMPORT = re.compile(r"^@(\S+)")
GENERATED = "<!-- この file は scripts/gen-agents-md.sh が CLAUDE.md から作る。"
COMMAND = re.compile(r'("command"\s*:\s*)("(?:[^"\\]|\\.)*")')
SESSION_HELPER = r"scripts/pdh-session-(?:hook|context)\.sh(?=$|[\s\"';|&)])"


def invoked_session_helper(command, target):
    project_root = (
        r"(?:\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\}|\$PWD|\$\{PWD\}|"
        r"\$\(git rev-parse --show-toplevel\)|" + re.escape(str(target)) + ")"
    )
    rooted = re.sub(rf"({project_root}/){SESSION_HELPER}",
                    r"\1pdh/scripts/pdh-session-context.sh", command)
    return re.sub(rf"(^|[\s\"';|&])((?:\./)?){SESSION_HELPER}",
                  r"\1\2pdh/scripts/pdh-session-context.sh", rooted)


def hook_commands(value, path=()):
    if isinstance(value, dict):
        for name, child in value.items():
            if name == "command" and isinstance(child, str):
                yield path[:2] == ("hooks", "SessionStart"), child
            yield from hook_commands(child, (*path, name))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from hook_commands(child, (*path, index))


def migrate_session_hooks(text, target):
    if "pdh-session-hook.sh" not in text and "pdh-session-context.sh" not in text:
        return text
    parsed = list(hook_commands(json.loads(text)))
    commands = [invoked_session_helper(command, target) if session else command
                for session, command in parsed]
    if commands == [command for _, command in parsed]:
        return text
    # Replace just the selected JSON values. Other hook commands and project
    # settings keep their original spelling, escaping and formatting.
    matches = list(COMMAND.finditer(text))
    if [json.loads(match[2]) for match in matches] != [command for _, command in parsed]:
        raise ValueError("cannot identify the SessionStart hook commands")
    for match, (_, old), new in reversed(list(zip(matches, parsed, commands))):
        if old != new:
            text = text[:match.start(2)] + json.dumps(new, ensure_ascii=False) + text[match.end(2):]
    return text


def routed(text, route, previous=None):
    if route == IMPORT_ROUTE and route in text.splitlines():
        return text
    if route != IMPORT_ROUTE and MARKER in text:
        if previous and previous in text and route not in text:
            return text.replace(previous, route, 1)
        if route not in text:
            raise ValueError("PDH workflow block was edited; reconcile the entrypoint first")
        return text
    # Fit inside consumers' existing instruction budgets by replacing the old import.
    text, count = re.subn(r"^@(?:\./)?PDH-AGENTS\.md[ \t]*$", lambda _: route, text, flags=re.M)
    text = text.replace("**再開するとき・context の compaction の後は、作業を続ける前に `bash scripts/pdh-stage-checklist.sh --show`", "**旧stageの再開・compaction後は作業前に `bash scripts/pdh-stage-checklist.sh --show`")
    return text if count else route + "\n\n" + text


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


def plan_migration(target: Path, usage: bytes):
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
    entry = usage.decode()
    route = entry.rstrip()
    installed = target / ENTRY
    previous = installed.read_text().rstrip() if installed.is_file() else None
    if not claude.is_symlink():
        changed[claude] = routed(before, route if agents.is_symlink() else IMPORT_ROUTE, previous)
    old_agents = agents.read_text() if agents.exists() else ""
    if agents.is_symlink():
        pass  # The canonical Claude entrypoint is updated above.
    elif old_agents.startswith(GENERATED):
        script = target / "scripts/gen-agents-md.sh"
        # Digest of the generator from the archived stage distribution.
        if script.is_symlink() or hashlib.sha256(script.read_bytes()).hexdigest() != (
            "d12a31476a23b4b45d37899b674468de9afe54e55d5685a1bf0f0433ed08832e"
        ):
            raise ValueError("custom AGENTS generator: update its input and run it before installation")
        header, separator, _ = old_agents.partition("\n\n")
        rules = sorted((target / ".claude/rules").glob("*.md"))

        def render(changes):
            return (header + separator + expanded(target, claude, changes)
                    + "".join("\n" + expanded(target, rule, changes) for rule in rules))

        if render({}) != old_agents:
            raise ValueError("AGENTS.md differs from its inputs; run bash scripts/gen-agents-md.sh first")
        changed[agents] = render({**changed, target / ENTRY: entry})
    else:
        changed[agents] = routed(old_agents, route, previous)
    for path, value in changed.items():
        if not path.exists() or value != path.read_text():
            plan[path.name] = value.encode()

    # Old stage and earlier shared releases used the project's scripts directory.
    for name in (".claude/settings.json", ".codex/hooks.json"):
        path = target / name
        if path.is_file():
            old = path.read_text()
            new = migrate_session_hooks(old, target)
            if new != old:
                plan[name] = new.encode()
    return plan
