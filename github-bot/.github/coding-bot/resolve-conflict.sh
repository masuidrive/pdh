#!/usr/bin/env bash
# issue の通常の merge 経路を使い、固定の conflict 解消だけで終える。
resolve_issue_conflict() {
  CONFLICT_RUN_RESULT=failed
  CONFLICT_PUSHED_SHA=''
  local status=0 snapshot before="$CONFLICT_START_SHA" base="$CONFLICT_BASE_SHA"
  if [ "$MERGE_EXIT_CODE" = 0 ] && git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    git merge --abort || status=1
  fi
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
    CONFLICT_RUN_RESULT=no_conflict
    if [ "$(git rev-parse HEAD)" != "$before" ]; then
      CONFLICT_RUN_RESULT=failed
      if [ -n "${CODING_BOT_GH_PAT:-}" ]; then
        use_pat_for_origin
        git push origin "HEAD:refs/heads/$BRANCH_NAME" || status=1
      else
        git push origin "HEAD:refs/heads/$BRANCH_NAME" && dispatch_branch_ci || status=1
      fi
      if [ "$status" = 0 ]; then
        CONFLICT_RUN_RESULT=pushed
        CONFLICT_PUSHED_SHA=$(git rev-parse HEAD)
      fi
    fi
  fi
  if [ "$status" != 0 ]; then git merge --abort >/dev/null 2>&1 || true; fi
  return "$status"
}
