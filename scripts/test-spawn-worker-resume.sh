#!/usr/bin/env bash
# codex の混雑再開と、混雑が無い場合の旧版との互換性を実行して確かめる。
set -uo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd) || exit 1
TMP_DIR=$(mktemp -d) || exit 1
failures=0
checks=0
supervisors=()
cleanup() {
  local worker
  for worker in ${supervisors[@]+"${supervisors[@]}"}; do
    [ -f "${worker#*:}/rc.txt" ] || kill -TERM "${worker%%:*}" 2>/dev/null || true
  done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; failures=$((failures + 1)); }
must() { "$@" || { fail "準備・実行に失敗: $*"; exit 1; }; }
eq() { [ "$2" = "$3" ] || fail "$1: expected=<$2> actual=<$3>"; }
contains() { grep -qF -- "$2" "$1" || fail "$1 に <$2> が無い"; }
same() { cmp -s "$1" "$2" || fail "ファイルが異なる: $1 / $2"; }
absent() { [ ! -e "$1" ] || fail "不要なファイル: $1"; }
prefix='モデルの混雑で止まったので、最初の指示の範囲だけで続けて終えて'
sid=11111111-1111-1111-1111-111111111111

must mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/codex" <<'MOCK'
#!/usr/bin/env bash
set -uo pipefail
n=$(cat "$FAKE_DIR/count" 2>/dev/null || echo 0)
n=$((n + 1))
printf '%s\n' "$n" > "$FAKE_DIR/count"
printf '%s\0' "$@" > "$FAKE_DIR/argv.$n"
cat > "$FAKE_DIR/stdin.$n"
printf '%s\n' "$PWD" > "$FAKE_DIR/cwd.$n"
date +%s > "$FAKE_DIR/started.$n"
step=$(printf '%s\n' "$FAKE_PLAN" | awk -F, -v n="$n" '{if (n <= NF) print $n; else print $NF}')
json=0
output_file=""
previous=""
for arg in "$@"; do
  case "$arg" in --json) json=1 ;; --output-last-message=*) output_file="${arg#*=}" ;; esac
  case "$previous" in -o|--output-last-message) output_file="$arg" ;; esac
  previous="$arg"
done
if [ "${FAKE_OUTPUT_TRACK:-0}" = 1 ] && [ -n "$output_file" ]; then
  printf 'attempt=%s\n' "$n" > "$output_file"
  printf '%s/%s\n' "$PWD" "$output_file" > "$FAKE_DIR/output.$n"
fi
if [ "$json" = 1 ]; then
  printf '{"type":"thread.started","thread_id":"11111111-1111-1111-1111-111111111111"}\n'
  printf '{"type":"turn.started"}\n'
  case "$step" in
    capacity*)
      printf '{"type":"error","message":"stream disconnected before completion: Selected model is at capacity. Please try a different model."}\n'
      printf '{"type":"turn.failed","error":{"message":"stream disconnected before completion: Selected model is at capacity. Please try a different model."}}\n'
      exit "$n" ;;
    json-tool-failure)
      printf '{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"Selected model is at capacity"}}\n'
      printf '{"type":"turn.failed","error":{"message":"authentication failed"}}\n'; exit 42 ;;
    json-last-failure)
      printf '{"type":"error","message":"Selected model is at capacity"}\n'
      printf '{"error":{"message":"authentication failed"},"type":"turn.failed"}\n'; exit 42 ;;
    failure) printf '{"type":"turn.failed","error":{"message":"authentication failed"}}\n'; exit 42 ;;
    success) printf '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n'; exit 0 ;;
  esac
fi
printf 'stdout attempt=%s\n' "$n"
cat "$FAKE_DIR/stdin.$n"
printf 'OpenAI Codex (test double)\n--------\nworkdir: %s\n' "$PWD" >&2
case "$step" in
  capacity-no-id) ;;
  capacity-empty-id) printf 'session id: \n' >&2 ;;
  *) printf 'session id: 11111111-1111-1111-1111-111111111111\n' >&2 ;;
