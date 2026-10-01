# shellcheck shell=bash
# Codex main / delegated workers share this ChatGPT login and its refresh lifecycle.

source "$(dirname "${BASH_SOURCE[0]}")/codex-auth-issue.sh"

# Run from the trusted default-branch checkout before switching to agent/PR head.
codex_snapshot_helpers() {
  [ -z "${CODING_BOT_AUTH_HELPERS_DIR:-}" ] || return 0
  local source_dir name
  source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CODING_BOT_AUTH_HELPERS_DIR=$(mktemp -d /tmp/coding-bot-auth.XXXXXX)
  for name in codex-auth.sh codex-auth-issue.sh codex-login-state.py codex-requirements.sh siwc-config.py siwc-poll.py siwc-token.py; do
    if [ "${GITHUB_ACTIONS:-false}" = true ]; then
      git show "origin/${GITHUB_DEFAULT_BRANCH:?}:.github/coding-bot/$name" > "$CODING_BOT_AUTH_HELPERS_DIR/$name" || return 1
    else
      # Local test/terminal entry points have no Actions default-branch ref.
      cp "$source_dir/$name" "$CODING_BOT_AUTH_HELPERS_DIR/$name" || return 1
    fi
  done
  export CODING_BOT_AUTH_HELPERS_DIR
}

codex_prepare_siwc_home() {
  if [ -z "${CODEX_RUNTIME_HOME:-}" ]; then
    local operator_home="${CODEX_HOME:-}"
    CODEX_RUNTIME_HOME=$(mktemp -d)
    export CODEX_RUNTIME_HOME
    if [ -n "$operator_home" ] && [ -f "$operator_home/config.toml" ]; then
      cp "$operator_home/config.toml" "$CODEX_RUNTIME_HOME/config.toml"
    fi
  fi
  export CODEX_HOME="$CODEX_RUNTIME_HOME"
}

codex_select_auth_mode() {
  case "${CODING_BOT_CODEX_AUTH_MODE:-}" in
    siwc|codex-login) ;;
    '')
      if [ "${CODING_BOT_CODEX_SIWC_PRESENT:-false}" = true ]; then
        CODING_BOT_CODEX_AUTH_MODE=siwc
      else
        CODING_BOT_CODEX_AUTH_MODE=codex-login
      fi
      ;;
    *) echo '::warning::CODING_BOT_CODEX_AUTH_MODE must be siwc or codex-login; Codex is unavailable.'; return 1 ;;
  esac
  export CODING_BOT_CODEX_AUTH_MODE
}

codex_auth_is_chatgpt() {
  jq -e '(.auth_mode == null or .auth_mode == "chatgpt" or .auth_mode == "chatgptAuthTokens") and
    (.tokens.access_token | strings | length > 0) and
    (if .auth_mode == "chatgptAuthTokens" then .tokens.refresh_token == ""
     else (.tokens.refresh_token | strings | length > 0) end)' "$CODEX_AUTH_FILE" >/dev/null 2>&1
}

codex_cleanup_auth() {
  if [ -n "${CODEX_SIWC_POLL_PID:-}" ]; then
    kill "$CODEX_SIWC_POLL_PID" 2>/dev/null || true
    wait "$CODEX_SIWC_POLL_PID" 2>/dev/null || true
  fi
  if [ -n "${CODEX_RUNTIME_HOME:-}" ]; then
    rm -rf "$CODEX_RUNTIME_HOME"
  fi
}

codex_mask() {
  [ "${GITHUB_ACTIONS:-false}" = true ] || return 0
  local value="$1"
  value="${value//'%'/'%25'}"
  value="${value//$'\r'/'%0D'}"
  value="${value//$'\n'/'%0A'}"
  printf '::add-mask::%s\n' "$value"
}

