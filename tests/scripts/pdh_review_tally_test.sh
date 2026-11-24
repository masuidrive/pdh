#!/usr/bin/env bash
# 現行の判定・巡、旧表の保持、処置の変更を隔離した repo で検査する。
set -uo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
TMP_DIR=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
must() { "$@" || fail "準備コマンドが失敗しました: $*"; }
checks=0
expect() {
  local expected=$1 label=$2 actual
  shift 2
  output=$("$@" 2>&1); actual=$?
  [ "$actual" -eq "$expected" ] || fail "$label: exit ${actual}（期待 ${expected}）: $output"
  checks=$((checks + 1))
}
contains() { [[ "$output" == *"$1"* ]] || fail "出力に $1 がありません: $output"; }
excludes() { [[ "$output" != *"$1"* ]] || fail "出力に $1 が混入しました: $output"; }
header() { printf '### Findings-PDH-review-%s\n\n| # | 要旨 | 頻度と 1 回のコスト | 判定 | 由来 |\n|---|---|---|---|---|\n' "$1"; }
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR= GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
must mkdir -p "$TMP_DIR/repo/scripts" "$TMP_DIR/repo/work items/alpha" "$TMP_DIR/repo/work items/done/beta" "$TMP_DIR/repo/work items/old" "$TMP_DIR/repo/work items/empty"
must cp "$ROOT_DIR/scripts/pdh-review-tally.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/repo/scripts/"
must cd "$TMP_DIR/repo"
must git init -q -b main
printf 'tickets_dir: "./work items/" # quoted path\n' > .ticket-config.yaml
{
  printf 'review-sha: ABCDEF0 details\n- review-sha: abcdef0\nreview-sha: 1234567(rest)\n'
  header 1
  printf '| 1 | first | 実測 1%%・担当 1 分 | 起票する | 既存 |\n'
  printf '| 2 | second | 0・誤検出 | 棄却する | 既存 |\n\n'
  printf 'PDH-review-1 #1 処置の変更: 起票する → 受け入れる — 許容内\n'
  printf 'PDH-review-1 #1 処置の変更: 受け入れる → いま直す — 目安超過\n'
  printf 'PDH-review-9 #1 処置の変更: 起票する → 棄却する — unknown finding\n'
  header 2
  printf '| 1 | third | 推定 月 1 回・100 円 | 記録だけ残す | 既存 |\n\n'
  printf '処置の変更: 記録だけ残す → 起票する — 直す予定（PDH-review-2 #1）\n'
  printf '| 99 | unrelated table | 0 | 棄却する | 既存 |\n'
} > 'work items/alpha/progress.md'
{
  printf 'review-sha: fedcba9876543210fedcba9876543210fedcba98 explanation\n'
  header 1
  printf '| 1 | fourth | 推定 月 0.1 回・担当 2 分 | 受け入れる | この ticket |\n'
  printf '| 2 | fifth | 推定 月 0 回・0 円 | 記録だけ残す | 観察 |\n'
} > 'work items/done/beta/progress.md'
printf '### Findings-PDH-review-1\n| # | 出した人 | 観点 | Sev | 要旨 | 判定 | 記録先 | 理由 |\n| 1 | DA | AC | Major | old | いま直す | — | 既存 |\n\nPDH-review-1 #1 処置の変更: いま直す → 記録だけ残す — constraint-accepted\n' > 'work items/old/progress.md'
: > 'work items/empty/progress.md'
expect 0 '全 ticket の現行表の判定と巡' bash scripts/pdh-review-tally.sh
contains '| いま直す | 1 |'
contains '| 起票する | 1 |'
contains '| 受け入れる | 1 |'
contains '| 記録だけ残す | 1 |'
contains '| 棄却する | 1 |'
contains '| alpha | 2 |'
contains '| beta | 1 |'
contains '1 巡で抜けた ticket: 1 / 2 (50.0%)'
contains '現行表がない ticket の数: 2'
excludes '出した人ごと'
excludes '観点 |'
expect 0 '対象の指定と重複の除去' bash scripts/pdh-review-tally.sh --ticket 'work items/alpha' --ticket 'work items/done/beta' --ticket 'work items/alpha/'
contains '| 起票する | 1 |'
contains '現行表がない ticket の数: 0'
must cd 'work items'
expect 0 '子ディレクトリから全件' bash ../scripts/pdh-review-tally.sh
contains '1 巡で抜けた ticket: 1 / 2 (50.0%)'
expect 0 '子ディレクトリから相対パス' bash ../scripts/pdh-review-tally.sh --ticket empty
contains '1 巡で抜けた ticket: 0 / 0 (0.0%)'
must cd ..
expect 0 'ヘルプ' bash scripts/pdh-review-tally.sh --help
contains '--ticket <dir>'
expect 0 '短いヘルプ' bash scripts/pdh-review-tally.sh -h
expect 2 '引数不足' bash scripts/pdh-review-tally.sh --ticket
expect 2 '不明な引数' bash scripts/pdh-review-tally.sh --other
expect 2 '存在しない ticket' bash scripts/pdh-review-tally.sh --ticket missing
must mkdir no-progress
expect 2 'progress の欠落' bash scripts/pdh-review-tally.sh --ticket no-progress
# 出荷済みの commit を指す後続の欠陥を元の ticket ごとに数える。
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
must git add .
must git -c commit.gpgsign=false commit -qm '[beta] shipped behavior'
origin=$(git rev-parse HEAD)
{
  printf '\n'
  header 3
  printf '| 1 | shipped defect | 月1回・1分 | いま直す | 持ち込み: %s と 持ち込み: %s |\n' "$origin" "${origin:0:8}"
  printf '| 2 | false report | 0 | 棄却する | 上流 %s |\n' "$origin"
  printf '| 3 | starting revision | 月1回・1分 | 受け入れる | 既存 %s |\n' "$origin"
  printf '| 4 | bare revision | 月1回・1分 | 受け入れる | %s |\n' "$origin"
} >> 'work items/alpha/progress.md'
expect 0 '出荷後の欠陥を元 ticket へ一度だけ数える' bash scripts/pdh-review-tally.sh
contains '| beta | 1 |'
section=${output##*'### ticket ごとの出荷後の欠陥'}
[[ "$section" == *'| beta | 1 |'* && "$section" == *'| alpha | 0 |'* ]] || fail "$section"
expect 0 '照らし直しの件数は同じ表の parser を使う' bash scripts/pdh-review-tally.sh --round-counts --ticket 'work items/alpha'
contains $'PDH-review-1\t0\t1\t3'
contains $'PDH-review-3\t1\t1\t3'
printf 'PASS: AC12 shipped defect count=1 (duplicate SHA and rejected finding excluded)\n'
printf '| 5 | upstream defect | 月1回・1分 | 受け入れる | 上流 %s |\n' "$origin" >> 'work items/alpha/progress.md'
expect 0 '上流の持ち込みも数える' bash scripts/pdh-review-tally.sh
section=${output##*'### ticket ごとの出荷後の欠陥'}
[[ "$section" == *'| beta | 2 |'* ]] || fail "$section"
printf 'PASS: explicit origin keys count=2 (starting and bare SHA excluded)\n'

printf 'tickets_dir: absent\n' > .ticket-config.yaml
expect 2 'tickets_dir の欠落' bash scripts/pdh-review-tally.sh
must mkdir absent
expect 0 '空のディレクトリ' bash scripts/pdh-review-tally.sh
contains '1 巡で抜けた ticket: 0 / 0 (0.0%)'
contains '現行表がない ticket の数: 0'
printf 'PASS: pdh-review-tally (%d checks)\n' "$checks"
