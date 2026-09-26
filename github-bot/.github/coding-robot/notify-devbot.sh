#!/usr/bin/env bash
# usage: notify-devbot.sh <issue> <kind> [stage] [comment_id] [pr] [run_url]
# ⚠ 通知の失敗は run / deploy の成否を変えない。依存コマンドの失敗もここで吸収する。
set +x
set +e
set -uo pipefail
warn() { printf 'Warning: notify-devbot: %s\n' "$*" >&2; }
[ -n "${DEVBOT_NOTIFY_URL:-}" ] || { echo 'notify-devbot: URL 未設定。送信しない'; exit 0; }
[ -n "${DEVBOT_NOTIFY_SECRET:-}" ] || { warn '秘密が未設定。送信しない'; exit 0; }
issue="${1:-}"; kind="${2:-}"; stage="${3:-}"; comment_id="${4:-}"; pr="${5:-}"; run_url="${6:-}"
if ! [[ "$issue" =~ ^[0-9]+$ ]] ||
   ! [[ "$comment_id" =~ ^[0-9]*$ ]] || ! [[ "$pr" =~ ^[0-9]*$ ]] ||
   { [ -n "$stage" ] && ! [[ "$stage" =~ ^PDH-[a-z-]+$ ]]; }; then
  warn '不正な引数。送信しない'; exit 0
fi
case "$kind" in question|ticket_gate|close_gate|blocked|failed|deployed|deploy_failed) ;;
  *) warn '不正な kind。送信しない'; exit 0 ;;
esac
body=$(jq -cn --arg issue "$issue" --arg kind "$kind" --arg stage "$stage" \
  --arg cid "$comment_id" --arg pr "$pr" --arg run "$run_url" \
  '{issue: ($issue | tonumber), kind: $kind, stage: (if $stage == "" then null else $stage end),
    comment_id: ($cid | tonumber? // null), pr: ($pr | tonumber? // null),
    run_url: (if $run == "" then null else $run end)}') \
  || { warn 'JSON の作成に失敗'; exit 0; }
ts=$(date +%s) || { warn '時刻の取得に失敗'; exit 0; }
# ⚠ 秘密を argv に置かない。-I で workspace / PYTHONPATH の module を import しない。
# 署名するバイト列は stdin、鍵は環境からだけ読む。
sig=$(printf 'v1:%s:%s' "$ts" "$body" | python3 -I -c '
import hashlib, hmac, os, sys
print(hmac.new(os.environ["DEVBOT_NOTIFY_SECRET"].encode(), sys.stdin.buffer.read(), hashlib.sha256).hexdigest())
') || { warn '署名に失敗'; exit 0; }
url="${DEVBOT_NOTIFY_URL%/}/hooks/robot"
status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
  -A 'coding-robot-notify/1' -H 'Content-Type: application/json' \
  -H "X-Devbot-Timestamp: $ts" -H "X-Devbot-Signature: v1=$sig" \
  --data-binary "$body" "$url")
rc=$?
printf 'notify-devbot: HTTP %s (curl exit %s)\n' "${status:-000}" "$rc"
exit 0