codex_auth_log_is_failure() {
  jq -Rr '
      . as $line | (try fromjson catch $line) |
      if type == "object" then
        if .type == "error" then .message
        elif .type == "turn.failed" then .error.message
        else empty end | strings
      elif type == "string" then . else empty end
    ' "$1" | grep -iE 'status([ _-]code)?[[:space:]:=]+401([^0-9]|$)|(^|[^[:alnum:]_-])401[[:space:]]+Unauthorized|refresh token|not logged in|Could not parse your authentication token|ChatGPT login is required|could not be refreshed|sign in again|log out and sign in|invalid ID token|ChatGPT account ID not available|Token data is not available|auth data is not available|SIWC token failed: invalid credentials|SIWC access credentials unusable' >/dev/null;
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
  local command
  command=$(codex_auth_relogin_command "${CODING_BOT_CODEX_AUTH_MODE:-codex-login}")
  if [ "${CODING_BOT_CODEX_AUTH_MODE:-codex-login}" = siwc ]; then
    cat <<EOF
### 直し方（repo の write 権限を持つ人が、ブラウザと GitHub の画面で行う）
$command

summary に「bot はもう SIWC で動ける」と出たら、この Issue / PR に 🤖 とコメントして bot をやり直す。
EOF
    return
  fi
  cat <<EOF
### 直し方（secret を管理している人が、手元の端末で行う）
1. 手元の端末でログインし、ブラウザで承認して secret に登録する:
   \`$command\`
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
原因: ${CODEX_AUTH_CAUSE:-利用上限・ネットワーク・timeout}。
workflow の状態・設定・利用上限・ネットワークを確認し、しばらくして 🤖 でやり直してください。

EOF
}

codex_report_auth_failure() {
  [ "${CODEX_AUTH_REPORTED:-false}" = true ] && return 0
  local message
  local report_mode="${CODING_BOT_CODEX_AUTH_MODE:-codex-login}" kind=auth
  case "$report_mode" in siwc|codex-login) ;; *) report_mode=codex-login ;; esac
  [ "${CODEX_AUTH_FAILURE:-auth}" = auth ] || kind=operational
  codex_auth_issue "$report_mode" "${CODEX_AUTH_CAUSE:-Codex authentication or preflight failed}" "$kind" || echo '::error::codex-auth Issue を依頼できませんでした。'
  if [ "${CODEX_AUTH_FAILURE:-auth}" = auth ]; then
    message=$(codex_auth_recovery_message)
  else
    message=$(codex_probe_failure_message)
  fi
  if [ "$kind" = operational ]; then
    if codex_post_operational_note "$report_mode" "$message"; then
      CODEX_AUTH_REPORTED=true
    else
      echo '::error::Codex の事前確認エラーのコメントを投稿できませんでした。'
    fi
  elif gh api "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments" \
    -f body="$message" >/dev/null 2>&1; then
    CODEX_AUTH_REPORTED=true
  else
    echo '::error::Codex の事前確認エラーのコメントを投稿できませんでした。'
  fi
}

codex_prepare_auth() {
  local bot_dir invalid=false
  bot_dir="${CODING_BOT_AUTH_HELPERS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  CODEX_AUTH_FAILURE=auth
  CODEX_AUTH_REPORTED=false
  CODEX_AUTH_STATUS='無い'
  CODEX_AUTH_CAUSE='Codex login missing, invalid, or rejected'
  if ! codex_select_auth_mode; then
    CODEX_AUTH_CAUSE='Invalid CODING_BOT_CODEX_AUTH_MODE'
    CODEX_AUTH_FAILURE=probe
    codex_report_auth_failure
    return 0
  fi
  if [ "$CODING_BOT_CODEX_AUTH_MODE" = siwc ]; then
    echo '::notice::Codex login mode: SIWC'
    codex_prepare_siwc_home
  else
    echo '::notice::Codex login mode: codex login'
    if [ "${ENGINE:-}" = codex ] && [ -n "${CODING_BOT_CODEX_AUTH_JSON:-}" ]; then
      export CODEX_HOME="${CODEX_HOME:-/tmp/codex-home}"
    else
      export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
    fi
  fi
  CODEX_AUTH_FILE="$CODEX_HOME/auth.json"
  if [ "$CODING_BOT_CODEX_AUTH_MODE" = siwc ]; then
    CODEX_AUTH_FAILURE=probe
    CODEX_AUTH_CAUSE='SIWC provider requirements, openssl, key, or access distribution unavailable'
    if [ "${CODING_BOT_CODEX_SIWC_PRESENT:-false}" != true ]; then
      CODEX_AUTH_FAILURE=auth
      CODEX_AUTH_CAUSE='CODING_BOT_CODEX_AUTH_MODE=siwc but CODING_BOT_CODEX_SIWC_JSON is missing'
      invalid=true
    elif [ "${CODING_BOT_CODEX_REQUIREMENTS_OK:-false}" != true ] ||
       ! command -v openssl >/dev/null || [ -z "${CODING_BOT_CODEX_SIWC_KEY:-}" ] ||
       [ -z "${CODING_BOT_GH_PAT:-}" ]; then
      invalid=true
    else
      mkdir -p "$CODEX_HOME"
      codex_mask "$CODING_BOT_CODEX_SIWC_KEY"
      # No ChatGPT login in this home: auth.command is the sole bearer source.
      rm -f "$CODEX_AUTH_FILE" "$CODEX_HOME/siwc-access.json"
      python3 "$bot_dir/siwc-poll.py" --creds "$CODEX_HOME/siwc-access.json" &
      CODEX_SIWC_POLL_PID=$!
      trap 'codex_cleanup_auth' EXIT
      trap 'exit 130' INT
      trap 'exit 143' TERM
      local deadline=$((SECONDS + 600))
      until python3 "$bot_dir/siwc-token.py" --creds "$CODEX_HOME/siwc-access.json" >/dev/null 2>&1; do
        if [ "$SECONDS" -ge "$deadline" ] || ! kill -0 "$CODEX_SIWC_POLL_PID" 2>/dev/null; then
          CODEX_AUTH_CAUSE='SIWC access publication did not complete; check coding-bot-codex-auth workflow queue and Variables/key permissions'
          invalid=true
          break
        fi
        sleep 2
      done
    fi
  else
    if [ -n "${CODING_BOT_CODEX_AUTH_JSON:-}" ]; then
      if printf '%s' "$CODING_BOT_CODEX_AUTH_JSON" | jq -e 'type == "object"' >/dev/null 2>&1; then
        mkdir -p "$CODEX_HOME"
        ( umask 077; printf '%s' "$CODING_BOT_CODEX_AUTH_JSON" | jq -c . > "$CODEX_AUTH_FILE" )
        chmod 600 "$CODEX_AUTH_FILE"
        # Mark individual tokens before they can reach shell/model output.
        local token
        while IFS= read -r token; do
          codex_mask "$token"
        done < <(jq -r '.tokens // {} | .[] | strings' "$CODEX_AUTH_FILE")
        local config_tmp
        config_tmp=$(mktemp "$CODEX_HOME/config.toml.XXXXXX")
        { printf 'forced_login_method = "chatgpt"\n'
          if [ -f "$CODEX_HOME/config.toml" ]; then
            awk '/^[[:space:]]*\[/{table=1} !table && /^[[:space:]]*forced_login_method[[:space:]]*=/{next} {print}' \
              "$CODEX_HOME/config.toml"
          fi
        } > "$config_tmp"
        mv "$config_tmp" "$CODEX_HOME/config.toml"
      else
        invalid=true
      fi
    fi
    if [ ! -f "$CODEX_AUTH_FILE" ] && [ "$invalid" = false ]; then
      return 0
    fi
    if [ "$invalid" = false ]; then
      local state_rc=0
      if [ ! -f "$bot_dir/codex-login-state.py" ]; then
        state_rc=1
        CODEX_AUTH_FAILURE=probe
        CODEX_AUTH_CAUSE='codex-login-state.py helper is missing; restore trusted coding-bot helpers'
      else
        python3 "$bot_dir/codex-login-state.py" "$CODEX_AUTH_FILE" || state_rc=$?
      fi
      if [ "$state_rc" -eq 2 ]; then
        echo '::warning::codex login last_refresh is older than 3 days; daily refresh needs attention.'
        codex_auth_issue codex-login 'codex login last_refresh is older than 3 days; daily refresh needs attention' stale || true
      elif [ "$state_rc" -ne 0 ]; then
        if [ "$CODEX_AUTH_FAILURE" = auth ]; then
          CODEX_AUTH_CAUSE='codex login last_refresh invalid or at least 8 days old, or access token expires during this run; daily refresh needs attention'
        fi
        invalid=true
      fi
    fi
    if [ "$invalid" = false ] && codex_auth_is_chatgpt; then
      # Ordinary ChatGPT auth rotates even on 401 with a recent last_refresh.
      # Keep the refresh owner in the updater; Codex's supported external-auth
      # representation never consumes a refresh token, including 401 recovery.
      # Existing operator homes stay untouched when no secret seeded this run.
      if [ -z "${CODING_BOT_CODEX_AUTH_JSON:-}" ]; then
        CODEX_RUNTIME_HOME=$(mktemp -d)
        [ ! -f "$CODEX_HOME/config.toml" ] || cp "$CODEX_HOME/config.toml" "$CODEX_RUNTIME_HOME/config.toml"
        cp "$CODEX_AUTH_FILE" "$CODEX_RUNTIME_HOME/auth.json"
        export CODEX_HOME="$CODEX_RUNTIME_HOME"
        CODEX_AUTH_FILE="$CODEX_RUNTIME_HOME/auth.json"
        trap 'codex_cleanup_auth' EXIT
      fi
      local snapshot
      snapshot=$(mktemp "$CODEX_HOME/auth.json.XXXXXX")
      jq '.auth_mode = "chatgptAuthTokens" | .tokens.refresh_token = ""' "$CODEX_AUTH_FILE" > "$snapshot"
      chmod 600 "$snapshot"
      mv "$snapshot" "$CODEX_AUTH_FILE"
      unset CODING_BOT_CODEX_AUTH_JSON
    fi
  fi

  # login status only reads local state. A minimal exec also verifies the server.
  # A timeout/network failure cannot prove expiry; conservatively disable Codex.
  local probe_dir probe_log probe_rc=1
  local model_args=()
  if [ -n "${CODING_BOT_CODEX_MODEL:-}" ]; then
    model_args=(-m "$CODING_BOT_CODEX_MODEL")
  fi
  if [ "$invalid" = false ] && { [ "$CODING_BOT_CODEX_AUTH_MODE" = siwc ] || codex_auth_is_chatgpt; }; then
    probe_dir=$(mktemp -d)
    probe_log=$(mktemp "$probe_dir/output.XXXXXX")
    timeout -k 5 45 codex exec --json --ephemeral --skip-git-repo-check \
      --sandbox read-only -C "$probe_dir" "${model_args[@]}" \
      -c 'forced_login_method="chatgpt"' -c 'model_reasoning_effort="low"' \
      'Reply only OK. Do not use tools.' </dev/null >"$probe_log" 2>&1 && probe_rc=0 || probe_rc=$?
    CODEX_AUTH_FAILURE=probe
    CODEX_AUTH_CAUSE="Codex $CODING_BOT_CODEX_AUTH_MODE preflight could not verify provider access (network, usage limit, or timeout)"
    # Match known auth diagnostics, never print provider output (it may contain tokens).
    # --json mixes event IDs with errors; only error payloads are diagnostic text.
    # Startup failures can also be plain stderr (e.g. invalid ID token format).
    if codex_auth_log_is_failure "$probe_log"; then
      CODEX_AUTH_FAILURE=auth
      CODEX_AUTH_CAUSE="Codex $CODING_BOT_CODEX_AUTH_MODE authentication was rejected during preflight"
    fi
    rm -rf "$probe_dir"
  fi
  if [ "$probe_rc" -eq 0 ]; then
    CODEX_AUTH_STATUS='使える（ChatGPT ログイン）'
  else
    if [ "$CODING_BOT_CODEX_AUTH_MODE" = siwc ]; then
      codex_cleanup_auth
    fi
    echo '::error::Codex の事前確認に失敗しました。'
    codex_report_auth_failure
    local reason='認証切れで使えない' notification='Issue / PR にコメント済み'
    if [ "$CODEX_AUTH_FAILURE" = probe ]; then
      reason='利用可否を確認できないため使えない。workflow・設定・利用上限・ネットワークを確認する'
    fi
    if [ "${CODEX_AUTH_REPORTED:-false}" != true ]; then
      notification='Issue / PR へのコメント投稿にも失敗'
    fi
    CODEX_AUTH_STATUS="$reason（$notification）。codex の worker を起動しない。最終レポートの先頭にこのことを書く"
  fi
}
