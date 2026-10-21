#!/usr/bin/env bash
# PR コメントは意味を読んでから conflict 解消だけを実行する。
pr_comment_engine() {
  local instruction="$1"
  SYSTEM_PROMPT="$instruction"
  local PR_ENGINE_MODE="${2:-classify}" old_codex_home="${CODEX_HOME:-}" name key value status=0
  local -a header_keys=() header_values=()
  local ENGINE_PROMPT_FILE="$RUNNER_DIR/pr-prompt.txt"
  printf '%s' "$USER_REQUEST" > "$ENGINE_PROMPT_FILE"
  JSON_OUTPUT_FILE="$RUNNER_DIR/pr-output.json"
  PROGRESS_OUTPUT_FILE="$RUNNER_DIR/pr-progress.txt"
  RESULT_OUTPUT_FILE="$RUNNER_DIR/pr-result.txt"
  TASK_STATUS_FILE="$RUNNER_DIR/pr-tasks.txt"
  TIMEOUT_VALUE="$RUN_TIMEOUT_SECONDS"
  rm -f "$RESULT_OUTPUT_FILE" "$JSON_OUTPUT_FILE"
  while IFS= read -r key; do
    while IFS= read -r value; do
      header_keys+=("$key"); header_values+=("$value")
    done < <(git config --local --get-all "$key")
    git config --local --unset-all "$key"
  done < <(git config --local --name-only --get-regexp '^(http\..*\.extraheader|credential\..*)$' || true)
  (
    # CLI に渡す環境は provider 認証と実行に要る項目だけにする。
    for name in $(compgen -e); do
      case "$name" in PATH|LANG|LC_*|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY) ;;
        *TOKEN*|*SECRET*|*KEY*|*PAT*|*CREDENTIAL*) unset "$name";;
        *) export -n "$name";;
      esac
    done
    export HOME="$RUNNER_DIR/pr-home" CODEX_HOME="$RUNNER_DIR/pr-home/.codex"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    mkdir -p "$CODEX_HOME" "$HOME/empty"
    if [ -n "$old_codex_home" ]; then
      [ ! -f "$old_codex_home/auth.json" ] || cp "$old_codex_home/auth.json" "$CODEX_HOME/auth.json"
      if [ -f "$old_codex_home/siwc-access.json" ]; then
        CODEX_HOME="$old_codex_home" python3 "$SCRIPT_DIR/siwc-config.py" > "$CODEX_HOME/config.toml"
      fi
    fi
    [ "$PR_ENGINE_MODE" != classify ] || cd "$HOME/empty" || exit 1
    engine_run
    ENGINE_EXIT_CODE=0
    wait "$ENGINE_PID" || ENGINE_EXIT_CODE=$?
    [ "$ENGINE_EXIT_CODE" = 0 ] || exit 1
    engine_extract_result
  ) || status=$?
  for name in "${!header_keys[@]}"; do
    git config --local --add "${header_keys[$name]}" "${header_values[$name]}"
  done
  return "$status"
}

