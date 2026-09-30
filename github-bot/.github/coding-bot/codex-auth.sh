# shellcheck shell=bash
# Codex main / delegated workers share this ChatGPT login and its refresh lifecycle.

codex_auth_hash() {
  ( set -o pipefail; jq -cS . "$CODEX_AUTH_FILE" 2>/dev/null | sha256sum | cut -d' ' -f1 )
}

codex_auth_is_chatgpt() {
  jq -e '(.auth_mode == null or .auth_mode == "chatgpt") and
    (.tokens.access_token | strings | length > 0) and
    (.tokens.refresh_token | strings | length > 0)' "$CODEX_AUTH_FILE" >/dev/null 2>&1
}

codex_save_refreshed_auth() {
  local current_hash current_refresh current_account
  [ "${CODEX_AUTH_SEEDED:-false}" = true ] || return 0
  [ -n "${CODEX_AUTH_INITIAL_HASH:-}" ] && [ -f "${CODEX_AUTH_FILE:-}" ] || return 0
  if ! current_hash=$(codex_auth_hash); then
    echo '::error::更新後の Codex auth.json を読めないため書き戻せません。'
    return 0
  fi
  [ "$current_hash" != "$CODEX_AUTH_INITIAL_HASH" ] || return 0
  if ! codex_auth_is_chatgpt; then
    echo '::error::更新後の auth.json が ChatGPT ログインの形ではないため書き戻しません。'
    return 0
  fi
  current_refresh=$(jq -r '.tokens.refresh_token' "$CODEX_AUTH_FILE" 2>/dev/null) || return 0
  current_account=$(jq -c '.tokens.account_id // null' "$CODEX_AUTH_FILE" 2>/dev/null) || return 0
  [ "$current_refresh" != "$CODEX_AUTH_INITIAL_REFRESH" ] || return 0
  if [ "$CODEX_AUTH_INITIAL_ACCOUNT" != null ] && [ "$current_account" != "$CODEX_AUTH_INITIAL_ACCOUNT" ]; then
    echo '::error::更新後の auth.json の account が変わったため書き戻しません。'
    return 0
  fi
  if [ -z "${CODING_BOT_GH_PAT:-}" ]; then
    echo '::error::CODING_BOT_GH_PAT が無いため、更新された Codex token を書き戻せません。'
  elif ( set -o pipefail
    jq -c . "$CODEX_AUTH_FILE" 2>/dev/null | GH_TOKEN="$CODING_BOT_GH_PAT" \
      timeout -k 5 60 gh secret set CODING_BOT_CODEX_AUTH_JSON --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1
  ); then
    echo '更新された token を CODING_BOT_CODEX_AUTH_JSON へ書き戻しました。'
    CODEX_AUTH_INITIAL_HASH="$current_hash"
    CODEX_AUTH_INITIAL_REFRESH="$current_refresh"
  else
    echo '::error::CODING_BOT_CODEX_AUTH_JSON への書き戻しに失敗しました。'
  fi
  # EXIT trap must preserve the run's original conclusion, even if gh fails.
  return 0
}

codex_auth_recovery_message() {
  local consequence='この run は止めました。'
  if [ "${ENGINE:-codex}" = claude ]; then
    consequence='codex が担う実装とレビューは行われず、claude だけで進めます。'
  fi
  cat <<EOF
## ⚠ codex の認証が切れています — 人の手が要ります
この run では codex を使えません。$consequence
認証情報が無い・壊れているか、認証サーバから拒否されました。

EOF
  codex_auth_recovery_steps
}

