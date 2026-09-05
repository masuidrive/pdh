#!/usr/bin/env bash
# dev-server.sh — PDH verify / human-review local dev server entrypoint.
#
# Copy to scripts/dev-server.sh and edit for the project.
# Required common options:
#   --seed          Reset local state and run scripts/seed-pdh-verify.sh before start.
#   --port PORT     Use a fixed local port. If omitted, choose an available port.
#   --persist-to D  Optional project-specific local persistence path.
#   --no-localhost  Expose a non-localhost review URL using the project's safe method.
set -euo pipefail

show_help() {
  cat <<'USAGE'
Usage: ./scripts/dev-server.sh [--seed] [--port PORT] [--persist-to DIR] [--no-localhost]

This is a PDH template. Edit it for this project before relying on it.

Expected project behavior:
  --seed          Reset local state and run scripts/seed-pdh-verify.sh.
  --port PORT     Bind to the requested port.
  --persist-to D  Use the requested local persistence path, if applicable.
  --no-localhost  Print a non-localhost review URL using the project's safe method.

PDH agents use this script for PDH-verify and PDH-human-review when UI/API
surfaces need a running local server.
USAGE
}

seed=false
port=""
persist_to=""
no_localhost=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed)
      seed=true
      shift
      ;;
    --port)
      port="${2:-}"
      if [[ -z "$port" ]]; then
        echo "Missing value for --port" >&2
        exit 2
      fi
      shift 2
      ;;
    --persist-to)
      persist_to="${2:-}"
      if [[ -z "$persist_to" ]]; then
        echo "Missing value for --persist-to" >&2
        exit 2
      fi
      shift 2
      ;;
    --no-localhost)
      no_localhost=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      show_help >&2
      exit 2
      ;;
  esac
done

if [[ -z "$port" ]]; then
  port="$((20000 + (RANDOM % 20000)))"
fi

if $seed; then
  ./scripts/seed-pdh-verify.sh
fi

cat >&2 <<MSG
scripts/dev-server.sh is still the PDH template.

Edit this file to start this project's dev server.

Parsed options:
  port: $port
  persist_to: ${persist_to:-<not set>}
  no_localhost: $no_localhost
  seed: $seed

The project-specific implementation should print:
  - local review URL
  - non-localhost review URL when --no-localhost is used
  - dummy login / auth instructions when needed
  - cleanup instructions for temporary files or server processes
MSG

exit 2
