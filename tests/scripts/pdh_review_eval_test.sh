#!/usr/bin/env bash
# 評価 CLI の契約を隔離 repo と偽 CLI で検査する。実 reviewer は呼ばない。
set -uo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
TMP_DIR=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
must() { "$@" || fail "準備コマンドが失敗しました: $*"; }
unset PDH_REVIEW_MODEL
checks=0
expect() {
  local expected=$1 label=$2 actual
  shift 2
  output=$("$@" 2>&1); actual=$?
  [ "$actual" -eq "$expected" ] || fail "$label: exit $actual（期待 $expected）: $output"
  checks=$((checks + 1))
}
contains() { [[ "$output" == *"$1"* ]] || fail "出力に $1 がありません: $output"; }
file_contains() { output=$(cat "$1"); contains "$2"; }
clean_worktrees() {
  [ "$(git worktree list --porcelain | count_matches '^worktree ')" -eq 1 ] || fail 'worktree が残りました'
  [ -z "$(find "$TMP_DIR/work space" -mindepth 1 -print -quit)" ] || fail '一時ディレクトリが残りました'
  [ "$(cat "$TMP_DIR/work space/../keep.txt")" = keep ] || fail '利用者のファイルが消えました'
  checks=$((checks + 1))
}
# rg の無い導入先でも動くよう、テストの行数は awk で数える。
count_matches() { awk -v pattern="$1" '$0 ~ pattern {n++} END {print n+0}'; }
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR=
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
must mkdir -p "$TMP_DIR/repo/scripts" "$TMP_DIR/repo/.claude/agents" "$TMP_DIR/bin" "$TMP_DIR/audit" "$TMP_DIR/work space"
printf 'keep\n' > "$TMP_DIR/keep.txt"
must cp "$ROOT_DIR/scripts/pdh-review-eval.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/repo/scripts/"
must cd "$TMP_DIR/repo"
must git init -q -b main
must git config user.email test@example.invalid
must git config user.name Test
printf 'tickets_dir: "./work items/" # quoted path\n' > .ticket-config.yaml
printf '%s\n' '---' 'name: historical-reviewer' '---' 'OLD REVIEWER BODY' > .claude/agents/pdh-reviewer.md
must mkdir -p 'work items/open' 'work items/done/closed' 'work items/removed' 'work items/done/removed-done'
for name in open done/closed removed done/removed-done; do printf 'ticket content: %s\n' "$name" > "work items/$name/ticket.md"; done
printf 'before\n' > app.txt
must git add .
must git commit -qm base
base=$(git rev-parse HEAD)
printf 'after\n' > app.txt
must git rm -q 'work items/removed/ticket.md' 'work items/done/removed-done/ticket.md'
must git add app.txt
must git commit -qm change
sha=$(git rev-parse HEAD)
printf '%s\n' '---' 'name: current-reviewer' '---' 'CURRENT REVIEWER BODY' > .claude/agents/pdh-reviewer.md
must git add .claude/agents/pdh-reviewer.md
must git commit -qm 'current reviewer'
definition_head=$(git rev-parse HEAD)
# 未 commit の定義を混ぜず、起動時 HEAD の本文を測る。
printf 'UNCOMMITTED REVIEWER BODY\n' > .claude/agents/pdh-reviewer.md
export EVAL_AUDIT=$TMP_DIR/audit
export PATH=$TMP_DIR/bin:$PATH
cat > "$TMP_DIR/bin/claude" <<'CLAUDE'
#!/usr/bin/env bash
set -euo pipefail
prompt=$(cat)
if [[ " $* " != *' --allowedTools '* ]]; then
  [[ " $* " == *' --tools '* ]] || exit 80
  printf '%s\n' "$@" > "$EVAL_AUDIT/judge.args"
  # --tools の値が空であることも、引数のまま検査する。
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --tools ]; then [ "$2" = '' ] || exit 81; break; fi
    shift
  done
  [[ "$prompt" == *'SECRET-DEFECT'* || "$prompt" == *'"kind":"control"'* ]] || exit 82
  [[ "${EVAL_JUDGE_MODE:-}" != invalid ]] || { printf '{"caught":"yes"}\n'; exit 0; }
  if [[ "$prompt" == *'DA RECORDED DEFECT'* ]]; then
    printf '{"caught":true,"evidence":"DA RECORDED DEFECT","other_critical_major":2}\n'
  elif [[ "$prompt" == *'"kind":"control"'* ]]; then
    printf '{"caught":null,"evidence":"","other_critical_major":4}\n'
  else
    printf '{"caught":false,"evidence":"","other_critical_major":1}\n'
  fi
  exit 0
