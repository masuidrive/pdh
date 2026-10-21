"""Validate a merge-only result against the automatically merged index."""
import json
import subprocess
import sys


def git(*args):
    return subprocess.check_output(['git', *args])


def snapshot():
    entries = [entry.split(b'\t', 1) for entry in git('ls-files', '--stage', '-z').split(b'\0') if entry]
    conflicted = {path for mode, path in entries if not mode.endswith(b' 0')}
    return {"entries": {path.hex(): mode.hex() for mode, path in entries if path not in conflicted},
            "conflicts": [path.hex() for path in conflicted]}


def verify(expected, before, base):
    if git('rev-list', '--parents', '-n', '1', 'HEAD').decode().split()[1:] != [before, base]:
        raise ValueError('expected exactly one merge commit with the captured parents')
    if git('status', '--porcelain'):
        raise ValueError('merge must leave a clean worktree and index')
    actual = snapshot()["entries"]
    if actual.keys() != expected["entries"].keys() | set(expected["conflicts"]):
        raise ValueError("files were added or removed outside the conflicts")
    if any(actual.get(path) != mode for path, mode in expected["entries"].items()):
        raise ValueError('a file outside the merge conflicts changed')
    for encoded in expected["conflicts"]:
        path = bytes.fromhex(encoded)
        result = subprocess.run(['git', 'grep', '--cached', '-q', '-E', r'^(<<<<<<< |=======$|>>>>>>> )', '--', path])
        if result.returncode != 1:
            raise ValueError('unresolved conflict marker or unreadable result')


if __name__ == '__main__':
    if sys.argv[1] == 'snapshot':
        print(json.dumps(snapshot()))
    else:
        verify(json.load(sys.stdin), *sys.argv[2:4])
