#!/usr/bin/env bash
# reviewer・判定・巡・観点の集計契約を、隔離した repo の記録で検査する。
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
  [ "$actual" -eq "$expected" ] || fail "$label: exit $actual（期待 $expected）: $output"
  checks=$((checks + 1))
}
contains() { [[ "$output" == *"$1"* ]] || fail "出力に $1 がありません: $output"; }
excludes() { [[ "$output" != *"$1"* ]] || fail "出力に $1 が混入しました: $output"; }
header() {
  printf '### Findings-PDH-review-%s\n\n| # | 出した人 | 観点 | Sev | 要旨 | 判定 | 記録先 | 理由 |\n|---|---|---|---|---|---|---|---|\n' "$1"
}
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR=
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
must mkdir -p "$TMP_DIR/repo/scripts" "$TMP_DIR/repo/work items/alpha" "$TMP_DIR/repo/work items/done/beta" "$TMP_DIR/repo/work items/old" "$TMP_DIR/repo/work items/broken" "$TMP_DIR/repo/work items/sha-only" "$TMP_DIR/repo/work items/empty"
must cp "$ROOT_DIR/scripts/pdh-review-tally.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/repo/scripts/"
must cd "$TMP_DIR/repo"
must git init -q -b main
printf 'tickets_dir: "./work items/" # quoted path\n' > .ticket-config.yaml
{
  printf 'review-sha: ABCDEF0 details\n- review-sha: abcdef0\nreview-sha: 1234567(rest)\n'
  header 1
  printf '| 1 | DA+codex | error | Critical | first | 起票する | ticket | reason |\n'
  printf '| 2 | CR | scope | Major | second | 棄却する | code | reason |\n\n'
  printf 'PDH-review-1 #1 処置の変更: 起票する → 記録だけ残す — reason\n'
  printf 'PDH-review-1 #1 処置の変更: 記録だけ残す → いま直す — reason\n'
  printf 'PDH-review-9 #1 処置の変更: 起票する → 棄却する — unknown finding\n'
  header 2
  printf '| 1 | DA | error | Major | third | 記録だけ残す | code | reason |\n\n'
  printf '処置の変更: 記録だけ残す → 起票する — reason（PDH-review-2 #1）\n'
  printf '| 99 | PM | ignored | Critical | unrelated table | 棄却する | code | reason |\n'
} > 'work items/alpha/progress.md'
{
  printf 'review-sha: fedcba9876543210fedcba9876543210fedcba98 explanation\n'
  header 1
  printf '| 1 | codex+Why の見方 | error | Minor | fourth | 棄却する | code | reason |\n'
  printf '| 2 | PM | scope | Major | fifth | 記録だけ残す | code | reason |\n'
} > 'work items/done/beta/progress.md'
printf '### Findings\n| # | 観点 | Sev | 要旨 | 判定 | 記録先 | 理由 |\n| 1 | old | Critical | old | いま直す | code | reason |\n## Prior Findings\n| 1 | DA | ignored | Major | old | 棄却する | code | reason |\n### Findings-PDH-review-1\n| # | 観点 | Sev | 要旨 | 判定 | 記録先 | 理由 |\n' > 'work items/old/progress.md'
{
  header 1
  printf '| 1 | DA | broken | Major | missing column | いま直す | code |\n'
  printf '| 2 | | broken | Major | empty reviewer | 起票する | code | reason |\n'
  printf '| 3 | CR | broken | Major | bad decision | 未定 | code | reason |\n'
  printf '| 4 | CR | broken | Major | extra column | 棄却する | code | reason | extra |\n'
} > 'work items/broken/progress.md'
printf 'review-sha: 123abc0text\n- review-sha: 123ABC0 more\nreview-sha: abcdef\nreview-sha: 12345678901234567890123456789012345678901\n review-sha: abcdef12\nclose-gate-sha: abcdef123\n' > 'work items/sha-only/progress.md'
: > 'work items/empty/progress.md'
expect 0 '全 ticket 集計' bash scripts/pdh-review-tally.sh
contains '| DA | 2 | 1 | 1 | 1 | 1 | 0 | 0 |'
contains '| codex | 2 | 1 | 0 | 1 | 0 | 0 | 1 |'
contains '| CR | 1 | 0 | 1 | 0 | 0 | 0 | 1 |'
contains '| PM | 1 | 0 | 1 | 0 | 0 | 1 | 0 |'
contains '| Why の見方 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |'
contains '| alpha | 2 |'
contains '| beta | 1 |'
contains '| sha-only | 1 |'
contains '1 巡で抜けた ticket: 2 / 3 (66.7%)'
contains '| error | 3 | alpha, beta |'
contains '| scope | 2 | alpha, beta |'
contains '数えなかった ticket の数: 3'
contains 'broken:5: | 1 | DA | broken | Major | missing column | いま直す | code |'
contains 'broken:6: | 2 | | broken | Major | empty reviewer | 起票する | code | reason |'
contains 'broken:7: | 3 | CR | broken | Major | bad decision | 未定 | code | reason |'
contains 'broken:8: | 4 | CR | broken | Major | extra column | 棄却する | code | reason | extra |'
excludes '| ignored |'
excludes '| old |'
excludes '| broken | 4 |'
expect 0 '対象の指定と重複の除去' bash scripts/pdh-review-tally.sh --ticket 'work items/alpha' --ticket 'work items/done/beta' --ticket 'work items/alpha/'
contains '| DA | 2 | 1 | 1 | 1 | 1 | 0 | 0 |'
contains '1 巡で抜けた ticket: 1 / 2 (50.0%)'
contains '数えなかった ticket の数: 0'
contains '崩れた行:
なし'
must cd 'work items'
expect 0 '子ディレクトリから全件' bash ../scripts/pdh-review-tally.sh
contains '1 巡で抜けた ticket: 2 / 3 (66.7%)'
expect 0 '子ディレクトリから相対パスで指定' bash ../scripts/pdh-review-tally.sh --ticket sha-only
contains '1 巡で抜けた ticket: 1 / 1 (100.0%)'
contains '数えなかった ticket の数: 1'
must cd ..
expect 0 '巡が無い場合' bash scripts/pdh-review-tally.sh --ticket 'work items/empty'
contains '1 巡で抜けた ticket: 0 / 0 (0.0%)'
expect 0 'ヘルプ' bash scripts/pdh-review-tally.sh --help
contains '--ticket <dir>'
expect 0 '短いヘルプ' bash scripts/pdh-review-tally.sh -h
expect 2 '引数不足' bash scripts/pdh-review-tally.sh --ticket
expect 2 '不明な引数' bash scripts/pdh-review-tally.sh --other
expect 2 '存在しない ticket' bash scripts/pdh-review-tally.sh --ticket missing
must mkdir no-progress
expect 2 'progress の欠落' bash scripts/pdh-review-tally.sh --ticket no-progress
printf 'tickets_dir: absent\n' > .ticket-config.yaml
expect 2 'tickets_dir の欠落' bash scripts/pdh-review-tally.sh
must mkdir absent
expect 0 'ticket が無いディレクトリ' bash scripts/pdh-review-tally.sh
contains '1 巡で抜けた ticket: 0 / 0 (0.0%)'
contains '数えなかった ticket の数: 0'
printf 'PASS: pdh-review-tally (%d checks)\n' "$checks"
