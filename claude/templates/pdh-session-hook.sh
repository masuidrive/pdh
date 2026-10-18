#!/usr/bin/env bash
# SessionStart の補助情報。失敗しても session を止めない。
exec 2>/dev/null
cat >/dev/null || exit 0
[ "${PDH_ROLE+x}" ] && exit 0
root=$(git rev-parse --show-toplevel) || exit 0
context=$(bash "$root/scripts/pdh-stage-checklist.sh" --show) || exit 0
payload=$(printf '%s' "$context" | python3 -c '
import json
import sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": sys.stdin.read()}}, ensure_ascii=False))
') || exit 0
printf '%s\n' "$payload"
exit 0