esac
case "$step" in
  capacity-multi|capacity-empty-id)
    printf 'session id: 22222222-2222-2222-2222-222222222222\n' >&2 ;;
esac
printf 'user\n' >&2
if [ "${!#}" = - ]; then cat "$FAKE_DIR/stdin.$n" >&2; else printf '%s\n' "${!#}" >&2; fi
# 実 worker の処理を模した長い出力。指示の ERROR 行を末尾の error と取り違えない。
for ((line=0; line<40; line++)); do printf 'working line %s\n' "$line" >&2; done
case "$step" in
  capacity*)
    printf 'ERROR: Selected model is at capacity. Please try a different model.\ntokens used\n123\n' >&2
    date +%s > "$FAKE_DIR/ended.$n"
    exit "$n" ;;
  signal-capacity)
    printf 'ERROR: Selected model is at capacity\n' >&2
    kill -TERM "$$" ;;
  failure) printf 'ERROR: authentication or invalid argument\n' >&2; exit 42 ;;
  stdout-capacity) printf 'Selected model is at capacity\n'; exit 42 ;;
  success-capacity) printf 'Selected model is at capacity\n' >&2 ;;
  slow-success) sleep 1 ;;
  success) ;;
  *) printf 'unexpected fake plan: %s\n' "$step" >&2; exit 99 ;;
esac
MOCK
must chmod +x "$TMP_DIR/bin/codex"
export PATH="$TMP_DIR/bin:$PATH"
# 外から渡された設定にテストを左右させない。
unset _SPAWN_WORKER_SUPERVISOR _SPAWN_WORKER_STDIN
export PDH_CODEX_RESUME_MAX=4 PDH_CODEX_RESUME_DELAY_SECONDS=0
SCRIPT="$ROOT_DIR/claude/templates/spawn-worker.sh"
BASELINE="$ROOT_DIR/scripts/fixtures/spawn-worker-before-resume.sh"
# fixture は origin/main 370a5e3 の原本。CI の main / origin/main / 履歴には依存しない。
must test -f "$BASELINE"
must cmp "$SCRIPT" "$ROOT_DIR/codex/templates/spawn-worker.sh"

new_case() {
  checks=$((checks + 1))
  label="$1"
  before_failures="$failures"
  case_dir="$TMP_DIR/case-$checks"
  out="$case_dir/out"
  trace="$case_dir/trace"
  must mkdir -p "$trace" "$case_dir/work dir"
}
report_case() {
  if [ "$failures" = "$before_failures" ]; then printf 'PASS: %s\n' "$label"; fi
}
launch() {
  local plan="$1" script="$2"
  shift 2
  must env FAKE_DIR="$trace" FAKE_PLAN="$plan" bash "$script" "$@" > "$case_dir/launch.txt"
  supervisors+=("$(cat "$out/pid.txt"):$out")
}
await_file() {
  local file="$1" i=0
  while [ ! -f "$file" ] && [ "$i" -lt 400 ]; do sleep 0.05; i=$((i + 1)); done
  [ -f "$file" ] || { fail "timeout: $file"; exit 1; }
}
done_worker() {
  await_file "$out/rc.txt"
  wait_output=$(bash "$SCRIPT" --wait "$out" 2); wait_rc=$?
  eq '--wait exit' 0 "$wait_rc"
}
expect_prompt() {
  local scope="$1" prompt="$2" round="${3:-1}"
  { printf '%s\n' "$prefix"; printf '%s%s' "$scope" "$prompt"; } > "$case_dir/expected-prompt"
  same "$case_dir/expected-prompt" "$out/resume-$round.prompt.txt"
  same "$case_dir/expected-prompt" "$trace/stdin.$((round + 1))"
}
expect_args() {
  printf '%s\0' "$@" > "$case_dir/expected-argv"
  same "$case_dir/expected-argv" "$trace/argv.2"
}
expect_single() {
  eq '起動回数' 1 "$(cat "$trace/count")"
  absent "$out/resume.log"
  absent "$out/resume-1.prompt.txt"
  absent "$out/stdout.0.txt"
  absent "$out/stderr.0.txt"
}

