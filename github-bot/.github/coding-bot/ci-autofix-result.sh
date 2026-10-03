#!/usr/bin/env bash
# CI 自動修正だけの終端処理。agent は commit まで行い、push と報告はここで行う。

ci_autofix_red_marker() {
  # issue に同じ PR の過去 SHA の報告が残っていても、別 PR の報告と区別する。
  # decision.sh もこの終端処理を source し、同じ目印で投稿・解決する。
  printf '<!-- coding-bot:ci-red pr=%s sha=%s run=%s -->' "$1" "$2" "$3"
}

ci_failure_steps() (
  local repository="$1" run_id="$2" jobs summary log_dir log_status reason details=""
  jobs=$(gh api "repos/$repository/actions/runs/$run_id/jobs?per_page=100" --paginate --slurp) || return 1
  summary=$(printf '%s' "$jobs" | jq -r '[.[].jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out") |
    .name as $job | ([.steps[]? | select(.conclusion == "failure" or .conclusion == "timed_out") | .name] | join(", ")) as $steps |
    if $steps == "" then $job else "\($job): \($steps)" end] |
    if length == 0 then "失敗 step の情報なし（workflow の定義エラー等。run のログを確認）" else join(" / ") end') || return 1
  local -a log_args=("${run_id%%/*}" --repo "$repository" --log-failed)
  if [[ "$run_id" == */attempts/* ]]; then
    log_args+=(--attempt "${run_id##*/}")
  fi
  # The subshell owns cleanup without replacing the caller's EXIT trap.
  log_dir=$(mktemp -d) || { printf '%s\n' "$summary"; return; }
  trap 'rm -rf "$log_dir"' EXIT
  # Logs are optional; partial downloads must not become failure details.
  if timeout 60 gh run view "${log_args[@]}" > "$log_dir/log" 2> "$log_dir/error"; then
    # Scan all ordinary logs, or the final 50 MiB of oversized logs. Discard
    # the partial first line at the byte cutoff. Only three bodies are retained.
    details=$(tail -c 52428800 "$log_dir/log" | awk -v size="$(wc -c < "$log_dir/log")" '
      NR == 1 && size > 52428800 { next }
      {
        if (!sub(/^[^\t]*\t[^\t]*\t/, "")) next
        sub(/^[^ ]+ /, "")
        gsub(/\033\[[0-?]*[ -/]*[@-~]/, "")
        if ($0 !~ /^[[:space:]]*((\[[^]]*\]|---)[[:space:]]+)*(FAIL|FAILED|ERROR)([^[:alnum:]_]|$)/) next
        gsub(/[\r\t]/, " ")
        sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+$/, "")
        for (i = 1; i <= count; i++) {
          if (body[i] == $0) {
            for (j = i; j < count; j++) body[j] = body[j + 1]
            count--; break
          }
        }
        if (count == 3) { body[1] = body[2]; body[2] = body[3]; count-- }
        body[++count] = $0
      }
      END { for (i = 1; i <= count; i++) print body[i] }
    ' | jq -Rrs 'split("\n") | map(select(length > 0) | .[0:200] |
      gsub("`"; "\u0027") | "`" + . + "`") | join(" / ")') || details=""
  else
    log_status=$?
    IFS= read -r -n 200 reason < "$log_dir/error" || :
    reason=$(printf '%s' "$reason" | sed -E $'s/\033\\[[0-?]*[ -/]*[@-~]//g')
    reason=${reason//$'\r'/ }
    if [ "$log_status" -eq 124 ]; then
      reason="timed out after 60 seconds${reason:+: $reason}"
    elif [ -z "$reason" ]; then
      reason="gh exited with status $log_status"
    fi
    printf 'ci_failure_steps: log unavailable for run %s: %s\n' "$run_id" "$reason" >&2
  fi
  if [ -n "$details" ]; then summary+=" — $details"; fi
  printf '%s\n' "$summary"
)

ci_autofix_prepare() {
  local pr_data reason="" body marker
  if ! pr_data=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$ISSUE_NUMBER"); then
    reason='PR の状態を取得できなかったため、agent を起動しません。'
  elif [ "$(printf '%s' "$pr_data" | jq -r '.auto_merge != null')" = true ]; then
    # agent の途中の push も、人が見ていない修正を merge させてはならない。
    if ! gh pr merge "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --disable-auto; then
      reason='auto-merge を外せなかったため、agent を起動しません。'
    elif ! gh pr comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body \
      $'auto-merge を外した。直した内容を確かめて Merge してほしい\n\n<!-- coding-bot -->'; then
      reason='auto-merge は外しましたが、PR への通知に失敗したため、agent を起動しません。'
    fi
  fi
  if [ -n "$reason" ]; then
    marker=$(ci_autofix_red_marker "$ISSUE_NUMBER" "$CI_AUTOFIX_HEAD_SHA" "$CI_AUTOFIX_RUN_ID")
    body=$(printf '%s\n\n直せなかった: %s\n\nCI: %s/%s/actions/runs/%s\n\n<!-- coding-bot -->' \
      "$marker" "$reason" "${GITHUB_SERVER_URL:-https://github.com}" "$GITHUB_REPOSITORY" "$CI_AUTOFIX_RUN_ID")
    gh issue comment "$TRUSTED_LINKED_ISSUE" --repo "$GITHUB_REPOSITORY" --body "$body" || return 1
    gh issue edit "$TRUSTED_LINKED_ISSUE" --repo "$GITHUB_REPOSITORY" --add-label awaiting-reply || return 1
    : > "${GITHUB_WORKSPACE:-.}/.coding-bot-reported"
    return 1
  fi
}

ci_autofix_finish() {
  local reason="" pr_data new_sha summary body auto_merge_note="" changes marker
  marker=$(ci_autofix_red_marker "$ISSUE_NUMBER" "$CI_AUTOFIX_HEAD_SHA" "$CI_AUTOFIX_RUN_ID")
  new_sha=$(git rev-parse HEAD) || return 1
  if [ "$ENGINE_EXIT_CODE" -ne 0 ]; then
    reason="agent が正常終了しませんでした（exit $ENGINE_EXIT_CODE）。"
  elif [ "$new_sha" = "$CI_AUTOFIX_START_SHA" ]; then
    reason="CI の失敗を直す commit を作れませんでした。"
  elif ! git diff --quiet || ! git diff --cached --quiet; then
    reason="未 commit の変更が残っているため、修正を push できませんでした。"
  elif [ -z "${CODING_BOT_GH_PAT:-}" ]; then
    reason="CI を起動する push に必要な CODING_BOT_GH_PAT がありません。"
  fi
  if [ -z "$reason" ]; then
    pr_data=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$ISSUE_NUMBER") || return 1
    if ! printf '%s' "$pr_data" | jq -e --arg sha "$CI_AUTOFIX_HEAD_SHA" \
      '.state == "open" and .draft == false and .head.sha == $sha' >/dev/null; then
      reason="修正中に PR の head または状態が変わったため、push を止めました。"
    elif [ "$(printf '%s' "$pr_data" | jq -r '.auto_merge != null')" = true ]; then
      # 解除できない場合は push しない。失敗を握り潰すと未確認の修正が merge される。
      if gh pr merge "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --disable-auto; then
        auto_merge_note="auto-merge を外した。直した内容を確かめて Merge してほしい"
      else
        reason="auto-merge を外せなかったため、push を止めました。"
      fi
    fi
  fi
  if [ -z "$reason" ]; then
    use_pat_for_origin
    # 通常の fast-forward push。並行する人の push は上書きしない。
    if ! git push --no-verify origin "HEAD:$BRANCH_NAME"; then
      reason="修正 commit を push できませんでした。"
    fi
  fi
  summary=$(ci_failure_steps "$GITHUB_REPOSITORY" "$CI_AUTOFIX_RUN_ID") \
    || summary="失敗 step の情報を取得できませんでした。run のログを確認してください。"
  body=$(printf '何が落ちていたか: %s\n\nCI: https://github.com/%s/actions/runs/%s\n' \
    "$summary" "$GITHUB_REPOSITORY" "$CI_AUTOFIX_RUN_ID")
  if [ -n "$reason" ]; then
    body=$(printf '%s\n\n直せなかった: %s\n\n%s\n\n%s\n\n%s\n\n<!-- coding-bot -->' \
      "$marker" "$reason" "$body" "$CLAUDE_OUTPUT" "$auto_merge_note")
    gh issue comment "$TRUSTED_LINKED_ISSUE" --repo "$GITHUB_REPOSITORY" --body "$body" || return 1
    gh issue edit "$TRUSTED_LINKED_ISSUE" --repo "$GITHUB_REPOSITORY" --add-label awaiting-reply || return 1
    gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID" \
      -f body="$marker

直せなかった。理由は #$TRUSTED_LINKED_ISSUE に報告しました。

<!-- coding-bot -->" || return 1
  else
    changes=$(git log --format='- %s' "$CI_AUTOFIX_START_SHA..HEAD") || return 1
    body=$(printf '%s\n\n%s\n\n何を直したか:\n%s\n\n%s\n\n%s\n\n修正 commit: %s\n\nCI の結果を確認し、緑なら Merge してください。\n\n<!-- coding-bot -->' \
      "$marker" "$body" "$CLAUDE_OUTPUT" "$changes" "$auto_merge_note" "$new_sha")
    gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID" -f body="$body" || return 1
  fi
  : > "${GITHUB_WORKSPACE:-.}/.coding-bot-reported"
}
