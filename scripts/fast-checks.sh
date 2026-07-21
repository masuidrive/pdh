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
  local suffix recursive_dir
  parsed_glob_kind=""
  parsed_glob_dir=""
  parsed_glob_ext=""
  parsed_glob_suffix=""

  if [[ "$entry" == '**/*'* ]]; then
    suffix="${entry#'**/*'}"
    if (( ${#suffix} < 2 )) ||
      [[ "$suffix" != .* && "$suffix" != -* ]] ||
      [[ "$suffix" == */* || "$suffix" == *,* || "$suffix" == *[[:space:]]* ]] ||
      has_glob_metacharacter "$suffix"; then
      return 1
    fi
    parsed_glob_kind="repo_suffix"
    parsed_glob_suffix="$suffix"
  elif [[ "$entry" == '**/'*'/**' ]]; then
    recursive_dir="${entry#'**/'}"
    recursive_dir="${recursive_dir%'/**'}"
    if [[ -z "$recursive_dir" || "$entry" != "**/$recursive_dir/**" ||
      "$recursive_dir" == */* || "$recursive_dir" == *,* || "$recursive_dir" == *[[:space:]]* ]] ||
      has_glob_metacharacter "$recursive_dir"; then
      return 1
    fi
    parsed_glob_kind="recursive_dir"
    parsed_glob_dir="$recursive_dir"
  elif [[ "$entry" =~ ^([^*?,[:space:]]+)/\*\*$ ]]; then
    parsed_glob_kind="tree"
    parsed_glob_dir="${BASH_REMATCH[1]}"
  elif [[ "$entry" =~ ^([^*?,[:space:]]+)/\*\*/\*\.([^./*?,[:space:]]+)$ ]]; then
    parsed_glob_kind="extension"
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
    printf "fast-checks: %s: config error: %s entries must be <dir>/**, <dir>/**/*.<ext>, **/*<literal-suffix>, or **/<literal-dir>/**\n" "$check_file" "$key" >&2
    return 1
  fi

  IFS=',' read -r -a entries <<< "$value"
  for entry in "${entries[@]}"; do
    if ! parse_glob_entry "$entry"; then
      printf "fast-checks: %s: config error: invalid %s entry '%s'; expected <dir>/** or <dir>/**/*.<ext>, **/*<literal-suffix>, or **/<literal-dir>/**\n" "$check_file" "$key" "$entry" >&2
      return 1
    fi
  done
}

validate_allow_list() {
  local check_file="$1"
  local value="$2"
  local entry
  local entries=()

  if [[ "$value" == ,* || "$value" == *, || "$value" == *,,* ]]; then
    printf 'fast-checks: %s: config error: allow entries must be exact repo-relative file paths\n' "$check_file" >&2
    return 1
  fi

  IFS=',' read -r -a entries <<< "$value"
  for entry in "${entries[@]}"; do
    if [[ -z "$entry" || "$entry" == /* || "$entry" == ".." || "$entry" == ../* ||
      "$entry" == */../* || "$entry" == */.. ]] || has_glob_metacharacter "$entry"; then
      printf "fast-checks: %s: config error: invalid allow entry '%s'; expected an exact repo-relative file path\n" "$check_file" "$entry" >&2
      return 1
    fi
  done
}

# Decide whether a file matches <dir>/** or <dir>/**/*.<ext>. Centralizing glob /
# exclude matching in-script means the rg and grep paths apply identical semantics.
parse_linter_command() {
  local check_file="$1"
  local template="$2"
  local token
  local placeholder_count=0

  linter_tokens=()
  linter_mode=""
  IFS=$' \t\n' read -r -a linter_tokens <<< "$template"

  if (( ${#linter_tokens[@]} == 0 )) ||
    [[ "${linter_tokens[0]}" == '{{filename}}' || "${linter_tokens[0]}" == '{{filenames}}' ]]; then
    printf 'fast-checks: %s: config error: linter_command must start with a command token\n' "$check_file" >&2
    return 1
  fi

  for token in "${linter_tokens[@]}"; do
    case "$token" in
      '{{filename}}')
        placeholder_count=$((placeholder_count + 1))
        linter_mode="filename"
        ;;
      '{{filenames}}')
        placeholder_count=$((placeholder_count + 1))
        linter_mode="filenames"
        ;;
      *)
        if [[ "$token" == *'{{filename}}'* || "$token" == *'{{filenames}}'* ]]; then
          printf 'fast-checks: %s: config error: linter placeholder must be a standalone token\n' "$check_file" >&2
          return 1
        fi
        ;;
    esac
  done

  if [[ "$placeholder_count" -ne 1 ]]; then
    printf 'fast-checks: %s: config error: linter_command must contain exactly one {{filename}} or {{filenames}} placeholder\n' "$check_file" >&2
    return 1
  fi
}

# file が <dir>/** または <dir>/**/*.<ext> にマッチするか判定する。glob/exclude の適用をスクリプト内に
# 一元化し、rg/grep どちらの経路でも同じ判定を使う（Opus F1 / codex P2-1・P2-2）。
file_matches_glob_entry() {
  local file="$1"
  local entry="$2"

  parse_glob_entry "$entry" || return 1
  case "$parsed_glob_kind" in
    repo_suffix)
      case "$file" in
        *"$parsed_glob_suffix") return 0 ;;
        *) return 1 ;;
      esac
      ;;
    recursive_dir)
      case "/$file" in
        */"$parsed_glob_dir"/*) return 0 ;;
        *) return 1 ;;
      esac
      ;;
  esac
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
  max_lines=""
  linter_command=""
  glob=""
  exclude=""
  allow=""
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
      max_lines) max_lines="$value" ;;
      linter_command) linter_command="$value" ;;
      glob) glob="$value" ;;
      exclude) exclude="$value" ;;
      allow) allow="$value" ;;
      *)
        printf 'fast-checks: %s:%s: unknown key %s\n' "$check_file" "$config_line" "$key" >&2
        config_valid=0
        ;;
    esac
  done < "$check_file"

  for required_key in reason glob; do
    case "$required_key" in
      reason) required_value="$reason" ;;
      glob) required_value="$glob" ;;
    esac
    if [[ -z "$required_value" ]]; then
      printf 'fast-checks: %s: missing %s\n' "$check_file" "$required_key" >&2
      config_valid=0
    fi
  done

  linter_tokens=()
  linter_mode=""
  if [[ -n "$linter_command" ]]; then
    if [[ -n "$pattern" || -n "$max_lines" ]]; then
      printf 'fast-checks: %s: config error: pattern, max_lines, and linter_command are mutually exclusive\n' "$check_file" >&2
      config_valid=0
    elif ! parse_linter_command "$check_file" "$linter_command"; then
      config_valid=0
    fi
  else
    if [[ -n "$pattern" && -n "$max_lines" ]]; then
      printf 'fast-checks: %s: config error: pattern and max_lines are mutually exclusive\n' "$check_file" >&2
      config_valid=0
    elif [[ -z "$pattern" && -z "$max_lines" ]]; then
      printf 'fast-checks: %s: missing pattern or max_lines\n' "$check_file" >&2
      config_valid=0
    fi
  fi

  if [[ -n "$pattern" ]] && ! validate_pattern_dialect "$check_file" "$pattern"; then
    config_valid=0
  fi

  if [[ -n "$max_lines" && ! "$max_lines" =~ ^[1-9][0-9]*$ ]]; then
    printf 'fast-checks: %s: config error: max_lines must be a positive decimal integer\n' "$check_file" >&2
    config_valid=0
  fi

  if [[ -n "$pattern" && -n "$allow" ]]; then
    printf 'fast-checks: %s: config error: allow is only valid with max_lines\n' "$check_file" >&2
    config_valid=0
  elif [[ -n "$allow" ]] && ! validate_allow_list "$check_file" "$allow"; then
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
  allow_files=()
  if [[ -n "$allow" ]]; then
    IFS=',' read -r -a allow_files <<< "$allow"
  fi

  if ! validate_glob_list "$check_file" "glob" "$glob"; then
    failed=1
    continue
  fi
  if [[ -n "$exclude" ]] && ! validate_glob_list "$check_file" "exclude" "$exclude"; then
    failed=1
    continue
  fi

  if [[ -n "$linter_command" ]] && ! command -v -- "${linter_tokens[0]}" >/dev/null 2>&1; then
    printf 'fast-checks: %s: linter not found: %s\n' "$check_id" "${linter_tokens[0]}" >&2
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

      allowed=0
      if (( ${#allow_files[@]} > 0 )); then
        for allow_file in "${allow_files[@]}"; do
          if [[ "$file" == "$allow_file" ]]; then
            allowed=1
            break
          fi
        done
      fi
      [[ "$allowed" -eq 1 ]] && continue

      matched_files+=("$file")
    done
  fi

  if (( ${#matched_files[@]} == 0 )); then
    continue
  fi

  if [[ -n "$max_lines" ]]; then
    for matched_file in "${matched_files[@]}"; do
      if ! line_count="$(wc -l < "$matched_file")"; then
        printf 'fast-checks: %s: wc failed for %s\n' "$check_id" "$matched_file" >&2
        failed=1
        continue
      fi
      line_count="${line_count//[[:space:]]/}"
      if (( line_count > max_lines )); then
        printf '%s: %s: %s lines > max %s: %s\n' "$check_id" "$matched_file" "$line_count" "$max_lines" "$reason"
        failed=1
      fi
    done
    continue
  fi

  if [[ -n "$linter_command" ]]; then
    linter_file_args=()
    for matched_file in "${matched_files[@]}"; do
      if [[ "$matched_file" == -* ]]; then
        linter_file_args+=("./$matched_file")
      else
        linter_file_args+=("$matched_file")
      fi
    done

    if [[ "$linter_mode" == "filename" ]]; then
      linter_index=0
      for matched_file in "${matched_files[@]}"; do
        linter_argv=()
        for token in "${linter_tokens[@]}"; do
          if [[ "$token" == '{{filename}}' ]]; then
            linter_argv+=("${linter_file_args[$linter_index]}")
          else
            linter_argv+=("$token")
          fi
        done
        linter_output="$("${linter_argv[@]}" 2>&1)"
        linter_status=$?
        if [[ "$linter_status" -ne 0 ]]; then
          printf '%s: linter failed for %s (exit %s): %s\n' "$check_id" "$matched_file" "$linter_status" "$reason"
          [[ -z "$linter_output" ]] || printf '%s\n' "$linter_output"
          failed=1
        fi
        linter_index=$((linter_index + 1))
      done
    else
      linter_argv=()
      for token in "${linter_tokens[@]}"; do
        if [[ "$token" == '{{filenames}}' ]]; then
          linter_argv+=("${linter_file_args[@]}")
        else
          linter_argv+=("$token")
        fi
      done
      linter_output="$("${linter_argv[@]}" 2>&1)"
      linter_status=$?
      if [[ "$linter_status" -ne 0 ]]; then
        printf '%s: linter failed for %s files (exit %s): %s\n' "$check_id" "${#matched_files[@]}" "$linter_status" "$reason"
        [[ -z "$linter_output" ]] || printf '%s\n' "$linter_output"
        failed=1
      fi
    fi
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
