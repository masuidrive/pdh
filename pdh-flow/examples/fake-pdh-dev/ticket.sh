#!/usr/bin/env bash
set -euo pipefail

cmd="${1:-}"
ticket="${2:-}"
mkdir -p .tickets

case "$cmd" in
  start)
    if [ -z "$ticket" ]; then
      echo "ticket id is required" >&2
      exit 2
    fi
    printf '%s\n' "$ticket" > .tickets/current
    echo "started $ticket"
    ;;
  close)
    current="$(cat .tickets/current 2>/dev/null || true)"
    if [ -z "$current" ]; then
      current="unknown"
    fi
    printf '%s\n' "$current" > .tickets/closed
    rm -f .tickets/current
    echo "closed $current"
    ;;
  *)
    echo "usage: ./ticket.sh start TICKET_ID | close" >&2
    exit 2
    ;;
esac
