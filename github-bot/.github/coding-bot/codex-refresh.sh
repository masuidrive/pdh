#!/usr/bin/env bash
# Called only from the serialized authentication workflow, never a run container.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ -n "${CODING_BOT_AUTH_ISSUE_MODE:-}" ]; then
  source "$SCRIPT_DIR/codex-auth-issue.sh"
  export CODING_BOT_AUTH_ISSUE_SERIALIZED=true
  codex_auth_issue "$CODING_BOT_AUTH_ISSUE_MODE" "${CODING_BOT_AUTH_ISSUE_CAUSE:-Authentication failed}" "${CODING_BOT_AUTH_ISSUE_KIND:-auth}"
else
  exec python3 "$SCRIPT_DIR/codex-refresh.py"
fi
