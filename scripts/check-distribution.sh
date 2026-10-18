#!/usr/bin/env bash
# check-distribution.sh — consistency checks for the PDH distribution sets.
#
# fast-checks.sh can only forbid a pattern. These checks assert *presence* and
# *agreement between two lists*, which a grep rule cannot express. They run once
# per distribution set (claude/, codex/ — each has its own INSTALL.md), plus the
# shared docs/ that every set distributes:
#
#   1. every file declared as a "Based on" target carries that line, with a
#      path matching its own location in this repo
#   2. every copy-source named in the set's INSTALL.md placement table exists
#   3. every distributable file under <set>/templates/, <set>/skills/,
#      <set>/scripts/ and docs/ appears in that set's table
#   4. no rule is duplicated verbatim across the files one set distributes
#      (docs/ + that set). The two sets are forks of each other by design, so
#      identical lines *between* sets are not checked.
#
# Run from the repo root. Exit 0 = pass, 1 = at least one failure.
set -uo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

failed=0
fail() {
  printf 'check-distribution: %s\n' "$1" >&2
  failed=1
}

SETS=()
for d in claude codex; do
  [[ -f "$d/INSTALL.md" ]] && SETS+=("$d")
done
[[ "${#SETS[@]}" -gt 0 ]] || fail "no distribution set found (expected claude/INSTALL.md or codex/INSTALL.md)"

# --- 1. `Based on` lines ------------------------------------------------------
# Source-repo paths of the files each INSTALL.md declares as substitution
# targets. Shared docs are listed once; set files are relative to the set dir.
# Merged templates retain ancestry; overwritten payloads use .pdh-lock.
python3 scripts/check-placement.py || failed=1

TAB="$(printf '\t')"
DUP_MIN_BYTES=80

# Pairs whose overlap is intentional. Keep this list short and justified: every
# entry is a rule with two homes, which is what AI-1 exists to prevent.
dup_pair_allowed() {
  return 1
}

check_set() {
  local set="$1" install="$1/INSTALL.md"

  # --- placement table: rows look like | `tmp/pdh/<src>` | `<dst>` | <description> |
  local install_sources
  install_sources="$(
    grep -oE '\| `tmp/pdh/[^`]+`' "$install" | sed -e 's/^| `tmp\/pdh\///' -e 's/`$//'
  )"
  [[ -n "$install_sources" ]] || fail "$install: no placement-table rows found (the table format may have changed)"

  # --- 2. every copy-source in the table exists (paths are repo-root relative)
  while IFS= read -r src; do
    [[ -n "$src" ]] || continue
    if [[ "$src" == */ ]]; then
      [[ -d "${src%/}" ]] || fail "$install placement table lists '$src' but that directory does not exist"
    else
      [[ -f "$src" ]] || fail "$install placement table lists '$src' but that file does not exist"
    fi
  done <<< "$install_sources"

  # --- 3. every distributable file of this set is listed in its table
  while IFS= read -r dist; do
    [[ -n "$dist" ]] || continue
    local listed=0 src
    while IFS= read -r src; do
      [[ -n "$src" ]] || continue
      if [[ "$src" == "$dist" ]] || { [[ "$src" == */ ]] && [[ "$dist" == "$src"* ]]; }; then
        listed=1
        break
      fi
    done <<< "$install_sources"
    [[ "$listed" -eq 1 ]] || fail "$dist is distributable but is not listed in $install's placement table"
  done < <(git ls-files -- "$set/templates/*" "$set/skills/*" "$set/scripts/*" 'docs/*')


}

for set in "${SETS[@]}"; do check_set "$set"; done
python3 scripts/check-duplicates.py || failed=1

if [[ "$failed" -ne 0 ]]; then
  printf 'check-distribution: FAILED\n' >&2
  exit 1
fi
printf 'check-distribution: all checks passed (%s)\n' "${SETS[*]}"
