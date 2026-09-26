# shellcheck shell=bash

if [ "${CODING_ROBOT_STUB_OPT_IN:-}" != local-test-only ] || [ "${GITHUB_ACTIONS:-}" = true ]; then
  echo "stub engine refused outside explicit local test mode" >&2
  return 1 2>/dev/null || exit 1
fi

engine_setup_auth() { :; }
engine_run() {
  (
    prompt="${CODING_ROBOT_STUB_PROMPT:?stub prompt required}"
    fixture="${CODING_ROBOT_STUB_FIXTURE:?stub fixture required}"
    # ⚠ prompt が «いまの契約» を運んでいることを確かめる。撤去した decision board の
    # 文字列ではなく、2 分割の gate 判定と PR-merge close gate の文を見る。
    for required in 'keyword の表でコメントを分類しない' 'gate を越えるか'; do
      grep -q "$required" <<< "$prompt" || { echo "stub prompt contract missing: $required" >&2; exit 2; }
    done
    case "${CODING_ROBOT_STUB_SCENARIO:?stub scenario required}" in
      # gate を越える（ticket gate）
      cross-gate)
        printf 'cross\n' >> "$fixture/decisions.log"
        touch "$fixture/implementation-started"
        printf 'gate を越えた: 承認と読んだ\n' > "$RESULT_OUTPUT_FILE"
        ;;
      # 越えずに ticket を直す
      stay-and-edit)
        printf 'stay:edit\n' >> "$fixture/decisions.log"
        printf 'gate を越えない: AC を直して再度承認を促す\n' > "$RESULT_OUTPUT_FILE"
        ;;
      # 越えずに質問へ答える
      stay-and-answer)
        printf 'stay:answer\n' >> "$fixture/decisions.log"
        printf 'gate を越えない: 質問に答えた\n' > "$RESULT_OUTPUT_FILE"
        ;;
      # close gate: PR に板を出して停止する。⚠ PR metadata marker は出さない
      # （PR は既にあり、close 承認は merge そのものだから）
      close-board)
        printf 'close-board\n' >> "$fixture/decisions.log"
        printf 'close 判断ボード。merge が close 承認です\n' > "$RESULT_OUTPUT_FILE"
        ;;
      *) exit 2 ;;
    esac
  ) &
  ENGINE_PID=$!
}
engine_extract_result() { :; }
engine_error_details() { printf '%s\n' "stub engine failure"; }