pr_comment_redirect() {
  local question
  question=$(python3 "$(dirname "${BASH_SOURCE[0]}")/pending_question.py" "$GITHUB_REPOSITORY" "$TRUSTED_LINKED_ISSUE") || return 1
  local questions="" link
  while IFS= read -r link; do
    [ -z "$link" ] || questions+=" [質問はこちら]($link)"
  done <<< "$question"
  printf '依頼・質問への回答は [issue](https://github.com/%s/issues/%s) に書いてください。PR では Merge と conflict 解消の依頼を受け付けます。%s' \
    "$GITHUB_REPOSITORY" "$TRUSTED_LINKED_ISSUE" "$questions"
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

pr_comment_work() {
  local action other before base response merge_status=0 hooks
  before=$(git rev-parse HEAD)
  base=$(git rev-parse "origin/$BASE_BRANCH")
  # engine に push をさせず、runner が最後に 1 回だけ push する。
  hooks="$RUNNER_DIR/no-push"
  mkdir -p "$hooks"
  printf '#!/bin/sh\nexit 1\n' > "$hooks/pre-push"
  chmod +x "$hooks/pre-push"
  git config --local core.hooksPath "$hooks"
  PR_COMMENT_PHASE="依頼の分類"
  if ! pr_comment_engine "$(cat "$SCRIPT_DIR/_pr.md")"; then return 1; fi
  jq -e -s 'length == 1 and (.[0] | type == "object" and (.conflict | type) == "boolean" and (.other | type) == "boolean")' "$RESULT_OUTPUT_FILE" >/dev/null || return 1
  action=$(jq -r 'if type == "object" and (.conflict | type) == "boolean" and (.other | type) == "boolean" then .conflict else error("invalid decision") end' "$RESULT_OUTPUT_FILE") || return 1
  other=$(jq -r '.other' "$RESULT_OUTPUT_FILE")
  [ "$(git rev-parse HEAD)" = "$before" ] && git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ] || return 1
  response=$(pr_comment_redirect) || return 1
  if [ "$action" = true ]; then
    PR_COMMENT_PHASE="base branch の取り込み"
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
      PR_COMMENT_PHASE="conflict の解消"
      if ! pr_comment_engine '列挙されたファイルの merge conflict だけを解消してください。git add/commit/push、別の修正、ticket 更新、GitHub への投稿は禁止です。最終出力は JSON だけにし、解消できたら {"resolved":true}、解消できない判断があれば {"resolved":false} を返してください。' resolve; then return 1; fi
      PR_COMMENT_PHASE="解消結果の検査"
      jq -e -s 'length == 1 and (.[0] | type == "object" and .resolved == true)' "$RESULT_OUTPUT_FILE" >/dev/null || return 1
      [ "$(git rev-parse HEAD)" = "$before" ] || return 1
      while IFS= read -r -d '' path; do git add -- "$path" || return 1; done < "$RUNNER_DIR/conflicts"
      pr_comment_index > "$RUNNER_DIR/index-after"
      cmp "$RUNNER_DIR/index-before" "$RUNNER_DIR/index-after" || return 1
      git diff --quiet && [ -z "$(git diff --name-only --diff-filter=U)" ] || return 1
      while IFS= read -r -d '' path; do
        local marker_status=0
        git grep --cached -q -E '^(<<<<<<< |=======$|>>>>>>> )' -- "$path" || marker_status=$?
        [ "$marker_status" = 1 ] || return 1
      done < "$RUNNER_DIR/conflicts"
      git -c core.hooksPath=/dev/null commit -m "Merge $BASE_BRANCH into $BRANCH_NAME to resolve conflicts" || return 1
      # non-fast-forward は拒否し、人や issue run の並行 push を上書きしない。
      PR_COMMENT_PHASE="検査済み commit の push"
      git -c core.hooksPath=/dev/null push origin "HEAD:refs/heads/$BRANCH_NAME" || return 1
      if [ "${ORIGIN_PUSH_AUTH:-github_token}" = github_token ]; then dispatch_branch_ci; fi
      response="conflict を解消して push しました。 $response"
    fi
  fi
  gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body "$response" || return 1
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID" \
    -f body="PR の依頼を処理しました。[PR](https://github.com/$GITHUB_REPOSITORY/pull/$ISSUE_NUMBER) の返信を参照してください。" || return 1
  : > "$GITHUB_WORKSPACE/.coding-bot-reported"
}


pr_comment_guide() {
  local pr="$1" report="$2" id body
  body="<!-- coding-bot:pr-guide -->
[報告・質問]($report) は [issue](https://github.com/$GITHUB_REPOSITORY/issues/$REPORT_ISSUE) にあります。PR では Merge と、🤖 付きの conflict 解消の依頼ができます。"
  id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments?per_page=100" --paginate --slurp | jq -r '[.[][] | select(.user.login == "github-actions[bot]") | select(.body | startswith("<!-- coding-bot:pr-guide -->"))] | first | .id // empty') || return 1
  if [[ "$id" =~ ^[1-9][0-9]*$ ]]; then
    gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body"
  else
    gh issue comment "$pr" --repo "$GITHUB_REPOSITORY" --body "$body"
  fi
}


run_pr_comment() (
  local status=0 old_hooks="" had_hooks=false
  if old_hooks=$(git config --local --get core.hooksPath); then had_hooks=true; fi
  pr_comment_work || status=$?
  if [ "$status" != 0 ]; then
    git merge --abort >/dev/null 2>&1 || true
    local issue_url="https://github.com/$GITHUB_REPOSITORY/issues/$TRUSTED_LINKED_ISSUE"
    local log_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/${GITHUB_RUN_ID:-}"
    gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" \
      --body "conflict の解消を完了できませんでした。理由と続きは [issue]($issue_url) のこの run の報告にあります。" || true
    if gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID" \
      -f body="${PR_COMMENT_PHASE:-PR の依頼処理}に失敗しました。自動処理を停止しました。このスレッドで対応を相談してください。[実行ログ]($log_url) / [PR](https://github.com/$GITHUB_REPOSITORY/pull/$ISSUE_NUMBER)"; then
      : > "$GITHUB_WORKSPACE/.coding-bot-reported"
    fi
  fi
  if [ "$had_hooks" = true ]; then
    git config --local core.hooksPath "$old_hooks"
  else
    git config --local --unset core.hooksPath || true
  fi
  exit "$status"
)
