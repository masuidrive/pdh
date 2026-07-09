#!/usr/bin/env bash
# test-ticket-local.sh — Run ticket-local tests for PDH projects.
#
# A ticket-local-test is an executable verification artifact for one ticket.
# These artifacts are intentionally not part of scripts/test-all.sh or CI.
#
# Usage:
#   scripts/test-ticket-local.sh                         # infer current ticket
#   scripts/test-ticket-local.sh <ticket-id>             # explicit ticket
#   scripts/test-ticket-local.sh <ticket-id> -- <args>   # pass args through
#
# Expected script path:
#   tests/tickets/<ticket-id>/test-ticket-local.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/test-ticket-local.sh [ticket-id] [-- ticket-local-args...]

Runs a ticket-local-test script without adding it to scripts/test-all.sh or CI.

Default ticket-id is inferred from current-ticket.md when it is a symlink to tickets/<ticket-id>.md.
The script path is:
  tests/tickets/<ticket-id>/test-ticket-local.sh
EOF
}

ticket_id=""
if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      ;;
    --*)
      ;;
    *)
      ticket_id="$1"
      shift
      ;;
  esac
fi

if [[ -z "$ticket_id" ]]; then
  target="$(readlink current-ticket.md 2>/dev/null || true)"
  if [[ -n "$target" ]]; then
    ticket_id="$(basename "$target" .md)"
  fi
fi

ticket_id="${ticket_id#tickets/}"
ticket_id="${ticket_id%.md}"

if [[ -z "$ticket_id" ]]; then
  echo "Could not infer ticket id. Pass it explicitly: ./scripts/test-ticket-local.sh <ticket-id>" >&2
  exit 2
fi

script="tests/tickets/$ticket_id/test-ticket-local.sh"
if [[ ! -f "$script" ]]; then
  echo "Ticket-local test not found: $script" >&2
  exit 1
fi
if [[ ! -x "$script" ]]; then
  echo "Ticket-local test is not executable: $script" >&2
  echo "Run: chmod +x $script" >&2
  exit 1
fi

export PDH_TICKET_ID="$ticket_id"
export PDH_TICKET_LOCAL_DIR="tests/tickets/$ticket_id"
exec "$script" "$@"
