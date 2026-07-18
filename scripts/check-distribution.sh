#!/usr/bin/env bash
# check-distribution.sh — consistency checks for the PDH distribution set.
#
# fast-checks.sh can only forbid a pattern. These checks assert *presence* and
# *agreement between two lists*, which a grep rule cannot express:
#
#   1. every file declared in README's "Based on" list carries that line, with a
#      path matching its own location in this repo
#   2. every copy-source named in README's placement table (§2) exists
#   3. every distributable file under templates/ and skills/ appears in that table
#
# Run from the repo root. Exit 0 = pass, 1 = at least one failure.
set -uo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

failed=0
fail() {
  printf 'check-distribution: %s\n' "$1" >&2
  failed=1
}

# --- 1. `Based on` lines ------------------------------------------------------
# Source-repo paths of the files README declares as substitution targets.
BASED_ON_FILES=(
  "templates/CLAUDE.md"
  "templates/product-brief.md"
  "templates/technical-reference.md"
  "templates/.ticket-config.yaml"
  "docs/product-delivery-hierarchy.md"
  "skills/tmux-director/SKILL.md"
)

for file in "${BASED_ON_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    fail "$file: declared as a Based-on target but the file does not exist"
    continue
  fi
  expected="Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/$file"
  if ! grep -qF "$expected" "$file"; then
    fail "$file: missing or malformed Based-on line (expected: $expected)"
  fi
done

# --- README placement table ---------------------------------------------------
# Rows look like: | `tmp/pdh/<src>` | `<dst>` | <description> |
readme_sources="$(
  grep -oE '\| `tmp/pdh/[^`]+`' README.md | sed -e 's/^| `tmp\/pdh\///' -e 's/`$//'
)"

if [[ -z "$readme_sources" ]]; then
  fail "README.md: no placement-table rows found (the table format may have changed)"
fi

# --- 2. every copy-source in the table exists ---------------------------------
while IFS= read -r src; do
  [[ -n "$src" ]] || continue
  # A trailing slash denotes a directory copy (e.g. templates/checks/).
  if [[ "$src" == */ ]]; then
    [[ -d "${src%/}" ]] || fail "README.md placement table lists '$src' but that directory does not exist"
  else
    [[ -f "$src" ]] || fail "README.md placement table lists '$src' but that file does not exist"
  fi
done <<< "$readme_sources"

# --- 3. every distributable file is listed in the table -----------------------
# Only files that ship to a consuming project. Registry contents under
# templates/checks/ ship as a directory row, so match the row's directory prefix.
while IFS= read -r dist; do
  [[ -n "$dist" ]] || continue
  listed=0
  while IFS= read -r src; do
    [[ -n "$src" ]] || continue
    if [[ "$src" == "$dist" ]] || { [[ "$src" == */ ]] && [[ "$dist" == "$src"* ]]; }; then
      listed=1
      break
    fi
  done <<< "$readme_sources"
  [[ "$listed" -eq 1 ]] || fail "$dist is distributable but is not listed in README's placement table (§2)"
done < <(git ls-files -- 'templates/*' 'skills/*' 'docs/*' 'scripts/hookbus.js')

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

printf 'check-distribution: distribution set consistent\n'