new_case '退行: setsid があれば別 session、無ければ別 process group へ切り離す'
# ps で測り終えるまで worker を生存させ、終了した PID の比較を避ける。
launch success "$SCRIPT" "$out" -- bash -c \
  'while [ ! -f "$1" ]; do sleep 0.05; done' bash "$case_dir/release"
await_file "$out/child-pid.txt"
supervisor_pid=$(cat "$out/pid.txt")
if command -v setsid >/dev/null 2>&1; then
  identity=sid
else
  identity=pgid
fi
caller_identity=$(ps -o "$identity=" -p "$$" | tr -d '[:space:]')
supervisor_identity=$(ps -o "$identity=" -p "$supervisor_pid" | tr -d '[:space:]')
case "$caller_identity:$supervisor_identity" in
  *[!0-9:]*|:*|*:) fail "$identity を取得できない: caller=<$caller_identity> supervisor=<$supervisor_identity>" ;;
  *)
    [ "$caller_identity" != "$supervisor_identity" ] || \
      fail "切り離し ($identity): caller=<$caller_identity> supervisor=<$supervisor_identity>（同一）"
    ;;
esac
must touch "$case_dir/release"
done_worker
eq rc 0 "$(cat "$out/rc.txt")"
report_case

new_case 'AC1/2: exec 引数・同一 session・stdin 全文・sandbox/cd 変換'
prompt=$'最初の範囲だけ\n引用 " と $ と ` をそのまま\n\n'
printf '%s' "$prompt" > "$case_dir/input.txt"
launch capacity-multi,success "$SCRIPT" --stdin "$case_dir/input.txt" "$out" -- \
  codex exec --sandbox danger-full-access -C "$case_dir/work dir" \
  -c 'model_reasoning_effort="high"' -m chosen-model -o "$case_dir/result.txt" -
done_worker
eq rc 0 "$(cat "$out/rc.txt")"
eq '--wait' 'DONE rc=0 resumes=1' "$wait_output"
expect_args exec resume "$sid" -c 'sandbox_mode="danger-full-access"' \
  -c 'model_reasoning_effort="high"' -m chosen-model -o "$case_dir/result.txt" -
eq cwd "$case_dir/work dir" "$(cat "$trace/cwd.2")"
expect_prompt '' "$prompt"
same "$out/stdout.1.txt" "$out/stdout.txt"
same "$out/stderr.1.txt" "$out/stderr.txt"
contains "$out/resume.log" 'round=0 started_at='
contains "$out/resume.log" 'wait=0s rc=1'
contains "$out/resume.log" 'wait=0s rc=0'
report_case

new_case 'AC1/2: 引数 prompt・長い option 名・相対 cd・絶対 executable'
launch capacity,success "$SCRIPT" "$out" -- "$TMP_DIR/bin/codex" exec \
  --sandbox=workspace-write --cd=. --config 'model_reasoning_effort="low"' \
  --model=chosen-model --output-last-message="$case_dir/result.txt" --json $'指示\n末尾\n'
done_worker
expect_args exec resume "$sid" -c 'sandbox_mode="workspace-write"' \
  --config 'model_reasoning_effort="low"' --model=chosen-model --output-last-message="$case_dir/result.txt" --json -
eq cwd "$PWD" "$(cat "$trace/cwd.2")"
expect_prompt '' $'指示\n末尾\n'
report_case

