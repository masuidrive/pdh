#!/usr/bin/env bash
# PR の run は分類・誘導・issue run の起動だけを行う。
pr_comment_engine() (
  local old_codex_home="${CODEX_HOME:-}" name feature
  local home="$RUNNER_DIR/classifier-home" args=()
  mkdir -p "$home/.codex" "$home/empty"
  if [ -n "$old_codex_home" ]; then
    [ ! -f "$old_codex_home/auth.json" ] || cp "$old_codex_home/auth.json" "$home/.codex/auth.json"
    if [ -f "$old_codex_home/siwc-access.json" ]; then
      CODEX_HOME="$old_codex_home" python3 "$SCRIPT_DIR/siwc-config.py" > "$home/.codex/config.toml"
    fi
  fi
  # 分類には provider 認証だけを渡す。GitHub token と作業用の設定は継承しない。
  for name in $(compgen -e); do
    case "$name" in PATH|LANG|LC_*|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY) ;;
      *TOKEN*|*SECRET*|*KEY*|*PAT*|*CREDENTIAL*) unset "$name";;
      *) export -n "$name";;
    esac
  done
  export HOME="$home" CODEX_HOME="$home/.codex" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  cd "$home/empty" || exit 1
  if [ "$ENGINE" = codex ]; then
    args=(--ignore-rules --ephemeral --sandbox read-only --skip-git-repo-check
      -c 'approval_policy="never"' -c 'sandbox_workspace_write.network_access=false'
      -c 'web_search="disabled"' -c features.shell_tool=false)
    for feature in apps plugins multi_agent multi_agent_v2 browser_use computer_use image_generation view_image sleep_tool request_permissions_tool memories hooks; do
      args+=(-c "features.$feature=false")
    done
    [ -z "${CODING_BOT_CODEX_MODEL:-}" ] || args+=(--model "$CODING_BOT_CODEX_MODEL")
    timeout "$RUN_TIMEOUT_SECONDS" codex exec "${args[@]}" -o "$RESULT_OUTPUT_FILE" - \
      <<< "$1
$USER_REQUEST" > "$RUNNER_DIR/classifier.log" 2>&1
  else
    [ -z "${CODING_BOT_CLAUDE_MODEL:-}" ] || args+=(--model "$CODING_BOT_CLAUDE_MODEL")
    timeout "$RUN_TIMEOUT_SECONDS" claude -p --tools "" --setting-sources "" \
      --settings '{"disableAllHooks":true}' --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
      --disable-slash-commands --no-session-persistence "${args[@]}" \
      --system-prompt "$1" --output-format json <<< "$USER_REQUEST" > "$RUNNER_DIR/classifier.json" || exit 1
    jq -er 'select(.is_error != true) | .result' "$RUNNER_DIR/classifier.json" > "$RESULT_OUTPUT_FILE"
  fi
)

pr_comment_redirect() {
  local resource comments
  resource=$(gh api "repos/$GITHUB_REPOSITORY/issues/$TRUSTED_LINKED_ISSUE") || { echo 'Warning: issue API unavailable; pending question link omitted' >&2; resource='{}'; }
  comments=$(gh api "repos/$GITHUB_REPOSITORY/issues/$TRUSTED_LINKED_ISSUE/comments?per_page=100" --paginate --slurp) || { echo 'Warning: comment API unavailable; pending question link omitted' >&2; comments='[]'; }
  [ -n "$resource" ] || { echo 'Warning: issue API unavailable; pending question link omitted' >&2; resource='{}'; }
  [ -n "$comments" ] || { echo 'Warning: comment API unavailable; pending question link omitted' >&2; comments='[]'; }
  jq -n --argjson issue "$resource" --argjson comments "$comments" '{issue:$issue,comments:$comments}' |
    python3 "$(dirname "${BASH_SOURCE[0]}")/discussion.py" redirect "$GITHUB_REPOSITORY" "$TRUSTED_LINKED_ISSUE"
}

