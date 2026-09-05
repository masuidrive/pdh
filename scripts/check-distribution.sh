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
BASED_ON_SHARED=(
  "docs/PDH-AGENTS.md"
  "docs/product-delivery-hierarchy.md"
)
based_on_set_files() {
  case "$1" in
    claude) printf '%s\n' \
      templates/CLAUDE.md templates/product-brief.md templates/technical-reference.md \
      templates/.ticket-config.yaml templates/checks/example-max-source-lines.check \
      templates/checks/example-max-test-lines.check \
      skills/pdh-check-writing/SKILL.md skills/pdh-coding/SKILL.md skills/pdh-dev/SKILL.md \
      skills/pdh-update/SKILL.md skills/pdh-reviewing/SKILL.md skills/pdh-verifying/SKILL.md \
      skills/pdh-decision-board/SKILL.md skills/tmux-director/SKILL.md ;;
    codex) printf '%s\n' \
      templates/AGENTS.md templates/product-brief.md templates/technical-reference.md \
      templates/.ticket-config.yaml templates/checks/example-max-source-lines.check \
      templates/checks/example-max-test-lines.check \
      skills/pdh-check-writing/SKILL.md skills/pdh-coding/SKILL.md skills/pdh-dev/SKILL.md \
      skills/pdh-update/SKILL.md skills/pdh-reviewing/SKILL.md skills/pdh-verifying/SKILL.md \
      skills/pdh-decision-board/SKILL.md ;;
  esac
}

check_based_on() {
  local file="$1" expected
  if [[ ! -f "$file" ]]; then
    fail "$file: declared as a Based-on target but the file does not exist"
    return
  fi
  expected="Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/$file"
  grep -qF "$expected" "$file" || fail "$file: missing or malformed Based-on line (expected: $expected)"
}
for file in "${BASED_ON_SHARED[@]}"; do check_based_on "$file"; done
for set in "${SETS[@]}"; do
  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    check_based_on "$set/$rel"
  done < <(based_on_set_files "$set")
done

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

  # --- 4. no rule duplicated verbatim across the files this set distributes
  # AI-1: a rule has exactly one home. The failure mode is copy-paste — the same
  # sentence lands in two files, then only one of them gets updated. Long
  # identical lines are a reliable signal; short ones are not, hence the floor.
  # The floor is in BYTES: 80 bytes is about 27 Japanese characters.
  local dup_report
  dup_report="$(
    git ls-files -- 'docs/*' "$set/skills/*" "$set/templates/*" \
      | grep -E '\.(md|yaml|toml)$' \
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
  local file_list line
  while IFS="$TAB" read -r file_list line; do
    [[ -n "$file_list" ]] || continue
    # shellcheck disable=SC2086
    set -- $file_list
    if [[ "$#" -eq 2 ]] && dup_pair_allowed "$1" "$2"; then
      continue
    fi
    fail "同一の行が複数の配布物にある（AI-1: ルールは 1 箇所にある）: $file_list
    $line"
  done <<< "$dup_report"
}

for set in "${SETS[@]}"; do check_set "$set"; done

if [[ "$failed" -ne 0 ]]; then
  printf 'check-distribution: FAILED\n' >&2
  exit 1
fi
printf 'check-distribution: all checks passed (%s)\n' "${SETS[*]}"
