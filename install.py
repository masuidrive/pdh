#!/usr/bin/env python3
"""Install the shared PDH distribution in a Git project."""

import argparse
from dataclasses import dataclass
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
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
FORMER_CLOSE = "bash scripts/pdh-ticket-ready.sh"
NEW_CLOSE = "bash pdh/scripts/pdh-ticket-ready.sh"
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


@dataclass(frozen=True)
class Directory:
    entries: tuple
    mode: int

    def files(self, prefix):
        for name, item in self.entries:
            path = f"{prefix}/{name}"
            if isinstance(item, Directory):
                if not item.entries:
                    raise ValueError(f"{path}: cannot identify an empty skill directory")
                yield from item.files(path)
            else:
                yield path, item


def project_path(name):
    p = PurePosixPath(name)
    if (not p.parts or p.is_absolute() or str(p) != name or
            any(part in (".", "..", ".git") for part in p.parts) or
            any(c in name for c in ("\0", "\n", "\r", "\t"))):
        raise ValueError(f"Invalid repository path {name!r}")
    return p


def git(root, *args, optional=False, request=None):
    result = subprocess.run(
        ["git", "-C", str(root), *args], stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False, input=request,
        env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
    )
    if result.returncode:
        if optional:
            return None
        raise ValueError(f"{root}: git {args[0]} failed")
    return result.stdout


