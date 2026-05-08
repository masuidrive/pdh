#!/usr/bin/env bash
# F-012/K6-WebUI smoke: same turn-loop as smoke-real-turn-loop.sh, but
# the answer is delivered through the Web UI's HTTP API instead of the
# pdh-flow turn-respond CLI. Mimics what the browser does: GET the run
# summary to discover the active_turn, POST the answer JSON to
# /api/runs/<runId>/turns/<nodeId>/<turn>, observe the engine resume.
#
# Browser-level rendering of the turn card is verified by reading the
# JS (web/app.js renderTurnCardWrap + wireTurnForm); this smoke covers
# the HTTP path the rendered form ultimately hits. Without an installed
# headless browser (no playwright/puppeteer in node_modules), this is
# the highest-fidelity automated smoke available.
#
# Excluded from `npm run test:all`. Cost ~$0.05 / run, ~1 min wall clock.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [ -f /home/masuidrive/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  source /home/masuidrive/.nvm/nvm.sh >/dev/null
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found in PATH" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl not found in PATH" >&2
  exit 1
fi

PORT="${PDH_WEBUI_PORT:-9876}"
WORKTREE=$(mktemp -d -t pdh-turnsmoke-webui-XXXXXX)
echo "[turn-webui] worktree: $WORKTREE"
echo "[turn-webui] port:     $PORT"

ENGINE_PID=""
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "$ENGINE_PID" ]; then
    kill "$ENGINE_PID" 2>/dev/null || true
    wait "$ENGINE_PID" 2>/dev/null || true
  fi
  if [ "${KEEP_WORKTREE:-0}" = "1" ]; then
    echo "[turn-webui] KEEP_WORKTREE=1 — leaving $WORKTREE"
  else
    rm -rf "$WORKTREE"
  fi
}
trap cleanup EXIT

TICKET_ID="260508-110000-turn-webui-smoke"
RUN_ID="turn-webui-$(date +%s)"

(
  cd "$WORKTREE"
  mkdir -p tickets
  cat > "tickets/${TICKET_ID}.md" <<'TICKET'
---
ticket_id: 260508-110000-turn-webui-smoke
title: Describe a hat (Web UI smoke)
status: open
---

# Description

Describe a hat.

# Acceptance Criteria

- AC-1: produce a one-paragraph description of *one specific kind of hat*.

# Constraints

- The user will tell you what kind of hat they want — you must ask before deciding.
TICKET
  cat > "tickets/${TICKET_ID}-note.md" <<NOTE
---
ticket_id: ${TICKET_ID}
status: in_progress
---

# Process journal
NOTE
  ln -s "tickets/${TICKET_ID}.md" current-ticket.md
  ln -s "tickets/${TICKET_ID}-note.md" current-note.md
  cat > .gitignore <<'GIT'
current-ticket.md
current-note.md
.pdh-flow/
GIT
  git init -q
  git -c user.email=t@t -c user.name=t add -A
  git -c user.email=t@t -c user.name=t commit -q -m "[setup] seed turn-webui smoke"
)

# Sanity-check that PORT is free before we start.
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  echo "[turn-webui] FAIL — port $PORT is already in use" >&2
  exit 1
fi

echo "[turn-webui] starting pdh-flow serve on :$PORT..."
node src/cli/index.ts serve --worktree "$WORKTREE" --port "$PORT" \
  > /tmp/pdh-turn-webui.serve.log 2>&1 &
SERVER_PID=$!

# Wait for the server to bind.
WAITED=0
until curl -sf "http://localhost:$PORT/api/runs" >/dev/null 2>&1; do
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "[turn-webui] FAIL — server died before binding"
    cat /tmp/pdh-turn-webui.serve.log
    exit 1
  fi
  sleep 0.5
  WAITED=$((WAITED + 1))
  if [ $WAITED -gt 20 ]; then
    echo "[turn-webui] FAIL — server didn't bind within 10s"
    exit 1
  fi
done
echo "[turn-webui] server listening"

# Sanity check: static assets load.
INDEX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/")
APPJS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/app.js")
if [ "$INDEX_STATUS" != "200" ] || [ "$APPJS_STATUS" != "200" ]; then
  echo "[turn-webui] FAIL — static assets returned $INDEX_STATUS / $APPJS_STATUS"
  exit 1
fi
echo "[turn-webui] static assets OK (index.html=$INDEX_STATUS, app.js=$APPJS_STATUS)"

echo "[turn-webui] running engine (real claude)..."
node src/cli/index.ts run-engine \
  --ticket "$TICKET_ID" \
  --flow pdh-turn-smoke \
  --variant full \
  --worktree "$WORKTREE" \
  --run-id "$RUN_ID" \
  --timeout-ms 600000 \
  > /tmp/pdh-turn-webui.engine.stdout.log \
  2> /tmp/pdh-turn-webui.engine.stderr.log &
ENGINE_PID=$!

