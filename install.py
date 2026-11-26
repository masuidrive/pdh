#!/usr/bin/env python3
"""Install the shared PDH distribution in a Git project."""

import argparse
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile

# Checking a project must also leave the release checkout unchanged when importing
# the side-effect-free migration planner.
sys.dont_write_bytecode = True

RELEASE = Path(__file__).resolve().parent
INSTALL_LOCK = ".pdh-install.lock"
OLD_LOCK = ".pdh-lock"
OLD_CONFIG = ".pdh-legacy/ticket-config.yaml"
OLD_CLOSE = "bash scripts/check-pdh-ticket.sh"
NEW_CLOSE = "bash scripts/pdh-ticket-ready.sh"
UPSTREAM = "https://github.com/masuidrive/pdh/blob/"
OLD_TICKET_SHA256 = {
    # The vendor script installed in both legacy downstream versions.
    "ca9b4a925987b05fa79750ebb311aa85f008c673c863fe572b6b90d0050b9b4f",
}
KEY = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]|$)")
CONFIG_KEYS = (
    "default_content", "note_content", "ticket_files", "require_checklist_groups",
    "pre_close_command", "new_success_message", "start_success_message",
    "restore_success_message", "close_success_message",
)


@dataclass(frozen=True)
class File:
    data: bytes
    mode: int = 0o644
    link: bool = False

    @property
    def digest(self):
        return hashlib.sha256(self.data).hexdigest()

    def lock(self):
        return {"sha256": self.digest, "kind": "link" if self.link else "file",
                "executable": not self.link and bool(self.mode & 0o111)}


def project_path(name):
    p = PurePosixPath(name)
    if (not p.parts or p.is_absolute() or str(p) != name or
            any(part in (".", "..", ".git") for part in p.parts) or
            any(c in name for c in ("\0", "\n", "\r", "\t"))):
        raise ValueError(f"Invalid repository path {name!r}")
    return p


def git(root, *args, optional=False):
    result = subprocess.run(
        ["git", "-C", str(root), *args], stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False,
        env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
    )
    if result.returncode:
        if optional:
            return None
        raise ValueError(f"{root}: git {args[0]} failed")
    return result.stdout


def read_file(root, name, *, link_ok=False):
    p = project_path(name)
    path = root
    for part in p.parts[:-1]:
        path = path / part
        try:
            mode = path.lstat().st_mode
        except FileNotFoundError:
            return None
        if not stat.S_ISDIR(mode):
            raise ValueError(f"{path}: expected a directory, without symlinks")
    path = root / p
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(mode) and link_ok:
        return File(os.fsencode(os.readlink(path)), 0, True)
    if not stat.S_ISREG(mode):
        raise ValueError(f"{path}: expected a regular file")
    return File(path.read_bytes(), stat.S_IMODE(mode))


