#!/bin/bash
# bot の container 内の入口。workflow_dispatch は smoke 専用。
set -euo pipefail
if [ "${EVENT_TYPE:-}" = workflow_dispatch ]; then
  if [ "${VERIFY_ONLY:-}" != true ]; then
    echo "workflow_dispatch is verify-only: re-run with verify_only=true." >&2
    exit 1
  fi
  for c in git gh jq python3; do command -v "$c" >/dev/null; done
  case "${CODING_ROBOT_ENGINE:-}" in
    claude)
      command -v claude >/dev/null
      test -n "${CLAUDE_CODE_OAUTH_TOKEN:-}"
      ;;
    codex)
      command -v codex >/dev/null
      test -n "${CODEX_AUTH_JSON:-}${OPENAI_API_KEY:-}"
      ;;
    *) echo "Set CODING_ROBOT_ENGINE to claude or codex" >&2; exit 1 ;;
  esac
  test -n "${GITHUB_TOKEN:-}"
  if [ -n "${CODEX_AUTH_JSON:-}" ]; then
    printf '%s' "$CODEX_AUTH_JSON" | jq -e 'type == "object"' >/dev/null
  fi
  git rev-parse HEAD
  git status --porcelain >/dev/null
  git stash list >/dev/null
  # 一意な一時 ref で .git の書き込みも測る（既存 tag を上書きしない）。
  smoke_ref="refs/coding-robot-smoke/$$-$RANDOM"
  trap 'git update-ref -d "$smoke_ref"' EXIT
  git update-ref "$smoke_ref" HEAD
  git update-ref -d "$smoke_ref"
  trap - EXIT
  if [ -f .github/coding-robot/smoke-local.sh ]; then
    bash .github/coding-robot/smoke-local.sh
  fi
  echo "✅ devcontainer is usable from the prebuilt image"
  exit 0
fi
exec bash .github/coding-robot/run-action.sh