# Poll the API for active_turn appearing on the run summary. This is
# exactly what the browser's snapshot fetch sees.
echo "[turn-webui] polling /api/runs/$RUN_ID for active_turn..."
WAITED=0
ACTIVE_TURN_JSON=""
while true; do
  if ! kill -0 $ENGINE_PID 2>/dev/null; then
    echo "[turn-webui] FAIL — engine exited before producing a question"
    echo "--- engine stderr ---"
    tail -30 /tmp/pdh-turn-webui.engine.stderr.log
    exit 1
  fi
  if [ $WAITED -ge 180 ]; then
    echo "[turn-webui] FAIL — timed out waiting for active_turn (180s)"
    exit 1
  fi
  RESP=$(curl -s "http://localhost:$PORT/api/runs/$RUN_ID" || true)
  if echo "$RESP" | grep -q '"active_turn":\s*{'; then
    ACTIVE_TURN_JSON="$RESP"
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "[turn-webui] active_turn detected after ${WAITED}s"
echo "--- /api/runs/$RUN_ID active_turn ---"
echo "$ACTIVE_TURN_JSON" | python3 -c "import json,sys; r=json.load(sys.stdin); print(json.dumps(r['active_turn'], indent=2, ensure_ascii=False))"

# Extract node_id + turn from the response (mimicking what the JS does
# when it builds the form's data attributes).
TURN_NODE=$(echo "$ACTIVE_TURN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['active_turn']['node_id'])")
TURN_NUM=$(echo "$ACTIVE_TURN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['active_turn']['turn'])")
echo "[turn-webui] target: node=$TURN_NODE turn=$TURN_NUM"

echo "[turn-webui] POSTing answer (mimicking the browser form submit)..."
POST_RESP=$(curl -s -X POST \
  "http://localhost:$PORT/api/runs/$RUN_ID/turns/$TURN_NODE/$TURN_NUM" \
  -H "Content-Type: application/json" \
  -d '{"text":"I'\''d like a beret — black wool, no embellishments.","selected_option":2,"responder":"webui-smoke"}')
echo "--- POST response ---"
echo "$POST_RESP" | python3 -m json.tool

# Verify the answer was actually written.
ANSWER_FILE="$WORKTREE/.pdh-flow/runs/$RUN_ID/turns/$TURN_NODE/turn-001-answer.json"
if [ ! -f "$ANSWER_FILE" ]; then
  echo "[turn-webui] FAIL — answer file not written at $ANSWER_FILE"
  exit 1
fi
echo "--- answer file ---"
cat "$ANSWER_FILE"

# Verify duplicate POST returns 409.
echo ""
echo "[turn-webui] checking duplicate POST → 409..."
DUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "http://localhost:$PORT/api/runs/$RUN_ID/turns/$TURN_NODE/$TURN_NUM" \
  -H "Content-Type: application/json" \
  -d '{"text":"again"}')
if [ "$DUP_STATUS" != "409" ]; then
  echo "[turn-webui] FAIL — duplicate POST should be 409, got $DUP_STATUS"
  exit 1
fi
echo "[turn-webui] duplicate POST correctly rejected with 409"

echo "[turn-webui] waiting for engine to finish..."
if ! wait $ENGINE_PID; then
  echo "[turn-webui] FAIL — engine exited non-zero"
  echo "--- stderr tail ---"
  tail -50 /tmp/pdh-turn-webui.engine.stderr.log
  exit 1
fi
ENGINE_PID=""

echo ""
echo "[turn-webui] engine output:"
cat /tmp/pdh-turn-webui.engine.stdout.log

FINAL_STATE=$(grep -o '"final_state": *"[^"]*"' /tmp/pdh-turn-webui.engine.stdout.log | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
if [ "$FINAL_STATE" != "terminal" ]; then
  echo "[turn-webui] FAIL — final_state=${FINAL_STATE:-<missing>}"
  exit 1
fi

# After engine completes, active_turn should be null on the API.
FINAL_RESP=$(curl -s "http://localhost:$PORT/api/runs/$RUN_ID")
ACTIVE_AFTER=$(echo "$FINAL_RESP" | python3 -c "import json,sys; r=json.load(sys.stdin); print('null' if r.get('active_turn') is None else 'still-present')")
if [ "$ACTIVE_AFTER" != "null" ]; then
  echo "[turn-webui] WARN — active_turn still present after terminal (got $ACTIVE_AFTER)"
fi

echo ""
echo "[turn-webui] note tail:"
tail -30 "$WORKTREE/current-note.md"

# Sanity: the LLM should have used the answer (a beret, not the
# fedora the previous CLI smoke supplied). This catches a regression
# where the resume picked up a stale session.
if grep -qi "beret" "$WORKTREE/current-note.md"; then
  echo "[turn-webui] ✓ note references 'beret' — answer reached the LLM"
else
  echo "[turn-webui] WARN — note doesn't reference 'beret', resume may have dropped the answer"
fi

echo "[turn-webui] PASS"
