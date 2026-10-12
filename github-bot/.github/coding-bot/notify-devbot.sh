#!/usr/bin/env bash
# usage: notify-devbot.sh <issue> <kind> [stage] [comment_id] [pr] [run_url] [video_url]
# video only: 0=accepted, 3=unavailable (direct fallback), 4=delivery unknown (retry).
# Other kinds always exit 0; notification failures never change run/deploy results.
set +x
set +e
set -uo pipefail
warn() { printf 'Warning: notify-devbot: %s\n' "$*" >&2; }
unavailable=0
[ "${2:-}" != video ] || unavailable=3
[ -n "${CODING_BOT_NOTIFY_URL:-}" ] || { echo 'notify-devbot: URL 未設定。送信しない'; exit "$unavailable"; }
[ -n "${CODING_BOT_NOTIFY_SECRET:-}" ] || { warn '秘密が未設定。送信しない'; exit "$unavailable"; }
issue="${1:-}"; kind="${2:-}"; stage="${3:-}"; comment_id="${4:-}"; pr="${5:-}"; run_url="${6:-}"; video_url="${7:-}"
if ! [[ "$issue" =~ ^[0-9]+$ ]] ||
   ! [[ "$comment_id" =~ ^[0-9]*$ ]] || ! [[ "$pr" =~ ^[0-9]*$ ]] ||
   { [ -n "$stage" ] && ! [[ "$stage" =~ ^PDH-[a-z-]+$ ]]; }; then
  warn '不正な引数。送信しない'; exit "$unavailable"
fi
case "$kind" in question|ticket_gate|close_gate|blocked|failed|mergeable|merged|deployed|deploy_failed|video) ;;
  *) warn '不正な kind。送信しない'; exit 0 ;;
esac
if [ "$kind" = video ] && ! [[ "$video_url" =~ ^https://[^[:space:]]+$ ]]; then
  warn 'video_url must be an https URL'; exit 3
fi
body=$(jq -cn --arg issue "$issue" --arg kind "$kind" --arg stage "$stage" \
  --arg cid "$comment_id" --arg pr "$pr" --arg run "$run_url" \
  '{issue: ($issue | tonumber), kind: $kind, stage: (if $stage == "" then null else $stage end),
    comment_id: ($cid | tonumber? // null), pr: ($pr | tonumber? // null),
    run_url: (if $run == "" then null else $run end)}') \
  || { warn 'JSON の作成に失敗'; exit "$unavailable"; }
if [ "$kind" = video ]; then
  body=$(jq -c --arg url "$video_url" '. + {video_url: $url}' <<<"$body") \
    || { warn 'JSON の作成に失敗'; exit 3; }
fi
ts=$(date +%s) || { warn '時刻の取得に失敗'; exit "$unavailable"; }
# ⚠ 秘密を argv に置かない。-I で workspace / PYTHONPATH の module を import しない。
# 署名するバイト列は stdin、鍵は環境からだけ読む。
sig=$(printf 'v1:%s:%s' "$ts" "$body" | python3 -I -c '
import hashlib, hmac, os, sys
print(hmac.new(os.environ["CODING_BOT_NOTIFY_SECRET"].encode(), sys.stdin.buffer.read(), hashlib.sha256).hexdigest())
') || { warn '署名に失敗'; exit "$unavailable"; }
url="${CODING_BOT_NOTIFY_URL%/}/hooks/robot"
status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
  -A 'coding-bot-notify/1' -H 'Content-Type: application/json' \
  -H "X-Devbot-Timestamp: $ts" -H "X-Devbot-Signature: v1=$sig" \
  --data-binary "$body" "$url")
rc=$?
printf 'notify-devbot: HTTP %s (curl exit %s)\n' "${status:-000}" "$rc"
if [ "$kind" = video ]; then
  [ "$rc" = 0 ] && [ "${status:-000}" != 000 ] || exit 4
  [[ "$status" == 2?? ]] && exit 0
  exit 3
fi
exit 0
