#!/usr/bin/env bash
# issue の通常の merge 経路を使い、固定の conflict 解消だけで終える。
resolve_issue_conflict() {
  local status=0 result snapshot before="$CONFLICT_START_SHA" base="$CONFLICT_BASE_SHA"
  if [ "$MERGE_EXIT_CODE" != 0 ]; then
    [ -n "$CONFLICT_FILES" ] || status=1
    snapshot=$(python3 "$SCRIPT_DIR/conflict-scope.py" snapshot) || status=1
    if [ "$status" = 0 ]; then
      SYSTEM_PROMPT='列挙された merge conflict だけを解消し、merge commit を作ってください。その他の修正・ticket 更新・GitHub 投稿・push はしないでください。解消後は作業を終了してください。'
      printf '%s\n' "$CONFLICT_SECTION" > "/tmp/agent-prompt-$ISSUE_NUMBER.txt"
      JSON_OUTPUT_FILE="$RUNNER_DIR/conflict-output.json"
      PROGRESS_OUTPUT_FILE="$RUNNER_DIR/conflict-progress.txt"
      RESULT_OUTPUT_FILE="$RUNNER_DIR/conflict-result.txt"
      TASK_STATUS_FILE="$RUNNER_DIR/conflict-tasks.txt"
      TIMEOUT_VALUE="${CODING_BOT_TIMEOUT:-5400}"
      source "$ENGINE_FILE"
      engine_setup_auth
      engine_run
      wait "$ENGINE_PID" || status=$?
      if [ "$status" = 0 ]; then
        printf '%s' "$snapshot" | python3 "$SCRIPT_DIR/conflict-scope.py" verify "$before" "$base" || status=1
      fi
    fi
  fi
  if [ "$status" = 0 ]; then
    if [ "$(git rev-parse HEAD)" != "$before" ]; then
      git push origin "HEAD:refs/heads/$BRANCH_NAME" || status=1
    fi
  fi
  if [ "$status" = 0 ]; then
    if [ "$MERGE_EXIT_CODE" = 0 ]; then result='解消する conflict はありません。base branch を取り込みました。'
    else result='conflict を解消して push しました。'; fi
    gh issue comment "$RESOLVE_CONFLICT_PR" --repo "$GITHUB_REPOSITORY" --body "$result" || status=1
  else
    git merge --abort >/dev/null 2>&1 || true
    result="conflict の解消を完了できませんでした。このスレッドで対応を相談してください。[実行ログ](https://github.com/$GITHUB_REPOSITORY/actions/runs/${GITHUB_RUN_ID:-})"
  fi
  gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" \
    --body "$result [PR](https://github.com/$GITHUB_REPOSITORY/pull/$RESOLVE_CONFLICT_PR)" || status=1
  : > "$GITHUB_WORKSPACE/.coding-bot-reported"
  return "$status"
}