for scope in base commit uncommitted; do
  for with_prompt in yes no; do
    new_case "AC1/2: review --$scope（指示文=$with_prompt）"
    review_args=(review -c 'sandbox_mode="read-only"' -m chosen-model -o "$case_dir/review.txt")
    case "$scope" in
      base) review_args+=(--base feature/base); expected_scope=$'--base feature/base\n' ;;
      commit) review_args+=(--commit abc123); expected_scope=$'--commit abc123\n' ;;
      uncommitted) review_args+=(--uncommitted); expected_scope=$'--uncommitted\n' ;;
    esac
    review_prompt=""
    if [ "$with_prompt" = yes ]; then review_prompt=$'レビューの範囲\nそのまま'; review_args+=("$review_prompt"); fi
    launch capacity,success "$SCRIPT" "$out" -- codex exec "${review_args[@]}"
    done_worker
    expect_args exec resume "$sid" -c 'sandbox_mode="read-only"' -m chosen-model -o "$case_dir/review.txt" -
    expect_prompt "$expected_scope" "$review_prompt"
    report_case
  done
done

for plan in failure capacity,failure; do
  new_case "M-1: 指示に混雑文言があっても末尾の認証エラーで止まる ($plan)"
  prompt=$'この文言を調べる\nERROR: Selected model is at capacity. Please try a different model.\n範囲を守る'
  launch "$plan" "$SCRIPT" "$out" -- codex exec "$prompt"
  done_worker
  eq rc 42 "$(cat "$out/rc.txt")"
  if [ "$plan" = failure ]; then
    expect_single
    eq '--wait' 'DONE rc=42' "$wait_output"
  else
    eq '起動回数' 2 "$(cat "$trace/count")"
    diagnostic='再開の 1 回目が混雑以外で終わった（rc=42）。`stderr.1.txt` を見る'
    contains "$out/resume.log" "$diagnostic"
    eq '--wait' "DONE rc=42 resumes=1"$'\n'"$diagnostic" "$wait_output"
  fi
  report_case
done

for output_option in -o --output-last-message --output-last-message=; do
  new_case "M-2: -C と相対 $output_option は同じ出力ファイルに書く"
  output_args=("$output_option" result.txt)
  if [ "$output_option" = --output-last-message= ]; then output_args=(--output-last-message=result.txt); fi
  (cd "$case_dir" && FAKE_OUTPUT_TRACK=1 launch capacity,success "$SCRIPT" "$out" -- \
    codex exec -C "$case_dir/work dir" "${output_args[@]}" '指示')
  done_worker
  eq '同じ実体へ上書き' 'attempt=2' "$(cat "$case_dir/result.txt")"
  absent "$case_dir/work dir/result.txt"
  eq cwd "$case_dir/work dir" "$(cat "$trace/cwd.2")"
  report_case
done

new_case 'M-3: JSON の thread.started と最後の混雑エラーで同じ会話を再開'
launch capacity,success "$SCRIPT" "$out" -- codex exec --json '指示'
done_worker
eq rc 0 "$(cat "$out/rc.txt")"
eq '--wait' 'DONE rc=0 resumes=1' "$wait_output"
expect_args exec resume "$sid" --json -
contains "$out/stdout.0.txt" '"type":"turn.failed"'
report_case
for plan in json-tool-failure json-last-failure; do
  new_case "M-3: JSON の指示・ツール文言や過去の error を混雑と判定しない ($plan)"
  launch "$plan" "$SCRIPT" "$out" -- codex exec --json 'Selected model is at capacity'
  done_worker
  expect_single
  eq rc 42 "$(cat "$out/rc.txt")"
  report_case
done

new_case 'AC4: 既定4回で上限停止・最後のrcと各回出力'
unset PDH_CODEX_RESUME_MAX
launch capacity "$SCRIPT" "$out" -- codex exec '最初の指示'
done_worker
eq '起動回数' 5 "$(cat "$trace/count")"
eq rc 5 "$(cat "$out/rc.txt")"
eq '--wait' 'DONE rc=5 resumes=4' "$wait_output"
contains "$out/resume.log" 'モデルの混雑で 4 回再開したが終わらなかった'
for round in 0 1 2 3 4; do
  contains "$out/stdout.$round.txt" "stdout attempt=$((round + 1))"
  contains "$out/stderr.$round.txt" 'Selected model is at capacity'
  contains "$out/resume.log" "wait=0s rc=$((round + 1))"
  if [ "$round" -gt 0 ]; then expect_prompt '' '最初の指示' "$round"; fi
