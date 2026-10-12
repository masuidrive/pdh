#!/usr/bin/env python3
"""Enforce the runner's trusted path and commit policy for a dispatched PR task."""
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import sys


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def validate_commit(policy: dict, sha: str) -> None:
    parents = git("rev-list", "--parents", "-n", "1", sha).split()
    if parents != [sha, policy["base"]]:
        raise ValueError("task must add exactly one non-merge commit to the initial PR head")
    entries = subprocess.check_output(["git", "diff", "--name-status", "--no-renames", "-z", policy["base"], sha]).split(b"\0")[:-1]
    changed = [p.decode("utf-8", "surrogateescape") for p in entries[1::2]]
    if (not changed or any(status not in {b"A", b"M"} for status in entries[::2])
            or any(not re.fullmatch(policy["allowed_paths"], p) for p in changed)):
        raise ValueError("task must add/modify allowed paths only, and change at least one file")
    for path in changed:
        mode = git("ls-tree", sha, "--", path).split()[0]
        if mode not in {"100644", "100755"}:
            raise ValueError("task paths must be regular files")


def check_push(policy: dict, remote: str, lines: list[str]) -> None:
    if remote != "origin" or len(lines) != 1:
        raise ValueError("task may push exactly one ref to origin")
    _, sha, destination, remote_sha = lines[0].split()
    if destination != "refs/heads/" + policy["branch"]:
        raise ValueError("task may push only the PR branch")
    validate_commit(policy, sha)
    if remote_sha not in {policy["base"], sha}:
        raise ValueError("remote PR head changed since task started")


def restrict_paths(upper_bound: str, requested: str) -> str:
    """Intersect literal dispatch paths with the default-branch repository policy."""
    paths = json.loads(requested)
    if (not isinstance(paths, list) or not paths
            or any(not isinstance(p, str) or not p or p.startswith("/")
                   or any(part in {"", ".", ".."} for part in p.split("/"))
                   or str(PurePosixPath(p)) != p for p in paths)):
        raise ValueError("allowed_paths input must be a nonempty JSON array of relative file paths")
    allowed = sorted({p for p in paths if re.fullmatch(upper_bound, p)})
    if not allowed:
        raise ValueError("dispatch paths do not intersect the repository policy")
    return "(?:" + "|".join(re.escape(p) for p in allowed) + ")"


def install(branch: str, base: str, allowed_paths: str) -> None:
    if not allowed_paths:
        raise ValueError("runner path policy is required")
    re.compile(allowed_paths)
    subprocess.run(["git", "check-ref-format", "refs/heads/" + branch], check=True)
    if git("rev-parse", base + "^{commit}") != base:
        raise ValueError("initial PR head must be a full commit SHA")
    hooks = Path(git("rev-parse", "--git-path", "hooks")).resolve()
    hooks.mkdir(parents=True, exist_ok=True)
    target = hooks / "pre-push"
    policy = {"branch": branch, "base": base, "allowed_paths": allowed_paths}
    command = shlex.join(["python3", str(Path(__file__).resolve()), "check", json.dumps(policy)])
    target.write_text('#!/usr/bin/env bash\n# coding-bot-pr-scope-pre-push\nexec ' + command + ' "$@"\n')
    target.chmod(0o755)


def main() -> int:
    try:
        if sys.argv[1] == "policy":
            allowed = json.loads(Path(sys.argv[2]).read_text())["allowed_paths"]
            if not isinstance(allowed, str) or not allowed:
                raise ValueError("runner path policy is required")
            re.compile(allowed)
            print(restrict_paths(allowed, sys.argv[3]) if len(sys.argv) > 3 else allowed)
        elif sys.argv[1] == "restrict":
            print(restrict_paths(*sys.argv[2:]))
        elif sys.argv[1] == "install":
            install(*sys.argv[2:])
        elif sys.argv[1] == "verify":
            branch, base, allowed_paths = sys.argv[2:]
            policy = {"branch": branch, "base": base, "allowed_paths": allowed_paths}
            sha = git("rev-parse", "refs/remotes/origin/" + branch)
            # Existing scripts can be handed off without adding a commit.
            if sha != base:
                validate_commit(policy, sha)
        elif sys.argv[1] == "check":
            check_push(json.loads(sys.argv[2]), sys.argv[3], sys.stdin.read().splitlines())
        else:
            raise ValueError("unknown task scope command")
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f"coding-bot: task push/result refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
