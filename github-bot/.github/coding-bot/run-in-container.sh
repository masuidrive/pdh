#!/bin/bash
# bot の container 内の入口。workflow_dispatch は smoke 専用。
set -euo pipefail
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
      test -n "${CODING_BOT_CODEX_AUTH_JSON:-}"
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
if [ -n "${CODING_BOT_CODEX_AUTH_JSON:-}" ]; then
  if ! bash .github/coding-bot/codex-requirements.sh; then
    echo '::warning::Codex の managed ログイン制限を配置できません（既存設定または権限）。config.toml の ChatGPT 制限を使います。'
  fi
fi
exec bash .github/coding-bot/run-action.sh