def default_branch(target):
    remote = git(target, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD", optional=True)
    if remote is not None and remote.startswith(b"origin/"):
        branch = remote[len(b"origin/"):].decode().strip()
    else:
        current = git(target, "symbolic-ref", "--quiet", "--short", "HEAD", optional=True)
        branch = current.decode().strip() if current is not None else ""
    if not re.fullmatch(r"[A-Za-z0-9._/-]+", branch):
        raise ValueError("Cannot determine the Git base branch")
    return branch


def avoid_generated_files(target, plan, config, config_path):
    names = {
        "current-ticket": "/current-ticket",
        "current-ticket.md": "/current-ticket.md",
        "current-note.md": "/current-note.md",
        "tickets/example-ticket/tmp/pdh-install-probe": "/tickets/*/tmp/",
    }
    _, blocks = parse_config(config, config_path)
    copies = blocks.get("worktree_copy_files", (0, 0, ""))[2]
    for path in (".env", "CLAUDE.local.md"):
        # Decide by the declared copy list and Git's index. Never open these files.
        item = re.escape(path)
        if re.search(rf"(?m)^ +-[ \t]+(?:{item}|'{item}'|\"{item}\")[ \t]*(?:#.*)?$", copies) and not git(target, "ls-files", "--", path):
            names[path] = "/" + path
    missing = [pattern for path, pattern in names.items()
               if git(target, "check-ignore", "--quiet", "--no-index", "--", path, optional=True) is None]
    if not missing:
        return
    current = read_file(target, ".gitignore")
    data = current.data if current else b""
    if data and not data.endswith(b"\n"):
        data += b"\n"
    if data and not data.endswith(b"\n\n"):
        data += b"\n"
    data += ("# PDH-generated paths\n" + "\n".join(missing) + "\n").encode()
    plan.add(".gitignore", File(data, current.mode if current else 0o644), current)


def adapt_legacy_checker(current):
    # The project and CI keep using this entrypoint. Scope and Markdown gates
    # for new tickets are owned by pdh.py, including after a move into done/.
    target = b'  d=${t%/ticket.md}\n  ticket_is_on_this_branch "$d" || continue\n  seen=1\n'
    if current.data.count(target) != 1:
        raise ValueError("Cannot identify the legacy ticket checker loop")
    route = b"""  pdh_name=${d##*/}
  pdh_ticket_path="$tickets_dir/$pdh_name/ticket.md"
  pdh_first=$(git log --diff-filter=A --format=%H HEAD -- "$pdh_ticket_path" | tail -1)
  if [ -n "$pdh_first" ] &&
     git show "$pdh_first:$pdh_ticket_path" | awk '
       NR == 1 && $0 != "---" { exit }
       NR > 1 && $0 == "---" { exit }
       $0 == "pdh_workflow: shared" { found=1 }
       END { exit !found }
     '; then
    continue
  fi
"""
    data = current.data.replace(target, target + route, 1)
    return File(data, current.mode)


def parse_config(data, location):
    lines = data.decode("utf-8").splitlines(keepends=True)
    blocks = {}
    for i, line in enumerate(lines):
        key = KEY.match(line)
        if key is None:
            if line.strip() and not line[0].isspace() and not line.startswith("#"):
                raise ValueError(f"{location}: unsupported top-level YAML at line {i + 1}")
            continue
        name = key[1]
        if name in blocks:
            raise ValueError(f"{location}: duplicate key {name}")
        end = i + 1
        while end < len(lines) and (not lines[end].strip() or lines[end][0].isspace()):
            end += 1
        while end > i + 1 and not lines[end - 1].strip():
            end -= 1
        blocks[name] = (i, end, "".join(lines[i:end]))
    return lines, blocks


def scalar(block):
    if not block:
        return ""
    line = block.splitlines()[0].split(":", 1)[1].strip()
    if re.fullmatch(r'"[^"]*"|\'[^\']*\'', line):
        return line[1:-1]
    return line


def ticket_file_entries(block):
    if not block:
        return {}
    lines = block.splitlines(keepends=True)
    if lines[0].strip() != "ticket_files:":
        raise ValueError("Cannot migrate this ticket_files syntax")
    paths = {}
    start = None
    for i, line in enumerate(lines[1:], 1):
        match = re.fullmatch(r"  - path: ([A-Za-z0-9_./-]+)\s*", line)
        if match:
            if start is not None:
                paths[name] = "".join(lines[start:i])
            name, start = match[1], i
            project_path(name)
            if name in paths:
                raise ValueError(f"Duplicate ticket file {name}")
        elif start is None or not line.startswith("    ") and line.strip():
            raise ValueError("Cannot migrate this ticket_files syntax")
    if start is not None:
        paths[name] = "".join(lines[start:])
    return paths


def supplemental_files(old, desired, installed):
    files = ticket_file_entries(desired)
    for name, block in ticket_file_entries(old).items():
        was_managed = installed.get(f"ticket_files:{name}") == File(block.encode()).digest
        if name in files:
            if block != files[name] and not was_managed:
                raise ValueError(f"Existing ticket_files entry overlaps with PDH: {name}")
        elif not was_managed:
            files[name] = block
    return "ticket_files:\n" + "".join(files.values())


def ticket_config(release, existing, template, installed):
    _, standard = parse_config(template, "shared/.ticket-config.yaml")
    if existing is None:
        return template, False
    lines, blocks = parse_config(existing.data, ".ticket-config.yaml")
    get = lambda values, name: values.get(name, (0, 0, ""))[2]
    close = scalar(get(blocks, "pre_close_command"))
    if close not in ("", OLD_CLOSE, NEW_CLOSE):
        raise ValueError(".ticket-config.yaml: cannot classify the project's pre_close_command")
    if scalar(get(blocks, "tickets_dir")) not in ("", "tickets"):
        raise ValueError(".ticket-config.yaml: shared close requires tickets_dir: tickets")
    legacy = close == OLD_CLOSE
    baseline = {}
    if legacy:
        origin = re.search(
            rf"^# Based on {re.escape(UPSTREAM)}([a-f0-9]{{7,64}})/((?:claude|codex)/templates/\.ticket-config\.yaml)\s*$",
            existing.data.decode("utf-8"), re.MULTILINE,
        )
        raw = git(release, "show", f"{origin[1]}:{origin[2]}", optional=True) if origin else None
        if raw is not None:
            _, baseline = parse_config(raw, origin[2])

    desired = {}
    for key in CONFIG_KEYS:
        current = get(blocks, key)
        replacement = get(standard, key)
        if key == "ticket_files":
            desired[key] = supplemental_files(current, replacement, installed)
            continue
        if key == "pre_close_command":
            desired[key] = replacement
            continue
        if not current or current == replacement or current == get(baseline, key):
            desired[key] = replacement
        elif installed.get(key) == File(current.encode()).digest:
            desired[key] = replacement
        elif key.endswith("_success_message") and "pdh-" not in current.lower() and "PDH-" not in current:
            desired[key] = current
        else:
            raise ValueError(f".ticket-config.yaml: cannot safely replace {key}")
    # Keep repository, branch, push policy, worktree settings, bot settings,
    # local hooks, and every other project-specific key at their current values.
    for key in (*standard.keys(), *desired.keys()):
        if key not in blocks and key not in desired:
            desired[key] = get(standard, key)
    edits = [(start, end, desired[key]) for key, (start, end, _) in blocks.items() if key in desired]
    for start, end, replacement in sorted(edits, reverse=True):
        lines[start:end] = [replacement] if replacement else []
    for key, block in desired.items():
        if key not in blocks and block:
            if lines and not lines[-1].endswith("\n"):
                lines.append("\n")
            lines.append(block)
    return "".join(lines).encode(), legacy


def parse_legacy_lock(file):
    if file is None:
        return "", {}
    header, *lines = file.data.decode("utf-8").splitlines()
    if not re.fullmatch(r"# upstream: masuidrive/pdh@[0-9a-f]{40}", header):
        raise ValueError("Invalid .pdh-lock upstream header")
    rows = {}
    for line in lines:
        row = line.split("\t")
        if len(row) not in (3, 4) or not re.fullmatch(r"[0-9a-f]{64}", row[2]):
            raise ValueError("Invalid .pdh-lock row")
        path, source = map(project_path, row[:2])
        if len(row) == 4:
            if not row[3].startswith("dir:") or project_path(row[3][4:]) not in path.parents:
                raise ValueError(f"Invalid .pdh-lock directory row for {path}")
        if str(path) in rows:
            raise ValueError(f"Duplicate .pdh-lock row for {path}")
        rows[str(path)] = [str(path), str(source), *row[2:]]
    return header, rows


def installation_lock(file):
    if file is None:
        return {"version": 1, "files": {}, "ticket_config": {}}
    state = json.loads(file.data)
    if not isinstance(state, dict) or set(state) != {"version", "files", "ticket_config"} or state["version"] != 1:
        raise ValueError(f"{INSTALL_LOCK}: unsupported format")
    if not isinstance(state["files"], dict) or not isinstance(state["ticket_config"], dict):
        raise ValueError(f"{INSTALL_LOCK}: invalid file or config inventory")
    for name, saved in state["files"].items():
        project_path(name)
        if (not isinstance(saved, dict) or set(saved) != {"sha256", "kind", "executable"} or
                saved["kind"] not in ("file", "link") or not isinstance(saved["executable"], bool) or
                not isinstance(saved["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", saved["sha256"])):
            raise ValueError(f"{INSTALL_LOCK}: invalid record for {name}")
    return state


def shared_files(release):
    root = release / "shared"
    if root.is_symlink() or not root.is_dir():
        raise ValueError("The release has no shared distribution")
    files = {}
    for path in sorted(root.rglob("*")):
        name = path.relative_to(root).as_posix()
        if "__pycache__" in path.parts:
            continue
        if path.is_dir() and not path.is_symlink():
            continue
        source = read_file(root, name)
        files[name] = File(source.data, 0o755 if source.mode & 0o111 else 0o644)
    for required in ("ticket.sh", ".ticket-config.yaml", "scripts/pdh-ticket-ready.sh",
                     ".claude/skills/pdh/SKILL.md", ".claude/skills/pdh-update/SKILL.md", "tickets/PDH.md"):
        if required not in files:
            raise ValueError(f"Missing shared distribution file {required}")
    return files


def is_head_file(target, name, current):
    return current is not None and git(target, "show", f"HEAD:{name}", optional=True) == current.data


class Plan:
    def __init__(self, target):
        self.target = target
        self.changes = {}

    def add(self, name, wanted, existing):
        project_path(name)
        if wanted == existing:
            return
        if name in self.changes:
            raise ValueError(f"Two updates would write {name}")
        self.changes[name] = (existing, wanted)

    def apply(self):
        installed = []
        directories = []
        # Preflight the complete plan before any changes, then replace each file
        # atomically. Restore completed changes if a later replace fails.
        for path, (before, _) in self.changes.items():
            if read_file(self.target, path, link_ok=True) != before:
                raise ValueError(f"{path} changed after planning")
        try:
            for path, (before, after) in self.changes.items():
                _put(self.target / path, after, directories)
                installed.append((path, before))
        except BaseException:
            for path, previous in reversed(installed):
                if previous is None:
                    (self.target / path).unlink()
                else:
                    _put(self.target / path, previous, directories)
            for path in reversed(directories):
                path.rmdir()
            raise


def _put(path, file, created_dirs):
    missing = []
    parent = path.parent
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for directory in reversed(missing):
        directory.mkdir()
        created_dirs.append(directory)
    fd, temp = tempfile.mkstemp(prefix=".pdh-install-", dir=path.parent)
    temp = Path(temp)
    try:
        if file.link:
            os.close(fd)
            temp.unlink()
            temp.symlink_to(os.fsdecode(file.data))
        else:
            with os.fdopen(fd, "wb") as out:
                out.write(file.data)
                os.fchmod(out.fileno(), file.mode)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def build_plan(release, target):
    plan = Plan(target)
    assets = shared_files(release)
    install_file = read_file(target, INSTALL_LOCK)
    saved = installation_lock(install_file)
    legacy_file = read_file(target, OLD_LOCK)
    legacy_header, legacy_rows = parse_legacy_lock(legacy_file)
    files = {}
    config_name = ".ticket-config.yaml"
    config = read_file(target, config_name)
    yml = read_file(target, ".ticket-config.yml")
    if config is None and yml is not None:
        config_name, config = ".ticket-config.yml", yml
    template = assets.pop(".ticket-config.yaml").data
    if config is None or "default_branch" not in parse_config(config.data, config_name)[1]:
        branch = default_branch(target)
        template = re.sub(rb"(?m)^default_branch:.*$",
                          f'default_branch: "{branch}"'.encode(), template, count=1)
    updated, legacy = ticket_config(release, config, template, saved["ticket_config"])
    if config and updated != config.data and not is_head_file(target, config_name, config):
        raise ValueError(f"{config_name}: commit existing changes before installing")
    plan.add(config_name, File(updated, config.mode if config else 0o644), config)
    avoid_generated_files(target, plan, updated, config_name)
    files["current_ticket"] = File(b"current-ticket", 0, True)

    checker = "scripts/check-pdh-ticket.sh"
    if legacy:
        old_checker = read_file(target, checker)
        if old_checker is None or old_checker.digest != legacy_rows.get(checker, ["", "", ""])[2]:
            raise ValueError(f"{checker}: cannot confirm the legacy checker version")
        files[checker] = adapt_legacy_checker(old_checker)
    elif checker in saved["files"]:
        old_checker = read_file(target, checker)
        if old_checker is None or old_checker.lock() != saved["files"][checker]:
            raise ValueError(f"{checker}: legacy checker changed")
        files[checker] = old_checker
    if legacy and (target / ".github/workflows/coding-bot.yml").is_file():
        if read_file(target, OLD_CONFIG) is not None:
            raise ValueError("The installed bot already has a saved ticket configuration")
        files[OLD_CONFIG] = File(config.data, config.mode)
    elif OLD_CONFIG in saved["files"]:
        current = read_file(target, OLD_CONFIG)
        if current is None or current.lock() != saved["files"][OLD_CONFIG]:
            raise ValueError(f"{OLD_CONFIG}: installed configuration changed")
        files[OLD_CONFIG] = current

    files.update(assets)
    for skill in ("pdh", "pdh-update"):
        name = f".agents/skills/{skill}"
        path = target / name
        if path.is_dir() and not path.is_symlink():
            for asset, resource in assets.items():
                prefix = f".claude/skills/{skill}/"
                if asset.startswith(prefix):
                    files[f"{name}/{asset.removeprefix(prefix)}"] = resource
        else:
            files[name] = File(f"../../.claude/skills/{skill}".encode(), 0, True)
    for name, expected in sorted(files.items()):
        current = read_file(target, name, link_ok=expected.link)
        if current is not None and current.lock() != expected.lock():
            row = legacy_rows.get(name)
            tracked = current.lock() == saved["files"].get(name)
            legacy_clean = not current.link and row is not None and current.digest == row[2]
            stock_ticket = name == "ticket.sh" and not current.link and current.digest in OLD_TICKET_SHA256
            if not (tracked or legacy_clean or stock_ticket):
                raise ValueError(f"{name}: existing contents differ from the known installed version")
        plan.add(name, expected, current)
        if name in legacy_rows and not expected.link:
            legacy_rows[name][2] = expected.digest
    if legacy_file is not None:
        # Keep the origin and legacy layer rows. The legacy checker validates
        # the current bytes of inherited rows, including overlapping assets.
        old_data = (legacy_header + "\n" + "".join("\t".join(row) + "\n" for row in legacy_rows.values())).encode()
        plan.add(OLD_LOCK, File(old_data, legacy_file.mode), legacy_file)

    try:
        from migration import plan_migration
    except ModuleNotFoundError as exc:
        if exc.name != "migration":
            raise
        raise ValueError("The release has no migration planner") from exc
    for name, data in plan_migration(target, release, ("claude", "codex")).items():
        if name in files or name in (INSTALL_LOCK, OLD_LOCK, config_name):
            raise ValueError(f"{name}: migration overlaps with a shared file")
        current = read_file(target, name)
        wanted = File(data, current.mode if current else 0o644)
        if current and wanted != current and not is_head_file(target, name, current):
            raise ValueError(f"{name}: commit existing changes before installing")
        plan.add(name, wanted, current)

    _, configured = parse_config(updated, config_name)
    _, managed_config = parse_config(template, "shared/.ticket-config.yaml")
    keys = {key: File(configured[key][2].encode()).digest for key in CONFIG_KEYS if key in configured}
    for key, block in ticket_file_entries(managed_config["ticket_files"][2]).items():
        keys[f"ticket_files:{key}"] = File(block.encode()).digest
    recorded = {
        "version": 1,
        "files": {**saved["files"], **{name: file.lock() for name, file in files.items()}},
        "ticket_config": keys,
    }
    lock = File((json.dumps(recorded, indent=2, sort_keys=True) + "\n").encode())
    plan.add(INSTALL_LOCK, lock, install_file)
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, required=True, help="the root of a Git project")
    parser.add_argument("--check", action="store_true", help="print planned changes without modifying files")
    args = parser.parse_args()
    try:
        target = args.target.resolve(strict=True)
        root = Path(os.fsdecode(git(target, "rev-parse", "--show-toplevel")).strip()).resolve()
        if root != target or target == RELEASE:
            raise ValueError("--target must name a separate Git project root")
        descriptor = os.open(target, os.O_RDONLY | os.O_DIRECTORY)
        try:
            if not args.check:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            plan = build_plan(RELEASE, target)
            if not plan.changes:
                print("PDH already up to date")
                return 0
            if not args.check:
                plan.apply()
            for name, (before, _) in plan.changes.items():
                print(f"{'create' if before is None else 'update'}\t{name}")
            return 0
        finally:
            os.close(descriptor)
    except KeyboardInterrupt:
        return 130
    except (OSError, ValueError) as error:
        print(f"PDH installation stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