def read_file(root, name, *, link_ok=False, directory_ok=False):
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
    if stat.S_ISDIR(mode) and directory_ok:
        entries = []
        for child in sorted(path.iterdir()):
            item = read_file(root, f"{name}/{child.name}", link_ok=True, directory_ok=True)
            if item is None:
                raise ValueError(f"{child}: changed while reading the installed skill")
            entries.append((child.name, item))
        return Directory(tuple(entries), stat.S_IMODE(mode))
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
    _, standard = parse_config(template, "integration/.ticket-config.yaml")
    if existing is None:
        return template, False
    lines, blocks = parse_config(existing.data, ".ticket-config.yaml")
    get = lambda values, name: values.get(name, (0, 0, ""))[2]
    close = scalar(get(blocks, "pre_close_command"))
    if close not in ("", OLD_CLOSE, FORMER_CLOSE, NEW_CLOSE):
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
    keys = {"version", "files", "ticket_config"}
    if (not isinstance(state, dict) or set(state) not in (keys, keys | {"release"})
            or state["version"] != 1):
        raise ValueError(f"{INSTALL_LOCK}: unsupported format")
    if "release" in state and (not isinstance(state["release"], str) or not re.fullmatch(r"[0-9a-f]{40,64}", state["release"])):
        raise ValueError(f"{INSTALL_LOCK}: invalid release commit")
    if not isinstance(state["files"], dict) or not isinstance(state["ticket_config"], dict):
        raise ValueError(f"{INSTALL_LOCK}: invalid file or config inventory")
    for name, saved in state["files"].items():
        project_path(name)
        if (not isinstance(saved, dict) or set(saved) != {"sha256", "kind", "executable"} or
                saved["kind"] not in ("file", "link") or not isinstance(saved["executable"], bool) or
                not isinstance(saved["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", saved["sha256"])):
            raise ValueError(f"{INSTALL_LOCK}: invalid record for {name}")
    return state


def release_files(release):
    root = Path(os.fsdecode(git(release, "rev-parse", "--show-toplevel")).strip()).resolve()
    if root != release:
        raise ValueError("Run the installer from a separate PDH release checkout")
    revision = git(release, "rev-parse", "HEAD^{commit}").decode().strip()
    entries = {}
    object_ids = {}
    listing = git(release, "ls-tree", "-rz", revision)
    for record in listing.split(b"\0"):
        if not record:
            continue
        meta, raw_name = record.split(b"\t", 1)
        mode, kind, oid = meta.split()
        name = os.fsdecode(raw_name)
        project_path(name)
        if kind != b"blob" or mode not in (b"100644", b"100755", b"120000"):
            raise ValueError(f"{name}: PDH releases must use ordinary tracked files or links")
        entries[name] = (mode, oid)
        object_ids[oid] = None
    request = b"".join(oid + b"\n" for oid in object_ids)
    objects = io.BytesIO(git(release, "cat-file", "--batch", request=request))
    for oid in object_ids:
        header = objects.readline().split()
        if len(header) != 3 or header[:2] != [oid, b"blob"]:
            raise ValueError("Git could not read the complete release snapshot")
        data = objects.read(int(header[2]))
        if len(data) != int(header[2]) or objects.read(1) != b"\n":
            raise ValueError("Git returned a truncated release blob")
        object_ids[oid] = data
    files = {name: File(object_ids[oid], 0 if mode == b"120000" else
                        0o755 if mode == b"100755" else 0o644, mode == b"120000")
             for name, (mode, oid) in entries.items()}
    for required in ("integration/ticket.sh", "integration/.ticket-config.yaml", "integration/pdh-flow.md",
                     "scripts/pdh-ticket-ready.sh", "skills/pdh/SKILL.md", "skills/pdh-update/SKILL.md",
                     "README.md", "USAGE.md"):
        if required not in files:
            raise ValueError(f"Missing release file {required}")
        if files[required].link:
            raise ValueError(f"{required}: expected a regular release file")
    return revision, files


def git_modified(target, name):
    return (git(target, "diff", "--no-ext-diff", "--name-only", "-z", "--", name) or
            git(target, "diff", "--no-ext-diff", "--cached", "--name-only", "-z", "--", name))


def is_head_file(target, name, current):
    return (current is not None and git(target, "show", f"HEAD:{name}", optional=True) == current.data
            and not git_modified(target, name))


class Plan:
    def __init__(self, target):
        self.target = target
        self.changes = {}
        self.retained = set()

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
        stage = None
        # Preflight the complete plan before any changes, then replace each file
        # atomically. Restore completed changes if a later replace fails.
        for path, (before, _) in self.changes.items():
            if read_file(self.target, path, link_ok=True, directory_ok=isinstance(before, Directory)) != before:
                raise ValueError(f"{path} changed after planning")
        try:
            for name, (before, after) in self.changes.items():
                path = self.target / name
                if after is None or isinstance(before, Directory):
                    if stage is None:
                        stage = Path(tempfile.mkdtemp(prefix=".pdh-install-backup-", dir=self.target))
                    backup = stage / str(len(installed))
                    path.rename(backup)
                    installed.append((path, before, backup))
                    if after is not None:
                        _put(path, after, directories)
                else:
                    _put(path, after, directories)
                    installed.append((path, before, None))
        except BaseException:
            try:
                for path, previous, backup in reversed(installed):
                    if backup is not None:
                        path.unlink(missing_ok=True)
                        backup.rename(path)
                    elif previous is None:
                        path.unlink()
                    else:
                        _put(path, previous, directories)
                for path in reversed(directories):
                    path.rmdir()
            except OSError as error:
                if stage is not None:
                    raise OSError(f"Could not restore the installation; retained backups in {stage}") from error
                raise
            if stage is not None:
                shutil.rmtree(stage)
            raise
        if stage is not None:
            shutil.rmtree(stage)


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


def former_assets(assets):
    names = {}
    for name in assets:
        if name.startswith("pdh/scripts/"):
            names[name.removeprefix("pdh/")] = name
        elif name.startswith("pdh/checks/"):
            names[f"scripts/pdh-checks/{name.removeprefix('pdh/checks/')}"] = name
        elif name == "pdh/USAGE.md":
            names["tickets/PDH.md"] = name
    return names


def retire_former_assets(plan, assets, installed, legacy_rows):
    obsolete = set(former_assets(assets)) | {name for name in installed if name.startswith("pdh/") and name not in assets}
    for former in sorted(obsolete & installed.keys()):
        installed_version = installed.pop(former)
        try:
            current = read_file(plan.target, former, link_ok=True)
        except ValueError:
            # A formerly managed path can now be a project-owned directory.
            plan.retained.add(former)
            continue
        if current is None:
            continue
        # A stage lock still claiming a path can be used by the old bot/checker.
        if former in legacy_rows or current.lock() != installed_version or git_modified(plan.target, former):
            plan.retained.add(former)
        else:
            plan.add(former, None, current)


SKILL_ALIASES = {
    f".{engine}/skills/{skill}": File(f"../../pdh/skills/{skill}".encode(), 0, True)
    for engine in ("claude", "agents")
    for skill in ("pdh", "pdh-update")
}


def retire_skill_directory(plan, name, current, installed, legacy_rows):
    files = list(current.files(name))
    if not files:
        raise ValueError(f"{name}: cannot identify an empty skill directory")
    for child, file in files:
        owned = file.lock() == installed.get(child)
        legacy = not file.link and file.digest == legacy_rows.get(child, ["", "", ""])[2]
        if not (owned or legacy) or git_modified(plan.target, child):
            raise ValueError(f"{child}: cannot replace the skill directory with a link while it contains project changes")
    for child, _ in files:
        installed.pop(child, None)
        legacy_rows.pop(child, None)
    # Previous installed inventory can also contain individual files that
    # somebody removed before this release. They have no on-disk asset to move.
    for child in sorted(path for path in installed.keys() | legacy_rows.keys() if path.startswith(name + "/")):
        if git_modified(plan.target, child):
            raise ValueError(f"{child}: commit existing changes before replacing the skill directory")
        installed.pop(child, None)
        legacy_rows.pop(child, None)


def check_vendor_directory(target):
    vendor = target / "pdh"
    if vendor.is_symlink() or os.path.lexists(vendor / ".git"):
        raise ValueError("pdh/ must be an ordinary product directory without its own Git data")
    indexed = git(target, "ls-files", "--stage", "-z", "--", "pdh")
    committed = git(target, "ls-tree", "-rz", "HEAD", "--", "pdh", optional=True) or b""
    if any(row.startswith(b"160000 ") for listing in (indexed, committed) for row in listing.split(b"\0")):
        raise ValueError("pdh/ contains a Git submodule; reconcile it before installing")


def build_plan(release, target):
    check_vendor_directory(target)
    plan = Plan(target)
    revision, source = release_files(release)
    assets = {f"pdh/{name}": file for name, file in source.items()}
    install_file = read_file(target, INSTALL_LOCK)
    saved = installation_lock(install_file)
    installed = dict(saved["files"])
    legacy_file = read_file(target, OLD_LOCK)
    legacy_header, legacy_rows = parse_legacy_lock(legacy_file)
    files = {}
    config_name = ".ticket-config.yaml"
    config = read_file(target, config_name)
    yml = read_file(target, ".ticket-config.yml")
    if config is None and yml is not None:
        config_name, config = ".ticket-config.yml", yml
    template = source["integration/.ticket-config.yaml"].data
    _, template_config = parse_config(template, "integration/.ticket-config.yaml")
    if scalar(template_config.get("pre_close_command", (0, 0, ""))[2]) != NEW_CLOSE:
        raise ValueError("The shared ticket configuration points at the wrong close command")
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
    for name in ("ticket.sh", "pdh-flow.md"):
        files[name] = source[f"integration/{name}"]

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
    files.update(SKILL_ALIASES)
    retire_former_assets(plan, assets, installed, legacy_rows)
    for name, expected in sorted(files.items()):
        alias = name in SKILL_ALIASES
        current = read_file(target, name, link_ok=True, directory_ok=alias)
        if isinstance(current, Directory):
            retire_skill_directory(plan, name, current, installed, legacy_rows)
        elif current is not None and current.lock() != expected.lock():
            row = legacy_rows.get(name)
            tracked = current.lock() == installed.get(name)
            legacy_clean = not current.link and row is not None and current.digest == row[2]
            stock_ticket = name == "ticket.sh" and not current.link and current.digest in OLD_TICKET_SHA256
            former_alias = (alias and name.startswith(".agents/") and current.link
                            and current.data == f"../../.claude/skills/{name.rsplit('/', 1)[1]}".encode())
            if not (tracked or legacy_clean or stock_ticket or former_alias) or git_modified(target, name):
                raise ValueError(f"{name}: existing contents differ from the known installed version")
        plan.add(name, expected, current)
        if name in legacy_rows and not expected.link:
            legacy_rows[name][2] = expected.digest
    if legacy_file is not None:
        # Keep the origin and legacy layer rows. The legacy checker validates
        # the current bytes of inherited rows, including overlapping assets.
        old_data = (legacy_header + "\n" + "".join("\t".join(row) + "\n" for row in legacy_rows.values())).encode()
        if old_data != legacy_file.data and git_modified(target, OLD_LOCK):
            raise ValueError(f"{OLD_LOCK}: commit existing changes before installing")
        plan.add(OLD_LOCK, File(old_data, legacy_file.mode), legacy_file)

    try:
        from migration import plan_migration
    except ModuleNotFoundError as exc:
        if exc.name != "migration":
            raise
        raise ValueError("The release has no migration planner") from exc
    for name, data in plan_migration(target, source["integration/pdh-flow.md"].data).items():
        if name in files or name in (INSTALL_LOCK, OLD_LOCK, config_name):
            raise ValueError(f"{name}: migration overlaps with a shared file")
        current = read_file(target, name)
        wanted = File(data, current.mode if current else 0o644)
        if current and wanted != current and not is_head_file(target, name, current):
            raise ValueError(f"{name}: commit existing changes before installing")
        plan.add(name, wanted, current)

    _, configured = parse_config(updated, config_name)
    keys = {key: File(configured[key][2].encode()).digest for key in CONFIG_KEYS if key in configured}
    for key, block in ticket_file_entries(template_config["ticket_files"][2]).items():
        keys[f"ticket_files:{key}"] = File(block.encode()).digest
    recorded = {
        "version": 1,
        "release": revision,
        "files": {**installed, **{name: file.lock() for name, file in files.items()}},
        "ticket_config": keys,
    }
    lock = File((json.dumps(recorded, indent=2, sort_keys=True) + "\n").encode())
    if install_file is not None and lock != install_file and git_modified(target, INSTALL_LOCK):
        raise ValueError(f"{INSTALL_LOCK}: commit existing changes before updating the lock")
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
        if root != target or target == RELEASE or RELEASE == target / "pdh":
            raise ValueError("--target must name a separate Git project root")
        descriptor = os.open(target, os.O_RDONLY | os.O_DIRECTORY)
        try:
            if not args.check:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            plan = build_plan(RELEASE, target)
            if not plan.changes and not plan.retained:
                print("PDH already up to date")
                return 0
            if not args.check:
                plan.apply()
            for name, (before, after) in plan.changes.items():
                action = "create" if before is None else "delete" if after is None else "update"
                print(f"{action}\t{name}")
            for name in sorted(plan.retained):
                print(f"retain\t{name}")
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
