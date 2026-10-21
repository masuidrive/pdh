#!/usr/bin/env bash
# PR コメントは意味を読んでから conflict 解消だけを実行する。
pr_comment_engine() {
  local instruction="$1"
  SYSTEM_PROMPT="$instruction"
  printf '%s' "$USER_REQUEST" > "/tmp/agent-prompt-$ISSUE_NUMBER.txt"
  JSON_OUTPUT_FILE="$RUNNER_DIR/pr-output.json"
  PROGRESS_OUTPUT_FILE="$RUNNER_DIR/pr-progress.txt"
  RESULT_OUTPUT_FILE="$RUNNER_DIR/pr-result.txt"
  TASK_STATUS_FILE="$RUNNER_DIR/pr-tasks.txt"
  TIMEOUT_VALUE="$RUN_TIMEOUT_SECONDS"
  rm -f "$RESULT_OUTPUT_FILE" /tmp/agent-result.md
  engine_run
  ENGINE_EXIT_CODE=0
  wait "$ENGINE_PID" || ENGINE_EXIT_CODE=$?
  [ "$ENGINE_EXIT_CODE" = 0 ] || return 1
  engine_extract_result
}

pr_comment_redirect() {
  local question
  question=$(gh api "repos/$GITHUB_REPOSITORY/issues/$TRUSTED_LINKED_ISSUE/comments?per_page=100" --paginate --slurp \
    --jq '[.[][] | select(.user.login == "github-actions[bot]") | select(.body | contains("<!-- coding-bot:question -->"))] | last | .html_url // empty') || return 1
  printf '依頼・質問への回答は [issue](https://github.com/%s/issues/%s) に書いてください。PR では Merge と conflict 解消の依頼を受け付けます。%s' \
    "$GITHUB_REPOSITORY" "$TRUSTED_LINKED_ISSUE" "${question:+ [質問はこちら]($question)}"
}

pr_comment_index() {
  python3 - "$RUNNER_DIR/conflicts" <<'PYINDEX'
import subprocess, sys
from pathlib import Path
conflicts = set(Path(sys.argv[1]).read_bytes().split(b"\0"))
for entry in subprocess.check_output(["git", "ls-files", "--stage", "-z"]).split(b"\0"):
    if entry and entry.split(b"\t", 1)[1] not in conflicts:
        sys.stdout.buffer.write(entry + b"\0")
PYINDEX
}

run_pr_comment() {
  local action other before base response merge_status=0 hooks
  before=$(git rev-parse HEAD)
  base=$(git rev-parse "origin/$BASE_BRANCH")
  # engine に push をさせず、runner が最後に 1 回だけ push する。
  hooks="$RUNNER_DIR/no-push"
  mkdir -p "$hooks"
  printf '#!/bin/sh\nexit 1\n' > "$hooks/pre-push"
  chmod +x "$hooks/pre-push"
  git config --local core.hooksPath "$hooks"
  if ! pr_comment_engine "$(cat "$SCRIPT_DIR/_pr.md")"; then return 1; fi
  action=$(jq -r 'if type == "object" and (.conflict | type) == "boolean" and (.other | type) == "boolean" then .conflict else error("invalid decision") end' "$RESULT_OUTPUT_FILE") || return 1
  other=$(jq -r '.other' "$RESULT_OUTPUT_FILE")
  [ "$(git rev-parse HEAD)" = "$before" ] && git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ] || return 1
  response=$(pr_comment_redirect) || return 1
  if [ "$action" = true ]; then
    git merge --no-commit --no-ff "$base" || merge_status=$?
    if [ "$merge_status" = 0 ]; then
      if git rev-parse -q --verify MERGE_HEAD >/dev/null; then git merge --abort; fi
      response="解消する conflict はありません。${other:+ $response}"
    else
      git diff --name-only --diff-filter=U -z > "$RUNNER_DIR/conflicts"
      [ -s "$RUNNER_DIR/conflicts" ] || return 1
      pr_comment_index > "$RUNNER_DIR/index-before"
      # 元の依頼は解決 engine に渡さない。質問や別の修正が混じっても実行されない。
      USER_REQUEST="$(git diff --name-only --diff-filter=U)"
      if ! pr_comment_engine '列挙されたファイルの merge conflict だけを解消してください。git add/commit/push、別の修正、ticket 更新、GitHub への投稿は禁止です。最終出力は JSON だけにし、解消できたら {"resolved":true}、解消できない判断があれば {"resolved":false} を返してください。'; then return 1; fi
      jq -e 'type == "object" and .resolved == true' "$RESULT_OUTPUT_FILE" >/dev/null || return 1
      [ "$(git rev-parse HEAD)" = "$before" ] || return 1
      while IFS= read -r -d '' path; do git add -- "$path" || return 1; done < "$RUNNER_DIR/conflicts"
      pr_comment_index > "$RUNNER_DIR/index-after"
      cmp "$RUNNER_DIR/index-before" "$RUNNER_DIR/index-after" || return 1
      git diff --quiet && [ -z "$(git diff --name-only --diff-filter=U)" ] || return 1
      git diff --cached --check || return 1
      git -c core.hooksPath=/dev/null commit -m "Merge $BASE_BRANCH into $BRANCH_NAME to resolve conflicts" || return 1
      # non-fast-forward は拒否し、人や issue run の並行 push を上書きしない。
      git -c core.hooksPath=/dev/null push origin "HEAD:refs/heads/$BRANCH_NAME" || return 1
      response="conflict を解消して push しました。 $response"
    fi
  fi
  gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body "$response" || return 1
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID" \
    -f body="PR の依頼を処理しました。[PR](https://github.com/$GITHUB_REPOSITORY/pull/$ISSUE_NUMBER) の返信を参照してください。" || return 1
  : > "$GITHUB_WORKSPACE/.coding-bot-reported"
}