fi
case_id=$(basename "$(dirname "$PWD")")
role=cr
[[ "$prompt" != *"役割: Devil's Advocate"* ]] || role=da
printf '%s\n' "$prompt" > "$EVAL_AUDIT/$case_id-$role.prompt"
printf '%s\n' "$@" > "$EVAL_AUDIT/$case_id-$role.args"
[ "$(git rev-parse HEAD)" = "$EVAL_SHA" ] || exit 83
git symbolic-ref -q HEAD && exit 84
[[ "$prompt" == *'CURRENT REVIEWER BODY'* ]] || exit 85
[[ "$prompt" != *'name: current-reviewer'* && "$prompt" != *'UNCOMMITTED REVIEWER BODY'* ]] || exit 86
[[ "$prompt" != *'SECRET-DEFECT'* && "$prompt" != *'found_via'* ]] || exit 87
diff_path=$(printf '%s\n' "$prompt" | sed -n 's/^diff.patch: //p')
[[ "$(cat "$diff_path")" == *'+after'* ]] || exit 88
ticket_path=$(printf '%s\n' "$prompt" | sed -n 's/^ticket.md: //p')
case "$case_id" in
  defect) expected='open' ;; control) expected='done/closed' ;;
  parent) expected=removed ;; parent-done) expected=done/removed-done ;;
  *) expected='' ;;
esac
if [ -n "$expected" ]; then
  [ "$(cat "$ticket_path")" = "ticket content: $expected" ] || exit 89
else
  [ "$ticket_path" = 'ticket なし' ] || exit 90
fi
# 3 人とも起動するまで待ち、逐次起動への退行も検出する。
touch "$EVAL_AUDIT/$case_id-$role.started"
if [ "${EVAL_SIGNAL:-0}" = 1 ]; then
  kill -TERM "$PPID"
  sleep 1
fi
if [ "${EVAL_REQUIRE_PARALLEL:-0}" = 1 ]; then
  for ((i=0; i<100; i++)); do
    [ ! -f "$EVAL_AUDIT/$case_id-da.started" ] || [ ! -f "$EVAL_AUDIT/$case_id-cr.started" ] || [ ! -f "$EVAL_AUDIT/$case_id-codex.started" ] || break
    sleep 0.02
  done
  [ "$i" -lt 100 ] || exit 91
fi
if [ "$case_id:$role" = defect:da ]; then printf 'DA RECORDED DEFECT\n'; else printf 'Other Major finding\n'; fi
CLAUDE
cat > "$TMP_DIR/bin/codex" <<'CODEX'
#!/usr/bin/env bash
set -euo pipefail
case_id=$(basename "$(dirname "$PWD")")
printf '%s\n' "$@" > "$EVAL_AUDIT/$case_id-codex.args"
[ "$(git rev-parse HEAD)" = "$EVAL_SHA" ] || exit 92
touch "$EVAL_AUDIT/$case_id-codex.started"
if [ "${EVAL_CODEX_MODE:-}" = bwrap ]; then
  printf 'bwrap: No permissions to create a new namespace\n' >&2
else
  printf 'Documentation mentions bwrap: but this is not an error\n' >&2
fi
printf 'Other Major finding\n'
exit "${EVAL_CODEX_EXIT:-0}"
CODEX
must chmod +x "$TMP_DIR/bin/claude" "$TMP_DIR/bin/codex"
export EVAL_SHA=$sha EVAL_REQUIRE_PARALLEL=1
must jq -n --arg sha "$sha" --arg base "$base" '{format:1,cases:[
  {id:"defect",kind:"defect",measure:true,ticket:"open",sha:$sha,base:$base,defect:{summary:"SECRET-DEFECT",location:"app.txt:1",found_via:"hidden",visibility:"diff-inside"}},
  {id:"control",kind:"control",measure:true,ticket:"closed",sha:$sha,base:$base},
  {id:"parent",kind:"control",measure:false,ticket:"removed",sha:$sha,base:$base},
  {id:"parent-done",kind:"control",measure:false,ticket:"removed-done",sha:$sha,base:$base},
  {id:"missing",kind:"control",measure:false,ticket:"absent",sha:$sha,base:$base},
  {id:"null",kind:"control",measure:false,ticket:null,sha:$sha,base:$base}
]}' > cases.json
expect 0 '測定対象の実行と並列起動' bash scripts/pdh-review-eval.sh --cases cases.json --measured --out "$TMP_DIR/results with spaces" --work "$TMP_DIR/work space"
contains '| da | 1 / 1 | 4 | 0 |'
contains '| cr | 0 / 1 | 4 | 0 |'
contains '| codex | 0 / 1 | 4 | 0 |'
reports=("$TMP_DIR/results with spaces/"*-defect.md)
report=${reports[0]}
file_contains "$report" "reviewer definition HEAD: $definition_head"
file_contains "$report" "reviewer definition commit: $definition_head"
file_contains "$report" 'evidence: DA RECORDED DEFECT'
file_contains "$report" 'other_critical_major: 2'
file_contains "$report" '判定も LLM'
file_contains "$EVAL_AUDIT/defect-da.args" 'Bash(git diff:*)'
file_contains "$EVAL_AUDIT/defect-cr.args" 'Bash(git log:*)'
file_contains "$EVAL_AUDIT/defect-da.args" 'Bash(git show:*)'
file_contains "$EVAL_AUDIT/defect-codex.args" 'sandbox_mode="danger-full-access"'
file_contains "$EVAL_AUDIT/defect-codex.args" 'model_reasoning_effort="high"'
[ "$(find "$TMP_DIR/results with spaces/raw" -name '*.txt' ! -name '*stderr.txt' | wc -l)" -eq 6 ] || fail '生出力の件数が不正'
[ "$(find "$TMP_DIR/results with spaces" -name '*-summary.md' | wc -l)" -eq 1 ] || fail 'summary がありません'
[ ! -e "$EVAL_AUDIT/parent-da.prompt" ] || fail 'measure=false を実行しました'
# The default CLI invocation must never pin a model for reviewers or the judge.
! grep -qx -- '--model' "$EVAL_AUDIT/defect-da.args" || fail 'default reviewer model is pinned'
! grep -qx -- '--model' "$EVAL_AUDIT/judge.args" || fail 'default judge model is pinned'
clean_worktrees
export EVAL_REQUIRE_PARALLEL=0
export PDH_REVIEW_MODEL=project-review-model
for id in parent parent-done missing null; do
  expect 0 "ticket の探索: $id" bash scripts/pdh-review-eval.sh --cases cases.json --case "$id" --reviewers cr --out "$TMP_DIR/$id" --work "$TMP_DIR/work space"
  reports=("$TMP_DIR/$id/"*-$id.md)
  file_contains "${reports[0]}" 'caught: null'
  file_contains "${reports[0]}" '起動失敗: なし'
  clean_worktrees
