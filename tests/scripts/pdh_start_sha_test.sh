#!/usr/bin/env bash
# ticket を始めた SHA が、base の取り込み・base への ticket の commit の吸収・空の差分で動かないことを検査する。
set -uo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
TMP_DIR=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
must() { "$@" >/dev/null || fail "準備コマンドが失敗しました: $*"; }
checks=0
expect() {
  local expected=$1 label=$2 actual
  shift 2
  output=$("$@" 2>&1); actual=$?
  [ "$actual" -eq "$expected" ] || fail "$label: exit $actual（期待 $expected）: $output"
  checks=$((checks + 1))
}
same() { [ "$output" = "$1" ] || fail "$2: 出力 '$output'（期待 '$1'）"; }
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR=
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
day=0
commit() {
  day=$((day + 1))
  GIT_AUTHOR_DATE="2026-01-$(printf %02d "$day")T00:00:00Z" GIT_COMMITTER_DATE="2026-01-$(printf %02d "$day")T00:00:00Z" \
    git commit -q --allow-empty -m "$1" || fail "commit $1"
}
merge() {
  day=$((day + 1))
  GIT_AUTHOR_DATE="2026-01-$(printf %02d "$day")T00:00:00Z" GIT_COMMITTER_DATE="2026-01-$(printf %02d "$day")T00:00:00Z" \
    git merge -q --no-ff --no-edit "$1" || fail "merge $1"
}
start_sha() { bash scripts/pdh-review-range.sh tickets/t1 --start; }

must mkdir -p "$TMP_DIR/repo/scripts" "$TMP_DIR/repo/tickets/t1"
must cp "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/repo/scripts/"
must cd "$TMP_DIR/repo"
must git init -q -b main
printf 'base\n' > app.txt
must git add -A
commit init
printf -- '---\nstarted_at: null\n---\n' > tickets/t1/ticket.md
printf '# progress\n' > tickets/t1/progress.md
must git add -A
commit 'Add ticket'
base=$(git rev-parse HEAD)

# 通常の branch: [start] の commit と作業の commit がある
must git switch -q -c features/t1
printf -- '---\nstarted_at: 2026-01-03T00:00:00Z\n---\n' > tickets/t1/ticket.md
must git add -A
commit '[start] features/t1'
start_commit=$(git rev-parse HEAD)
printf 'work 1\n' >> app.txt
must git add -A
commit 'work 1'
expect 0 '通常の branch' start_sha
same "$base start-commit" '通常の branch'

# 空の差分: [start] だけで、base が [start] へ fast-forward している（./ticket.sh start の base の前進）
must git switch -q -c features/empty "$start_commit"
must git branch -f main "$start_commit"
must mkdir -p tickets/empty
must git switch -q features/t1

# base の取り込み: base に別の commit が入り、branch がそれを merge する
must git switch -q main
commit 'upstream 1'
must git switch -q features/t1
merge main
expect 0 'base を取り込んだ branch' start_sha
same "$base start-commit" 'base を取り込んだ branch'

# base が ticket の commit を一部吸収する: base が branch の途中を merge し、branch はその後も進む
must git switch -q main
merge features/t1
must git switch -q features/t1
printf 'work 2\n' >> app.txt
must git add -A
commit 'work 2'
expect 0 'base が一部を吸収した branch' start_sha
same "$base start-commit" 'base が一部を吸収した branch'

# progress の start-sha: 行が最優先で、記録の SHA を全桁で返す
printf -- '- start-sha: %s（PDH-open で記録）\n' "${base:0:12}" >> tickets/t1/progress.md
expect 0 'progress の記録' start_sha
same "$base progress" 'progress の記録'

# 空の差分の ticket
must git switch -q features/empty
must mkdir -p tickets/empty
printf '# progress\n' > tickets/empty/progress.md
printf -- '---\nstarted_at: null\n---\n' > tickets/empty/ticket.md
git_subject=$(git log -1 --format=%s)
[ "$git_subject" = '[start] features/t1' ] || fail "fixture: features/empty の tip が [start] ではない（$git_subject）"
# 名前の違う ticket の [start] は使わない
expect 3 '[start] が別の ticket のもの' bash scripts/pdh-review-range.sh tickets/empty --start
# [start] の題が ticket 名と一致すれば、差分が空でも親を返す
must git commit -q --amend --allow-empty -m '[start] features/empty'
expect 0 '空の差分' bash scripts/pdh-review-range.sh tickets/empty --start
same "$base start-commit" '空の差分'

# [start] が無く started_at だけがある（squash などで題が消えた）
must git switch -q -c features/squashed "$base"
printf -- '---\nstarted_at: 2026-01-02T12:00:00Z\n---\n' > tickets/t1/ticket.md
printf '# progress\n' > tickets/t1/progress.md
must git add -A
commit 'squashed work'
expect 0 'started_at から復元' start_sha
same "$base started-at" 'started_at から復元'

# どれからも取れない: 由来は未判定
printf -- '---\nstarted_at: null\n---\n' > tickets/t1/ticket.md
expect 3 '取れない' start_sha
[[ "$output" == *未判定* ]] || fail "取れないときに未判定と書いていない: $output"

printf 'pdh_start_sha_test: %d checks passed\n' "$checks"