done
same "$out/stdout.4.txt" "$out/stdout.txt"
same "$out/stderr.4.txt" "$out/stderr.txt"
report_case
export PDH_CODEX_RESUME_MAX=4

new_case 'AC4: 環境変数による上限と1→2秒の待機・RUNNING 書式'
export PDH_CODEX_RESUME_MAX=2 PDH_CODEX_RESUME_DELAY_SECONDS=1
launch capacity "$SCRIPT" "$out" -- codex exec '指示'
await_file "$out/resume.log"
running_output=$(bash "$SCRIPT" --wait "$out" 0); running_rc=$?
eq '--wait RUNNING exit' 75 "$running_rc"
contains "$case_dir/launch.txt" 'SPAWNED pid='
case "$running_output" in
  "RUNNING pid="*" alive=yes waited=0s resumes=0 — もう一度 --wait を呼ぶ") ;;
  *) fail "RUNNING 書式: $running_output" ;;
esac
done_worker
eq '起動回数' 3 "$(cat "$trace/count")"
eq rc 3 "$(cat "$out/rc.txt")"
contains "$out/resume.log" 'wait=1s rc=2'
contains "$out/resume.log" 'wait=2s rc=3'
must test "$(( $(cat "$trace/started.2") - $(cat "$trace/ended.1") ))" -ge 1
must test "$(( $(cat "$trace/started.3") - $(cat "$trace/ended.2") ))" -ge 2
contains "$out/resume.log" 'モデルの混雑で 2 回再開したが終わらなかった'
report_case
export PDH_CODEX_RESUME_MAX=4 PDH_CODEX_RESUME_DELAY_SECONDS=0

for plan in failure capacity-no-id capacity-empty-id stdout-capacity success-capacity signal-capacity; do
  new_case "AC3: $plan は再開しない"
  launch "$plan" "$SCRIPT" "$out" -- codex exec '指示'
  done_worker
  expect_single
  case "$plan" in
    failure|stdout-capacity) expected_rc=42 ;;
    signal-capacity) expected_rc=143 ;;
    success-capacity) expected_rc=0 ;;
    *) expected_rc=1 ;;
  esac
  eq rc "$expected_rc" "$(cat "$out/rc.txt")"
  eq '--wait' "DONE rc=$expected_rc" "$wait_output"
  report_case
done

for unsupported in '--unknown-option' '--sandbox=unsupported' '--cd=/missing/pdh-work-dir' '-m'; do
  new_case "AC3: 組み立てられない引数 $unsupported"
  launch capacity "$SCRIPT" "$out" -- codex exec "$unsupported"
  done_worker
  expect_single
  eq rc 1 "$(cat "$out/rc.txt")"
  report_case
done

new_case 'AC3/DD: 再開が混雑以外で失敗した診断を log と --wait に出す'
launch capacity,failure "$SCRIPT" "$out" -- codex exec '指示'
done_worker
eq '起動回数' 2 "$(cat "$trace/count")"
eq rc 42 "$(cat "$out/rc.txt")"
diagnostic='再開の 1 回目が混雑以外で終わった（rc=42）。`stderr.1.txt` を見る'
contains "$out/resume.log" "$diagnostic"
eq '--wait 診断全文' "DONE rc=42 resumes=1"$'\n'"$diagnostic" "$wait_output"
same "$out/stderr.1.txt" "$out/stderr.txt"
report_case

# setsid 分岐は非対話 bash の background 起動で SIGINT の無視を継承する。
# INT handler は、SIGINT を受け取れる set -m 分岐を実際に起動して検査する。
no_setsid_path="$TMP_DIR/no-setsid-bin"
must mkdir -p "$no_setsid_path"
for utility in bash env mkdir dirname basename rm date ps tr cat grep cp sleep head pgrep awk; do
  must ln -s "$(command -v "$utility")" "$no_setsid_path/$utility"
done

