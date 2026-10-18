#!/usr/bin/env bash
# Status の読み取りだけを実行し、GitHub への操作を起こさない。
set -euo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
awk '/^read_status\(\)/{copy=1} copy{print} copy && /^}$/{exit}' \
  "$ROOT_DIR/.github/coding-bot/pdh-hooks.sh" > "$tmp_dir/read-status.sh"
source "$tmp_dir/read-status.sh"

expect_status() {
  local expected=$1 actual
  actual=$(read_status "$tmp_dir/note.md")
  if [ "$actual" != "$expected" ]; then
    printf 'FAIL: expected Status <%s>, got <%s>\n' "$expected" "$actual" >&2
    exit 1
  fi
}
expect_status ''
printf '## Status: PDH-implement (Implementing)\n' > "$tmp_dir/note.md"
expect_status PDH-implement
printf 'coding_bot_pdh_status_test: 2 cases passed\n'
