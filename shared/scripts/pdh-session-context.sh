#!/usr/bin/env bash
# Only the earlier stage workflow uses its SessionStart checklist.
set -eu
root=$(git rev-parse --show-toplevel) || exit 0
if [[ -f "$root/current-note.md" && ! -e "$root/current-ticket/scope.md" && -f "$root/scripts/pdh-session-hook.sh" ]]; then
    exec bash "$root/scripts/pdh-session-hook.sh"
fi