done
file_contains "$EVAL_AUDIT/null-cr.args" 'project-review-model'
file_contains "$EVAL_AUDIT/judge.args" 'project-review-model'
reports=("$TMP_DIR/null/"*-null.md)
file_contains "${reports[0]}" 'DA/CR・判定: project-review-model'
unset PDH_REVIEW_MODEL

expect 0 '既定 out と mktemp' bash scripts/pdh-review-eval.sh --cases cases.json --case null --reviewers da
reports=(docs/pdh-review-eval/results/*-null.md)
file_contains "${reports[0]}" 'caught: null'
export EVAL_CODEX_MODE=bwrap
expect 0 'rc=0 でも bwrap は起動失敗' bash scripts/pdh-review-eval.sh --cases cases.json --measured --reviewers codex --out "$TMP_DIR/bwrap" --work "$TMP_DIR/work space"
contains '| codex | 0 / 1 | 0 | 2 |'
reports=("$TMP_DIR/bwrap/"*-defect.md)
file_contains "${reports[0]}" '起動失敗: exit=0'
file_contains "${reports[0]}" 'caught: 未判定'
[ "$(find "$TMP_DIR/bwrap/raw" -name '*.judge.json' | wc -l)" -eq 0 ] || fail '起動失敗を判定しました'
clean_worktrees
unset EVAL_CODEX_MODE
export EVAL_CODEX_EXIT=7
expect 0 'reviewer の非ゼロ終了を記録' bash scripts/pdh-review-eval.sh --cases cases.json --case null --reviewers codex --out "$TMP_DIR/nonzero" --work "$TMP_DIR/work space"
reports=("$TMP_DIR/nonzero/"*-null.md)
file_contains "${reports[0]}" '起動失敗: exit=7'
clean_worktrees
unset EVAL_CODEX_EXIT
export EVAL_JUDGE_MODE=invalid
expect 3 '不正な判定 JSON は内部エラー' bash scripts/pdh-review-eval.sh --cases cases.json --case null --reviewers da --out "$TMP_DIR/invalid" --work "$TMP_DIR/work space"
reports=("$TMP_DIR/invalid/"*-null.md)
file_contains "${reports[0]}" '判定失敗:'
clean_worktrees
unset EVAL_JUDGE_MODE
export EVAL_SIGNAL=1
expect 3 '中断時の worktree 後片付け' bash scripts/pdh-review-eval.sh --cases cases.json --case null --reviewers da --out "$TMP_DIR/interrupted" --work "$TMP_DIR/work space"
clean_worktrees
unset EVAL_SIGNAL
must jq '.cases |= map(.sha = "abcdef0")' cases.json > bad-sha.json
expect 3 '存在しない commit と後片付け' bash scripts/pdh-review-eval.sh --cases bad-sha.json --case null --reviewers da --out "$TMP_DIR/bad-sha" --work "$TMP_DIR/work space"
clean_worktrees
expect 0 'ヘルプ' bash scripts/pdh-review-eval.sh -h
contains '--work <dir>'
for args in '' '--cases' '--other' '--cases absent --measured' '--cases cases.json' '--cases cases.json --case absent' '--cases cases.json --case null --measured' '--cases cases.json --measured --reviewers da,da' '--cases cases.json --measured --reviewers bad' '--cases cases.json --measured --reviewers da,'; do
  read -r -a argv <<< "$args"
  expect 2 "使い方の誤り: $args" bash scripts/pdh-review-eval.sh "${argv[@]}"
done
printf '{broken\n' > invalid.json
expect 2 '壊れた JSON' bash scripts/pdh-review-eval.sh --cases invalid.json --measured
must jq '.cases[0].id = "../escape"' cases.json > unsafe.json
expect 2 'ファイル名になる id の検査' bash scripts/pdh-review-eval.sh --cases unsafe.json --measured
printf 'PASS: pdh-review-eval (%d checks)\n' "$checks"
