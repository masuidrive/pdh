#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

command=ready
if [[ ${1:-} == decision ]]; then
    command=decision
    work=${2:?Expected the current feature ticket directory}
    shift 2
elif (( $# == 0 )); then
    work="tickets/${TICKET_NAME:?Run this check through ticket.sh close}"
    ticket_dir=${TICKET_DIR:-}
    ticket_file=${TICKET_FILE:-}
    if [[ ${ticket_dir#"$PWD/"} != "$work" ]] ||
       [[ -n "$ticket_file" && ${ticket_file#"$PWD/"} != "$work/ticket.md" ]]; then
        printf '%s\n' 'PDH close requires a ticket directory.' >&2
        exit 1
    fi
else
    printf '%s\n' 'Use ticket.sh decision or ticket.sh close.' >&2
    exit 1
fi
if [[ ! "$work" =~ ^tickets/[^./][^/]*$ ]]; then
    printf '%s\n' "Invalid PDH ticket directory: $work" >&2
    exit 1
fi
progress=$(git show "HEAD:$work/progress.md")
agreed=$(sed -n 's/^- 初回合意 | //p' <<< "$progress")
if [[ ! "$agreed" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
    printf '%s\n' "$work/progress.md: commit one '- 初回合意 | <full SHA>' entry before close." >&2
    exit 1
fi
exec python3 scripts/pdh.py "$command" "$work" "$agreed" "$@"