codex_auth_recovery_steps() {
  cat <<EOF
### 直し方（secret を管理している人が、手元の端末で行う）
1. 使い捨ての CODEX_HOME にログインし、ブラウザで承認して secret に登録する:
   \`d=\$(mktemp -d) && CODEX_HOME="\$d" codex login && jq -e . "\$d/auth.json" >/dev/null && jq -c . "\$d/auth.json" | gh secret set CODING_BOT_CODEX_AUTH_JSON --repo $GITHUB_REPOSITORY; rm -rf "\$d"\`
   手元の普段の codex ログインとも、別の用途の secret とも共有しない（片方の token 更新がもう片方を切るため）。
2. この Issue / PR に 🤖 とコメントして、bot をやり直す。
EOF
}

codex_probe_failure_message() {
  local consequence='この run は止めました。'
  if [ "${ENGINE:-codex}" = claude ]; then
    consequence='codex が担う実装とレビューは行われず、claude だけで進めます。'
  fi
  cat <<EOF
## ⚠ codex が使えるかを確かめられませんでした
この run では codex を使えません。$consequence
利用上限・ネットワークなら、しばらくして 🤖 でやり直せば直る。同じ表示が続くなら、下の再ログインの手順を行う。

EOF
  codex_auth_recovery_steps
}

codex_report_auth_failure() {
  [ "${CODEX_AUTH_REPORTED:-false}" = true ] && return 0
  local message
  if [ "${CODEX_AUTH_FAILURE:-auth}" = auth ]; then
    message=$(codex_auth_recovery_message)
  else
    message=$(codex_probe_failure_message)
  fi
  if gh api "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments" \
    -f body="$message" >/dev/null 2>&1; then
    CODEX_AUTH_REPORTED=true
  else
    echo '::error::Codex の事前確認エラーのコメントを投稿できませんでした。'
  fi
}

codex_prepare_auth() {
  # Keep OPENAI_API_KEY for provider tests; the shared config bars Codex API billing.
  if [ "${ENGINE:-}" = codex ] && [ -n "${CODING_BOT_CODEX_AUTH_JSON:-}" ]; then
    export CODEX_HOME="${CODEX_HOME:-/tmp/codex-home}"
  else
    export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
  fi
  CODEX_AUTH_FILE="$CODEX_HOME/auth.json"
  CODEX_AUTH_INITIAL_HASH=''
  CODEX_AUTH_INITIAL_REFRESH=''
  CODEX_AUTH_INITIAL_ACCOUNT=null
  CODEX_AUTH_SEEDED=false
  CODEX_AUTH_FAILURE=auth
  CODEX_AUTH_REPORTED=false
  CODEX_AUTH_STATUS='無い'
  local invalid=false
  if [ -n "${CODING_BOT_CODEX_AUTH_JSON:-}" ]; then
    if printf '%s' "$CODING_BOT_CODEX_AUTH_JSON" | jq -e 'type == "object"' >/dev/null 2>&1; then
      mkdir -p "$CODEX_HOME"
      ( umask 077; printf '%s' "$CODING_BOT_CODEX_AUTH_JSON" | jq -c . > "$CODEX_AUTH_FILE" )
      chmod 600 "$CODEX_AUTH_FILE"
      CODEX_AUTH_SEEDED=true
      CODEX_AUTH_INITIAL_HASH=$(codex_auth_hash) || invalid=true
      CODEX_AUTH_INITIAL_REFRESH=$(jq -r '.tokens.refresh_token // empty' "$CODEX_AUTH_FILE" 2>/dev/null) || invalid=true
      CODEX_AUTH_INITIAL_ACCOUNT=$(jq -c '.tokens.account_id // null' "$CODEX_AUTH_FILE" 2>/dev/null) || invalid=true
      # Only bot-owned config is changed; existing operator logins are not saved.
      local config_tmp
      config_tmp=$(mktemp "$CODEX_HOME/config.toml.XXXXXX")
      { printf 'forced_login_method = "chatgpt"\n'
        if [ -f "$CODEX_HOME/config.toml" ]; then
          awk '/^[[:space:]]*\[/{table=1} !table && /^[[:space:]]*forced_login_method[[:space:]]*=/{next} {print}' \
            "$CODEX_HOME/config.toml"
        fi
      } > "$config_tmp"
      mv "$config_tmp" "$CODEX_HOME/config.toml"
      # A failed probe may rotate credentials too. Keep the original run status.
      trap 'codex_save_refreshed_auth' EXIT
      trap 'exit 130' INT
      trap 'exit 143' TERM
      if [ -z "${CODING_BOT_GH_PAT:-}" ]; then
        echo '::warning::CODING_BOT_GH_PAT が無いため、Codex が token を更新しても secret へ書き戻せません。'
      fi
    else
      invalid=true
    fi
  fi
  if [ ! -f "$CODEX_AUTH_FILE" ] && [ "$invalid" = false ]; then
    return 0
  fi

  # login status only reads local state. A minimal exec also verifies the server.
  # A timeout/network failure cannot prove expiry; conservatively disable Codex.
  local probe_dir probe_log probe_rc=1
  local model_args=()
  if [ -n "${CODING_BOT_CODEX_MODEL:-}" ]; then
    model_args=(-m "$CODING_BOT_CODEX_MODEL")
  fi
  if [ "$invalid" = false ] && codex_auth_is_chatgpt; then
    probe_dir=$(mktemp -d)
    probe_log=$(mktemp "$probe_dir/output.XXXXXX")
    timeout -k 5 45 codex exec --json --ephemeral --skip-git-repo-check \
      --sandbox read-only -C "$probe_dir" "${model_args[@]}" \
      -c 'forced_login_method="chatgpt"' -c 'model_reasoning_effort="low"' \
      'Reply only OK. Do not use tools.' </dev/null >"$probe_log" 2>&1 && probe_rc=0 || probe_rc=$?
    codex_save_refreshed_auth
    CODEX_AUTH_FAILURE=probe
    # Match known auth diagnostics, never print provider output (it may contain tokens).
    # --json mixes event IDs with errors; only error payloads are diagnostic text.
    # Startup failures can also be plain stderr (e.g. invalid ID token format).
    if jq -Rr '
      . as $line | (try fromjson catch $line) |
      if type == "object" then
        if .type == "error" then .message
        elif .type == "turn.failed" then .error.message
        else empty end | strings
      elif type == "string" then . else empty end
    ' "$probe_log" | grep -iE 'status([ _-]code)?[[:space:]:=]+401([^0-9]|$)|(^|[^[:alnum:]_-])401[[:space:]]+Unauthorized|refresh token|not logged in|Could not parse your authentication token|ChatGPT login is required|could not be refreshed|sign in again|log out and sign in|invalid ID token|ChatGPT account ID not available|Token data is not available|auth data is not available' >/dev/null; then
      CODEX_AUTH_FAILURE=auth
    fi
    rm -rf "$probe_dir"
  fi
  if [ "$probe_rc" -eq 0 ]; then
    CODEX_AUTH_STATUS='使える（ChatGPT ログイン）'
  else
    echo '::error::Codex の事前確認に失敗しました。'
    codex_report_auth_failure
    local reason='認証切れで使えない' notification='Issue / PR にコメント済み'
    if [ "$CODEX_AUTH_FAILURE" = probe ]; then
      reason='利用可否を確認できないため使えない。同じ表示が続くなら再ログインの手順を行う'
    fi
    if [ "${CODEX_AUTH_REPORTED:-false}" != true ]; then
      notification='Issue / PR へのコメント投稿にも失敗'
    fi
    CODEX_AUTH_STATUS="$reason（$notification）。codex の worker を起動しない。最終レポートの先頭にこのことを書く"
  fi
}
