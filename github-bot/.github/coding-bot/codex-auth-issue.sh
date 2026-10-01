# shellcheck shell=bash
# Runtime reports go through the auth workflow's repository-wide lock. Only that
# serialized workflow may directly create the shared Issue, avoiding duplicates.

codex_auth_relogin_command() {
  case "${1:-}" in
    siwc)
      printf 'python3 .github/coding-bot/siwc-login.py --repo %q --secret CODING_BOT_CODEX_SIWC_JSON\n' "$GITHUB_REPOSITORY"
      ;;
    codex-login)
      local secret="${CODING_BOT_CODEX_LOGIN_SECRET:-CODING_BOT_CODEX_AUTH_JSON}"
      [[ "$secret" =~ ^[A-Z_][A-Z0-9_]*$ ]] || return 1
      printf 'd=$(mktemp -d) && CODEX_HOME="$d" codex login && jq -e . "$d/auth.json" >/dev/null && jq -c . "$d/auth.json" | gh secret set %q --repo %q; rm -rf "$d"\n' "$secret" "$GITHUB_REPOSITORY"
      ;;
    *) return 1 ;;
  esac
}

_codex_auth_issue_api() {
  # GITHUB_TOKEN has Issues/Actions permissions; the PAT is reserved for secret
  # and variable operations. gh errors may echo sensitive data, so suppress them.
  GH_TOKEN="$GITHUB_TOKEN" timeout -k 5 60 gh api "$@" 2>/dev/null
}

codex_post_operational_note() {
  local mode="$1" message="$2" marker bodies
  marker="<!-- coding-bot-provider:$mode:$(date -u +%F) -->"
  bodies=$(_codex_auth_issue_api "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments" \
    --paginate --slurp --jq 'flatten | .[].body') || return 1
  [[ "$bodies" != *"$marker"* ]] || return 0
  _codex_auth_issue_api "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments" \
    --method POST -f body="$message
$marker" >/dev/null
}

codex_auth_issue() {
  local mode="${1:-}" cause="${2:-}" kind="${3:-auth}" command display_mode branch issue_number message marker=''
  case "$kind" in auth|operational|stale) ;; *) return 1 ;; esac
  case "$mode" in
    siwc) display_mode=SIWC ;;
    codex-login) display_mode='codex login' ;;
    *) return 1 ;;
  esac
  [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "$cause" ] || return 1
  if [ "${CODING_BOT_AUTH_ISSUE_SERIALIZED:-false}" != true ]; then
    branch="${GITHUB_DEFAULT_BRANCH:-}"
    if [ -z "$branch" ]; then
      branch=$(_codex_auth_issue_api "repos/$GITHUB_REPOSITORY" --jq .default_branch) || return 1
    fi
    [ -n "$branch" ] || return 1
    # Cause is a caller-owned diagnostic, never raw provider/gh output or tokens.
    ( set -o pipefail
      jq -n --arg ref "$branch" --arg mode "$mode" --arg cause "$cause" --arg kind "$kind" \
        '{ref: $ref, inputs: {auth_issue_mode: $mode, auth_issue_cause: $cause, auth_issue_kind: $kind}}' |
        _codex_auth_issue_api "repos/$GITHUB_REPOSITORY/actions/workflows/coding-bot-codex-auth.yml/dispatches" \
          --method POST --input - >/dev/null
    )
    return $?
  fi

  if ! _codex_auth_issue_api "repos/$GITHUB_REPOSITORY/labels/codex-auth" >/dev/null; then
    ( set -o pipefail
      jq -n '{name: "codex-auth", color: "B60205", description: "Codex login needs administrator attention"}' |
        _codex_auth_issue_api "repos/$GITHUB_REPOSITORY/labels" --method POST --input - >/dev/null
    ) || return 1
  fi
  # Use the Issues REST endpoint instead of search, whose index can lag writes.
  # --slurp includes all pages, and the issues endpoint can include pull requests.
  issue_number=$(set -o pipefail
    _codex_auth_issue_api "repos/$GITHUB_REPOSITORY/issues" --method GET \
      -f state=open -f labels=codex-auth -f per_page=100 --paginate --slurp |
      jq -er 'flatten | map(select(has("pull_request") | not)) | (.[0].number // "")'
  ) || return 1
  [[ "$issue_number" =~ ^[0-9]*$ ]] || return 1
  if [ "$kind" != auth ]; then
    marker="<!-- coding-bot-auth:$kind:$mode:$(date -u +%F) -->"
    if [ "$mode" = codex-login ] && [ "${CODING_BOT_CODEX_LOGIN_SECRET:-CODING_BOT_CODEX_AUTH_JSON}" != CODING_BOT_CODEX_AUTH_JSON ]; then
      marker="<!-- coding-bot-auth:$kind:$mode:$CODING_BOT_CODEX_LOGIN_SECRET:$(date -u +%F) -->"
    fi
    if [ -n "$issue_number" ]; then
      local bodies
      bodies=$(_codex_auth_issue_api "repos/$GITHUB_REPOSITORY/issues/$issue_number" --jq '.body') || return 1
      if [[ "$bodies" == *"$marker"* ]]; then return 0; fi
      bodies=$(_codex_auth_issue_api "repos/$GITHUB_REPOSITORY/issues/$issue_number/comments" \
        --paginate --slurp --jq 'flatten | .[].body') || return 1
      if [[ "$bodies" == *"$marker"* ]]; then return 0; fi
    fi
  fi
  if [ "$kind" = auth ]; then
    command=$(codex_auth_relogin_command "$mode") || return 1
    message=$(printf '## Codex authentication needs attention\n\nMode: %s\n\nCause: %s\n\nAn administrator should run this command on their machine and approve the browser login:\n\n```bash\n%s\n```\n\nKeep this login separate from personal logins and other secrets; sharing refresh tokens can invalidate both sessions. For SIWC, this command dispatches the updater and waits for new access publication; retry only after it succeeds.\n\n<!-- coding-bot -->\n' \
    "$display_mode" "$cause" "$command")
  else
    message=$(printf '## Codex updater or provider needs attention\n\nMode: %s\n\nCause: %s\n\nCheck coding-bot-codex-auth, configuration, permissions, usage limits and network; dispatch the updater after resolving the cause.\n\n%s\n<!-- coding-bot -->\n' "$display_mode" "$cause" "$marker")
  fi
  if [ -n "$issue_number" ]; then
    ( set -o pipefail
      jq -n --arg body "$message" '{body: $body}' |
        _codex_auth_issue_api "repos/$GITHUB_REPOSITORY/issues/$issue_number/comments" \
          --method POST --input - >/dev/null
    )
  else
    ( set -o pipefail
      jq -n --arg body "$message" \
        '{title: "Codex authentication needs attention", body: $body, labels: ["codex-auth"]}' |
        _codex_auth_issue_api "repos/$GITHUB_REPOSITORY/issues" --method POST --input - >/dev/null
    )
  fi
}
