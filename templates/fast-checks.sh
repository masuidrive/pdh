#!/usr/bin/env bash
# fast-checks.sh — declarative, deterministic invariant checks for PDH projects.
#
# A "fast-check" is a super-lightweight, language-agnostic lint rule: one forbidden
# pattern per file under scripts/checks/*.check. It is NOT a general style linter
# (that is tsc/eslint/ruff, run separately); it encodes institutional memory —
# "this exact bad pattern shipped once, never again" — as a cheap grep the whole
# team's CI runs on every change, in the same deterministic gate as the type
# checker. Use it for invariants too repo-specific for a general linter and not
# worth (or not expressible as) a unit test.
#
# NOTE: the npm library `fast-check` (property-based testing) is a DIFFERENT thing
# that only shares the name. This script is a bash grep runner, not that library.
#
# Each scripts/checks/<id>.check is key=value:
#   reason=<human explanation printed on failure>
#   pattern=<POSIX ERE forbidden pattern>          (required)
#   glob=<dir>/** or <dir>/**/*.<ext>[,<more>]     (required; comma-separated)
#   exclude=<same glob forms>                       (optional)
# A source line may opt out with a `checks-allow: <id>` comment (token-bounded).
#
# See scripts/checks/README.md for the format in full.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKS_DIR="${CHECKS_DIR:-$SCRIPT_DIR/checks}"

# Portable millisecond clock: node, then python3, then coarse `date` seconds.
now_ms() {
  if command -v node >/dev/null 2>&1; then
    node -p 'Date.now()'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(int(time.time()*1000))'
  else
    echo $(( $(date +%s) * 1000 ))
  fi
}

start_ms="$(now_ms)"
failed=0
check_count=0

if command -v rg >/dev/null 2>&1; then
  search_command="rg"
else
  search_command="grep"
fi

# pattern must be POSIX ERE. rg (which also accepts PCRE tokens like \d \s \w \b
# \p{...} (?...)) and BSD grep -E interpret those differently, so reject the
# ambiguous dialect tokens here to keep both backends identical.
FORBIDDEN_PATTERN_TOKENS=('\p{' '(?' '\d' '\s' '\w' '\b')

validate_pattern_dialect() {
  local check_file="$1"
  local pattern="$2"
  local token

  for token in "${FORBIDDEN_PATTERN_TOKENS[@]}"; do
    if [[ "$pattern" == *"$token"* ]]; then
      printf "fast-checks: %s: config error: pattern must be POSIX ERE; unsupported token '%s' (use e.g. [[:space:]] instead of \\\\s)\n" "$check_file" "$token" >&2
      return 1
    fi
  done
  return 0
}