run_pr_comment() (
  trap 'rm -rf -- "$RUNNER_DIR/classifier-home"' EXIT
  local decision other response status=0
  RESULT_OUTPUT_FILE="$RUNNER_DIR/pr-classification.json"
  if pr_comment_engine "$(cat "$SCRIPT_DIR/_pr.md")" &&
    jq -e -s 'length == 1 and (.[0] | type == "object" and (.conflict | type) == "boolean" and (.other | type) == "boolean")' "$RESULT_OUTPUT_FILE" >/dev/null; then
    decision=$(jq -r '.conflict' "$RESULT_OUTPUT_FILE")
    other=$(jq -r '.other' "$RESULT_OUTPUT_FILE")
    if [ "${TARGET_REASON:-}" = 'PR が閉じています' ]; then
      response='PR が閉じているため動きません。'
      [ "$decision" != true ] || response='PR が閉じているため解消しませんでした。'
      response+=" $(pr_comment_redirect)" || response+=" [issue](https://github.com/$GITHUB_REPOSITORY/issues/$TRUSTED_LINKED_ISSUE) に書いてください。"
      gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body "$response" || return 1
      : > "$GITHUB_WORKSPACE/.coding-bot-reported"
      return 0
    fi
    if [ "$decision" = true ]; then
      # 依頼者の文は渡さず、確認済みの番号だけで固定の仕事を起動する。
      gh workflow run coding-bot.yml --repo "$GITHUB_REPOSITORY" --ref "$BASE_BRANCH" \
        -f issue="$TRUSTED_LINKED_ISSUE" -f resolve_conflict_pr="$ISSUE_NUMBER" -f verify_only=false || status=1
    fi
    if [ "$decision" = true ] && [ "$status" = 0 ]; then
      REPORT_ISSUE="$TRUSTED_LINKED_ISSUE"
      pr_comment_guide "$ISSUE_NUMBER" "https://github.com/$GITHUB_REPOSITORY/issues/$REPORT_ISSUE" "conflict の解消を始めました。結果は [issue](https://github.com/$GITHUB_REPOSITORY/issues/$REPORT_ISSUE) に出ます。" || echo 'Warning: conflict start notice delivery failed' >&2
    fi
    if [ "$decision" != true ] || [ "$other" = true ] || [ "$status" != 0 ]; then
      if response=$(pr_comment_redirect); then
        [ "$status" = 0 ] || response="解消の起動に失敗しました。 $response"
        gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body "$response" || {
          [ "$decision" = true ] && [ "$status" = 0 ] || return 1
          echo 'Warning: redirect delivery failed; conflict run was dispatched' >&2
        }
      else
        [ "$decision" = true ] && [ "$status" = 0 ] || return 1
        echo 'Warning: redirect unavailable; conflict run was dispatched' >&2
      fi
    fi
  else
    status=1
    response=$(pr_comment_redirect) || return 1
    if [ "${TARGET_REASON:-}" = 'PR が閉じています' ]; then
      response="PR が閉じているため動きません。 $response"
    else response="依頼を分類できなかったため、conflict 解消を起動していません。 $response"; fi
    gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body "$response" || return 1
  fi
  : > "$GITHUB_WORKSPACE/.coding-bot-reported"
  return "$status"
)

pr_comment_guide() {
  local pr="$1" report="$2" id body comments
  body="<!-- coding-bot:pr-guide -->
[報告・質問]($report) は [issue](https://github.com/$GITHUB_REPOSITORY/issues/$REPORT_ISSUE) にあります。PR では Merge と、🤖 付きの conflict 解消の依頼ができます。${3:+

$3}"
  comments=$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments?per_page=100" --paginate --slurp) || return 1
  id=$(printf '%s' "$comments" | jq -r '[.[][] | select(.user.login == "github-actions[bot]") | select(.body | startswith("<!-- coding-bot:pr-guide -->"))] | first | .id // empty') || return 1
  if [[ "$id" =~ ^[1-9][0-9]*$ ]]; then
    gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body"
  else
    gh issue comment "$pr" --repo "$GITHUB_REPOSITORY" --body "$body"
  fi
}
