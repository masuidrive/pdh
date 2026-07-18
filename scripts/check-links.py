#!/usr/bin/env python3
"""check-links.py — verify intra-repo Markdown links resolve.

Two failure modes this catches, both of which break silently:

  1. `[x](path/to/file.md)` where the file was renamed or moved
  2. `[x](FILE.md#heading)` / `[x](#heading)` where the heading was reworded

The second one is why this exists. Renaming a section is a normal edit, and
nothing about it announces that a link somewhere else just stopped working.

Only intra-repo targets are checked. External URLs, mailto:, and links inside
fenced code blocks are skipped. Distributed templates are skipped too: their
links are written for the layout of a *consuming* project, where paths like
`docs/product-delivery-hierarchy.md` resolve but do not exist here.
"""

import pathlib
import re
import subprocess
import sys
import unicodedata

REPO = pathlib.Path(__file__).resolve().parent.parent

# Files whose links describe a consuming project's layout, not this repo's.
SKIP_PREFIXES = ("templates/",)

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
FENCE = re.compile(r"^\s*(```|~~~)")


def slugify(heading: str) -> str:
    """Approximate GitHub's heading -> anchor conversion.

    Lowercase, drop punctuation, spaces become hyphens. Non-ASCII letters
    (Japanese here) are kept, matching GitHub's behaviour.
    """
    s = heading.strip().lower()
    s = re.sub(r"[`*_~]", "", s)
    out = []
    for ch in s:
        if ch.isalnum() or ch in "-_":
            out.append(ch)
        elif ch.isspace():
            out.append("-")
        elif unicodedata.category(ch).startswith("L"):
            out.append(ch)
    return re.sub(r"-+", "-", "".join(out)).strip("-")


def headings(path: pathlib.Path) -> set:
    """Anchors defined by a file, including GitHub's -1/-2 duplicate suffixes."""
    anchors, seen = set(), {}
    in_fence = False
    for line in path.read_text(encoding="utf-8").split("\n"):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence or not line.startswith("#"):
            continue
        base = slugify(line.lstrip("#"))
        if not base:
            continue
        n = seen.get(base, 0)
        anchors.add(base if n == 0 else f"{base}-{n}")
        seen[base] = n + 1
    return anchors


def links(path: pathlib.Path):
    """(line_number, target) for each Markdown link outside fenced code."""
    in_fence = False
    for lineno, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for m in LINK.finditer(line):
            yield lineno, m.group(1)


def main() -> int:
    tracked = subprocess.run(
        ["git", "-C", str(REPO), "ls-files", "*.md"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    files = [f for f in tracked if not f.startswith(SKIP_PREFIXES)]

    anchor_cache = {}

    def anchors_of(rel: str):
        if rel not in anchor_cache:
            anchor_cache[rel] = headings(REPO / rel)
        return anchor_cache[rel]

    failures = []
    for rel in files:
        path = REPO / rel
        for lineno, target in links(path):
            if re.match(r"^[a-z][a-z0-9+.-]*:", target) or target.startswith("//"):
                continue  # external scheme
            file_part, _, anchor = target.partition("#")

            if not file_part:                       # same-file anchor
                dest_rel, dest_anchors = rel, anchors_of(rel)
            else:
                dest = (path.parent / file_part).resolve()
                try:
                    dest_rel = str(dest.relative_to(REPO))
                except ValueError:
                    continue                        # outside the repo
                if not dest.exists():
                    failures.append(f"{rel}:{lineno}: link target does not exist: {target}")
                    continue
                if not anchor:
                    continue
                if dest.suffix != ".md":
                    continue
                dest_anchors = anchors_of(dest_rel)

            if anchor and anchor not in dest_anchors:
                failures.append(
                    f"{rel}:{lineno}: anchor not found: {target}"
                    f"  (見出しが改名された可能性。{dest_rel} の見出しを確認)"
                )

    for f in failures:
        print(f"check-links: {f}", file=sys.stderr)
    if failures:
        return 1
    print(f"check-links: {len(files)} files, all intra-repo links resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