parse_glob_entry() {
  local entry="$1"
  parsed_glob_dir=""
  parsed_glob_ext=""

  if [[ "$entry" =~ ^([^*?,[:space:]]+)/\*\*$ ]]; then
    parsed_glob_dir="${BASH_REMATCH[1]}"
  elif [[ "$entry" =~ ^([^*?,[:space:]]+)/\*\*/\*\.([^./*?,[:space:]]+)$ ]]; then
    parsed_glob_dir="${BASH_REMATCH[1]}"
    parsed_glob_ext="${BASH_REMATCH[2]}"
  else
    return 1
  fi

  if has_glob_metacharacter "$parsed_glob_dir" || has_glob_metacharacter "$parsed_glob_ext"; then
    return 1
  fi
}

has_glob_metacharacter() {
  local value="$1"
  [[ "$value" == *"*"* || "$value" == *"?"* || "$value" == *"["* || "$value" == *"]"* ||
    "$value" == *"{"* || "$value" == *"}"* || "$value" == *"\\"* ]]
}

validate_glob_list() {
  local check_file="$1"
  local key="$2"
  local value="$3"
  local entry
  local entries=()

  if [[ "$value" == ,* || "$value" == *, || "$value" == *,,* ]]; then
    printf "fast-checks: %s: config error: %s entries must be <dir>/** or <dir>/**/*.<ext>\n" "$check_file" "$key" >&2
    return 1
  fi

  IFS=',' read -r -a entries <<< "$value"
  for entry in "${entries[@]}"; do
    if ! parse_glob_entry "$entry"; then
      printf "fast-checks: %s: config error: invalid %s entry '%s'; expected <dir>/** or <dir>/**/*.<ext>\n" "$check_file" "$key" "$entry" >&2
      return 1
    fi
  done
}

# Decide whether a file matches <dir>/** or <dir>/**/*.<ext>. Centralizing glob /
# exclude matching in-script means the rg and grep paths apply identical semantics.
file_matches_glob_entry() {
  local file="$1"
  local entry="$2"

  parse_glob_entry "$entry" || return 1
  case "$file" in
    "$parsed_glob_dir"/*) ;;
    *) return 1 ;;
  esac
  if [[ -n "$parsed_glob_ext" ]]; then
    case "$file" in
      *".$parsed_glob_ext") ;;
      *) return 1 ;;
    esac
  fi
  return 0
}

# `checks-allow: <check-id>` suppresses a match only when the id is followed by
# end-of-line, whitespace, or comma. A pure prefix test would let "foo" allow
# "checks-allow: foo-bar" too.
line_allows_check() {
  local line="$1"
  local check_id="$2"
  local marker="checks-allow: $check_id"
  local remainder="$line"
  local suffix next_char

  while [[ "$remainder" == *"$marker"* ]]; do
    suffix="${remainder#*"$marker"}"
    next_char="${suffix:0:1}"
    case "$next_char" in
      ""|" "|$'\t'|",") return 0 ;;
    esac
    remainder="$suffix"
  done
  return 1
}

# The file universe = tracked files + untracked-not-ignored
# (`git ls-files -z --cached --others --exclude-standard`). Force-tracked ignored
# files are in the tracked set, so both are covered. glob/exclude match this
# explicit list in-script, and both the rg and grep paths run against the same
# list, erasing per-backend ignore/exclude semantic differences.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'fast-checks: not inside a git work tree (git ls-files is required to enumerate checked files)\n' >&2
  exit 1
fi

universe_files=()
while IFS= read -r -d '' file; do
  universe_files+=("$file")
done < <(git ls-files -z --cached --others --exclude-standard)

shopt -s nullglob
check_files=("$CHECKS_DIR"/*.check)

# bash 3.2 (macOS default) crashes expanding an empty nullglob array under
# `set -u`, so check the element count before expanding.
if (( ${#check_files[@]} > 0 )); then
for check_file in "${check_files[@]}"; do
  check_count=$((check_count + 1))
  check_id="$(basename "$check_file" .check)"
  reason=""
  pattern=""
  glob=""
  exclude=""
  config_valid=1
  config_line=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    config_line=$((config_line + 1))
    case "$line" in
      ""|\#*) continue ;;
    esac

    if [[ "$line" != *=* ]]; then
      printf 'fast-checks: %s:%s: expected key=value\n' "$check_file" "$config_line" >&2
      config_valid=0
      continue
    fi

    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      reason) reason="$value" ;;
      pattern) pattern="$value" ;;
      glob) glob="$value" ;;
      exclude) exclude="$value" ;;
      *)
        printf 'fast-checks: %s:%s: unknown key %s\n' "$check_file" "$config_line" "$key" >&2
        config_valid=0
        ;;
    esac
  done < "$check_file"

  for required_key in reason pattern glob; do
    case "$required_key" in
      reason) required_value="$reason" ;;
      pattern) required_value="$pattern" ;;
      glob) required_value="$glob" ;;
    esac
    if [[ -z "$required_value" ]]; then
      printf 'fast-checks: %s: missing %s\n' "$check_file" "$required_key" >&2
      config_valid=0
    fi
  done

  if [[ -n "$pattern" ]] && ! validate_pattern_dialect "$check_file" "$pattern"; then
    config_valid=0
  fi

  if [[ "$config_valid" -eq 0 ]]; then
    failed=1
    continue
  fi

  IFS=',' read -r -a include_globs <<< "$glob"
  exclude_globs=()
  if [[ -n "$exclude" ]]; then
    IFS=',' read -r -a exclude_globs <<< "$exclude"
  fi

  if ! validate_glob_list "$check_file" "glob" "$glob"; then
    failed=1
    continue
  fi
  if [[ -n "$exclude" ]] && ! validate_glob_list "$check_file" "exclude" "$exclude"; then
    failed=1
    continue
  fi

  matched_files=()
  if (( ${#universe_files[@]} > 0 )); then
    for file in "${universe_files[@]}"; do
      included=0
      for include_glob in "${include_globs[@]}"; do
        if file_matches_glob_entry "$file" "$include_glob"; then
          included=1
          break
        fi
      done
      [[ "$included" -eq 1 ]] || continue

      excluded=0
      if (( ${#exclude_globs[@]} > 0 )); then
        for exclude_glob in "${exclude_globs[@]}"; do
          if file_matches_glob_entry "$file" "$exclude_glob"; then
            excluded=1
            break
          fi
        done
      fi
      [[ "$excluded" -eq 1 ]] && continue

      matched_files+=("$file")
    done
  fi

  if (( ${#matched_files[@]} == 0 )); then
    continue
  fi

  if [[ "$search_command" == "rg" ]]; then
    matches="$(rg -n -H --no-heading --color never -e "$pattern" -- "${matched_files[@]}" 2>&1)"
  else
    matches="$(grep -n -H -E -e "$pattern" -- "${matched_files[@]}" 2>&1)"
  fi
  search_status=$?

  if [[ "$search_status" -gt 1 ]]; then
    printf 'fast-checks: %s: %s failed: %s\n' "$check_id" "$search_command" "$matches" >&2
    failed=1
    continue
  fi
  [[ "$search_status" -eq 1 ]] && continue

  while IFS= read -r match; do
    matched_file="${match%%:*}"
    remainder="${match#*:}"
    matched_line="${remainder%%:*}"
    source_line="${remainder#*:}"
    if line_allows_check "$source_line" "$check_id"; then
      continue
    fi
    printf '%s: %s:%s: %s\n' "$check_id" "$matched_file" "$matched_line" "$reason"
    failed=1
  done <<< "$matches"
done
fi

end_ms="$(now_ms)"
elapsed_ms=$((end_ms - start_ms))

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

printf 'fast-checks: %s checks passed (%s ms)\n' "$check_count" "$elapsed_ms"