for signame in TERM INT HUP; do
  new_case "AC3/4/DD: 待機中の $signame を記録して停止"
  export PDH_CODEX_RESUME_DELAY_SECONDS=2
  if [ "$signame" = INT ]; then
    PATH="$TMP_DIR/bin:$no_setsid_path" launch capacity "$SCRIPT" "$out" -- codex exec '指示'
  else
    launch capacity "$SCRIPT" "$out" -- codex exec '指示'
  fi
  await_file "$out/resume.log"
  i=0
  while ! grep -q 'phase=waiting' "$out/resume.log" && [ "$i" -lt 100 ]; do sleep 0.01; i=$((i + 1)); done
  must grep -q 'phase=waiting' "$out/resume.log"
  must kill -s "$signame" "$(cat "$out/pid.txt")"
  done_worker
  case "$signame" in TERM) expected_rc=143 ;; INT) expected_rc=130 ;; HUP) expected_rc=129 ;; esac
  eq rc "$expected_rc" "$(cat "$out/rc.txt")"
  contains "$out/resume.log" "round=1 phase=waiting"
  contains "$out/resume.log" "signal=$signame rc=$expected_rc"
  eq '起動回数' 1 "$(cat "$trace/count")"
  eq '--wait' "DONE rc=$expected_rc resumes=0" "$wait_output"
  absent "$out/resume-1.prompt.txt"
  report_case
done
export PDH_CODEX_RESUME_DELAY_SECONDS=0

new_case 'AC3/4: 再開実行中のsignalで --wait の再開回数を二重に数えない'
launch capacity,slow-success "$SCRIPT" "$out" -- codex exec '指示'
await_file "$out/resume.log"
i=0
while [ ! -f "$trace/started.2" ] && [ "$i" -lt 100 ]; do sleep 0.01; i=$((i + 1)); done
must test -f "$trace/started.2"
must kill -TERM "$(cat "$out/pid.txt")"
done_worker
eq rc 143 "$(cat "$out/rc.txt")"
eq '--wait' 'DONE rc=143 resumes=1' "$wait_output"
contains "$out/resume.log" 'round=1 phase=started'
contains "$out/resume.log" 'signal=TERM rc=143'
report_case

new_case 'AC4: 既定の初回待機は60秒（待機開始直後にsignalで停止）'
unset PDH_CODEX_RESUME_DELAY_SECONDS
launch capacity "$SCRIPT" "$out" -- codex exec '指示'
await_file "$out/resume.log"
i=0
while ! grep -q 'phase=waiting' "$out/resume.log" && [ "$i" -lt 100 ]; do sleep 0.01; i=$((i + 1)); done
contains "$out/resume.log" 'wait=60s'
must kill -TERM "$(cat "$out/pid.txt")"
done_worker
eq rc 143 "$(cat "$out/rc.txt")"
eq '起動回数' 1 "$(cat "$trace/count")"
report_case
export PDH_CODEX_RESUME_DELAY_SECONDS=0

for setting in max delay; do
  new_case "AC3: 不正な環境変数 $setting では再開しない"
  if [ "$setting" = max ]; then export PDH_CODEX_RESUME_MAX=bad; else export PDH_CODEX_RESUME_DELAY_SECONDS=1:2; fi
  launch capacity "$SCRIPT" "$out" -- codex exec '指示'
  done_worker
  expect_single
  eq rc 1 "$(cat "$out/rc.txt")"
  report_case
  export PDH_CODEX_RESUME_MAX=4 PDH_CODEX_RESUME_DELAY_SECONDS=0
done

new_case 'AC4: 上限0で自動再開を無効化'
export PDH_CODEX_RESUME_MAX=0
launch capacity "$SCRIPT" "$out" -- codex exec '指示'
done_worker
eq '起動回数' 1 "$(cat "$trace/count")"
eq rc 1 "$(cat "$out/rc.txt")"
contains "$out/resume.log" 'モデルの混雑で 0 回再開したが終わらなかった'
report_case
export PDH_CODEX_RESUME_MAX=4

