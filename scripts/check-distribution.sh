#!/usr/bin/env bash
# check-distribution.sh — consistency checks for the PDH distribution set.
#
# fast-checks.sh can only forbid a pattern. These checks assert *presence* and
# *agreement between two lists*, which a grep rule cannot express:
#
#   1. every file declared in INSTALL.md's "Based on" list carries that line, with a
#      path matching its own location in this repo
#   2. every copy-source named in INSTALL.md's placement table (§2) exists
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
# Source-repo paths of the files INSTALL.md declares as substitution targets.
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

# --- INSTALL.md placement table -----------------------------------------------
# Rows look like: | `tmp/pdh/<src>` | `<dst>` | <description> |
install_sources="$(
  grep -oE '\| `tmp/pdh/[^`]+`' INSTALL.md | sed -e 's/^| `tmp\/pdh\///' -e 's/`$//'
)"

if [[ -z "$install_sources" ]]; then
  fail "INSTALL.md: no placement-table rows found (the table format may have changed)"
fi

# --- 2. every copy-source in the table exists ---------------------------------
while IFS= read -r src; do
  [[ -n "$src" ]] || continue
  # A trailing slash denotes a directory copy (e.g. templates/checks/).
  if [[ "$src" == */ ]]; then
    [[ -d "${src%/}" ]] || fail "INSTALL.md placement table lists '$src' but that directory does not exist"
  else
    [[ -f "$src" ]] || fail "INSTALL.md placement table lists '$src' but that file does not exist"
  fi
done <<< "$install_sources"

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
  done <<< "$install_sources"
  [[ "$listed" -eq 1 ]] || fail "$dist is distributable but is not listed in INSTALL.md's placement table (§2)"
done < <(git ls-files -- 'templates/*' 'skills/*' 'docs/*' 'scripts/hookbus.js')

# --- 4. no rule duplicated verbatim across distributed files ------------------
# AI-1: a rule has exactly one home. The failure mode is copy-paste — the same
# sentence lands in two files, then only one of them gets updated. Long identical
# lines are a reliable signal of that; short ones (headings, table separators,
# list scaffolding) are not, hence the length floor.
#
# The floor is in BYTES, so Japanese prose (3 bytes/char in UTF-8) trips it at
# roughly a third of the character count. 80 bytes is about 27 Japanese
# characters or 80 ASCII ones — long enough to be a real sentence.
DUP_MIN_BYTES=80

# Pairs whose overlap is intentional. Keep this list short and justified: every
# entry is a rule with two homes, which is what AI-1 exists to prevent.
#   docs/product-delivery-hierarchy.md + templates/.ticket-config.yaml
#     The config embeds the literal ticket template that ticket.sh writes into
#     each new ticket; the doc explains that same template to the reader. The
#     config copy is machine-consumed and cannot be replaced by a reference.
dup_pair_allowed() {
  local a="$1" b="$2"
  case "$a|$b" in
    "docs/product-delivery-hierarchy.md|templates/.ticket-config.yaml") return 0 ;;
  esac
  return 1
}

# Emit one record per duplicated line: "<space-separated files>\t<line>".
# Grouping happens in awk over a line-sorted stream, so each distinct line is
# seen as one contiguous run.
TAB="$(printf '\t')"
dup_report="$(
  git ls-files -- 'docs/*' 'skills/*' 'templates/*' \
    | grep -E '\.(md|yaml)$' \
    | while IFS= read -r file; do
        awk -v F="$file" -v MIN="$DUP_MIN_BYTES" '
          { line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line) }
          length(line) >= MIN { print line "\t" F }
        ' "$file"
      done \
    | sort -u \
    | awk -F"$TAB" '
        function flush() { if (n > 1) print files "\t" prev }
        $1 == prev { files = files " " $2; n++; next }
        { flush(); prev = $1; files = $2; n = 1 }
        END { flush() }
      '
)"

while IFS="$TAB" read -r file_list line; do
  [[ -n "$file_list" ]] || continue
  # shellcheck disable=SC2086
  set -- $file_list
  if [[ "$#" -eq 2 ]] && dup_pair_allowed "$1" "$2"; then
    continue
  fi
  fail "同一の行が複数の配布物にある（AI-1: ルールの正は 1 箇所）: $file_list
    > ${line:0:70}"
done <<< "$dup_report"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

printf 'check-distribution: distribution set consistent\n'
