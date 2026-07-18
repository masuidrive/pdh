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
# Script path resolution (new per-ticket layout first, legacy flat layout as fallback):
#   tickets/<ticket-id>/tests/test-ticket-local.sh
#   tickets/done/<ticket-id>/tests/test-ticket-local.sh
#   tests/tickets/<ticket-id>/test-ticket-local.sh   (legacy)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/test-ticket-local.sh [ticket-id] [-- ticket-local-args...]

Runs a ticket-local-test script without adding it to scripts/test-all.sh or CI.

Default ticket-id is inferred from the active ticket.sh symlinks
(current-ticket/ dir symlink for the new per-ticket layout, or the
current-ticket.md compat symlink for the legacy flat layout), matching
what `ticket.sh start`/`restore` output shows.

Script path resolution (new layout first, legacy flat layout as fallback):
  tickets/<ticket-id>/tests/test-ticket-local.sh
  tests/tickets/<ticket-id>/test-ticket-local.sh   (legacy)
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
  if [[ -L current-ticket && -d current-ticket ]]; then
    ticket_id="$(basename "$(readlink current-ticket)")"
  else
    target="$(readlink current-ticket.md 2>/dev/null || true)"
    if [[ -n "$target" ]]; then
      case "$target" in
        */ticket.md)
          ticket_id="$(basename "$(dirname "$target")")"
          ;;
        *)
          ticket_id="$(basename "$target" .md)"
          ;;
      esac
    fi
  fi
fi

ticket_id="${ticket_id#tickets/}"
ticket_id="${ticket_id%.md}"

if [[ -z "$ticket_id" ]]; then
  echo "Could not infer ticket id. Pass it explicitly: ./scripts/test-ticket-local.sh <ticket-id>" >&2
  exit 2
fi

new_script="tickets/$ticket_id/tests/test-ticket-local.sh"
done_script="tickets/done/$ticket_id/tests/test-ticket-local.sh"
legacy_script="tests/tickets/$ticket_id/test-ticket-local.sh"

if [[ -f "$new_script" ]]; then
  script="$new_script"
  tests_dir="tickets/$ticket_id/tests"
elif [[ -f "$done_script" ]]; then
  script="$done_script"
  tests_dir="tickets/done/$ticket_id/tests"
elif [[ -f "$legacy_script" ]]; then
  script="$legacy_script"
  tests_dir="tests/tickets/$ticket_id"
else
  echo "Ticket-local test not found. Checked:" >&2
  echo "  $new_script" >&2
  echo "  $done_script" >&2
  echo "  $legacy_script" >&2
  exit 1
fi

if [[ ! -x "$script" ]]; then
  echo "Ticket-local test is not executable: $script" >&2
  echo "Run: chmod +x $script" >&2
  exit 1
fi

export PDH_TICKET_ID="$ticket_id"
export PDH_TICKET_LOCAL_DIR="$tests_dir"
exec "$script" "$@"