# AC5: ファイル名を全部比較し、全ファイルを時刻・PID だけ正規化して比較する。
# 起動時の command= や stdout/stderr/stdin は正規化しない。
normalize() {
  local file="$1" name="${1##*/}"
  case "$name" in
    pid.txt|child-pid.txt) sed -E 's/^[0-9]+$/<pid>/' "$file" ;;
    spawn.txt) sed -E 's/^started_at=.*/started_at=<time>/; s/^self_pid=[0-9]+ parent_pid=[0-9]+$/self_pid=<pid> parent_pid=<pid>/; s/^session_leader=[0-9]+$/session_leader=<pid>/' "$file" ;;
    *) cat "$file" ;;
  esac
}
for command_kind in other success failure; do
  for input_kind in stdin no-stdin; do
    new_case "AC5: 旧版比較 $command_kind / $input_kind（ファイル全件・--wait・stdin）"
    printf 'stdin の全文\n末尾の改行\n\n' > "$case_dir/input.txt"
    command_args=(codex exec '引数の指示')
    plan="$command_kind"
    if [ "$command_kind" = other ]; then
      command_args=(bash -c 'printf "other stdout\n"; cat; printf "other stderr\n" >&2; exit 7')
      plan=success
    fi
    for version in old new; do
      out="$case_dir/$version-out"
      trace="$case_dir/$version-trace"
      must mkdir -p "$trace"
      if [ "$version" = old ]; then script="$BASELINE"; else script="$SCRIPT"; fi
      input_args=()
      if [ "$input_kind" = stdin ]; then input_args=(--stdin "$case_dir/input.txt"); fi
      launch "$plan" "$script" ${input_args[@]+"${input_args[@]}"} "$out" -- "${command_args[@]}"
      await_file "$out/rc.txt"
      result=$(bash "$script" --wait "$out" 2); result_rc=$?
      printf '%s\n%s\n' "$result_rc" "$result" > "$case_dir/$version-wait"
      (cd "$out" && printf '%s\n' * | LC_ALL=C sort) > "$case_dir/$version-files"
    done
    same "$case_dir/old-files" "$case_dir/new-files"
    same "$case_dir/old-wait" "$case_dir/new-wait"
    while IFS= read -r filename; do
      normalize "$case_dir/old-out/$filename" > "$case_dir/old-normalized"
      normalize "$case_dir/new-out/$filename" > "$case_dir/new-normalized"
      same "$case_dir/old-normalized" "$case_dir/new-normalized"
    done < "$case_dir/old-files"
    if [ "$command_kind" != other ]; then
      same "$case_dir/old-trace/stdin.1" "$case_dir/new-trace/stdin.1"
      same "$case_dir/old-trace/argv.1" "$case_dir/new-trace/argv.1"
      if [ "$input_kind" = stdin ]; then same "$case_dir/input.txt" "$case_dir/new-trace/stdin.1"; else must test ! -s "$case_dir/new-trace/stdin.1"; fi
    fi
    report_case
  done
done

new_case 'AC5: 生存中の --wait RUNNING と終了コードが旧版と同じ'
for version in old new; do
  out="$case_dir/$version-out"
  trace="$case_dir/$version-trace"
  must mkdir -p "$trace"
  if [ "$version" = old ]; then script="$BASELINE"; else script="$SCRIPT"; fi
  launch slow-success "$script" "$out" -- codex exec '指示'
  result=$(bash "$script" --wait "$out" 0); result_rc=$?
  printf '%s\n%s\n' "$result_rc" "$result" | sed -E 's/pid=[0-9]+/pid=<pid>/' > "$case_dir/$version-running"
  await_file "$out/rc.txt"
done
same "$case_dir/old-running" "$case_dir/new-running"
contains "$case_dir/new-running" 'RUNNING pid=<pid> alive=yes waited=0s — もう一度 --wait を呼ぶ'
report_case

if [ "$failures" -ne 0 ]; then
  printf 'FAIL: spawn-worker capacity resume (%s failures / %s cases)\n' "$failures" "$checks" >&2
  exit 1
fi
printf 'PASS: spawn-worker capacity resume (%s cases)\n' "$checks"
