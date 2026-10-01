#!/bin/bash
# bot の container 内の入口。workflow_dispatch は smoke 専用。
set -euo pipefail
source .github/coding-bot/codex-auth.sh
codex_snapshot_helpers
source "$CODING_BOT_AUTH_HELPERS_DIR/codex-auth.sh"
# Invalid Codex configuration is reported by codex_prepare_auth after checkout.
# Claude-main can still run and leave the AC 8 note.
codex_select_auth_mode || true
if [ "$CODING_BOT_CODEX_AUTH_MODE" = siwc ]; then
  codex_prepare_siwc_home
fi
if [ "${EVENT_TYPE:-}" = workflow_dispatch ]; then
  if [ "${VERIFY_ONLY:-}" != true ]; then
    echo "workflow_dispatch is verify-only: re-run with verify_only=true." >&2
    exit 1
  fi
  for c in git gh jq python3; do command -v "$c" >/dev/null; done
  case "${CODING_BOT_ENGINE:-}" in
    claude)
      command -v claude >/dev/null
      test -n "${CLAUDE_CODE_OAUTH_TOKEN:-}"
      ;;
    codex)
      command -v codex >/dev/null
      if [ "$CODING_BOT_CODEX_AUTH_MODE" = siwc ]; then
        command -v openssl >/dev/null
        test -n "${CODING_BOT_CODEX_SIWC_KEY:-}"
        test -n "${CODING_BOT_GH_PAT:-}"
      else
        test -n "${CODING_BOT_CODEX_AUTH_JSON:-}"
      fi
      ;;
    *) echo "Set CODING_BOT_ENGINE to claude or codex" >&2; exit 1 ;;
  esac
  test -n "${GITHUB_TOKEN:-}"
  if [ -n "${CODING_BOT_CODEX_AUTH_JSON:-}" ]; then
    printf '%s' "$CODING_BOT_CODEX_AUTH_JSON" | jq -e 'type == "object" and (.auth_mode == null or .auth_mode == "chatgpt") and (.tokens.access_token | strings | length > 0) and (.tokens.refresh_token | strings | length > 0)' >/dev/null
  fi
  git rev-parse HEAD
  git status --porcelain >/dev/null
  git stash list >/dev/null
  # 一意な一時 ref で .git の書き込みも測る（既存 tag を上書きしない）。
  smoke_ref="refs/coding-bot-smoke/$$-$RANDOM"
  trap 'git update-ref -d "$smoke_ref"' EXIT
  git update-ref "$smoke_ref" HEAD
  git update-ref -d "$smoke_ref"
  trap - EXIT
  if [ -f .github/coding-bot/smoke-local.sh ]; then
    bash .github/coding-bot/smoke-local.sh
  fi
  echo "✅ devcontainer is usable from the prebuilt image"
  exit 0
fi
source .github/coding-bot/update-tools.sh
export CODING_BOT_CODEX_REQUIREMENTS_OK=false
if [ "$CODING_BOT_CODEX_AUTH_MODE" = siwc ] || [ -n "${CODING_BOT_CODEX_AUTH_JSON:-}" ]; then
  if bash "$CODING_BOT_AUTH_HELPERS_DIR/codex-requirements.sh"; then
    export CODING_BOT_CODEX_REQUIREMENTS_OK=true
  elif [ "$CODING_BOT_CODEX_AUTH_MODE" = siwc ]; then
    echo '::error::SIWC の managed provider を固定できないため Codex を使いません。'
  else
    echo '::warning::Codex の managed ログイン制限を配置できません（既存設定または権限）。config.toml の ChatGPT 制限を使います。'
  fi
fi
exec bash .github/coding-bot/run-action.sh
