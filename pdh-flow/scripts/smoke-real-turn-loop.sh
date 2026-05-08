#!/usr/bin/env bash
# F-012/K6 smoke: end-to-end turn loop with real claude.
#
# Flow: pdh-turn-smoke (one provider_step with enable_user_input=true,
# role=turn_smoke whose prompt forces exactly one clarifying question).
# Runner answers the question via the K4 CLI (pdh-flow turn-respond),
# verifies the engine resumes the provider, captures both turn files
# in `runs/<runId>/turns/<nodeId>/`, and lands on terminal.
#
# Excluded from `npm run test:all` (real LLM cost ~$0.05 / run, ~1 min
# wall-clock).

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

WORKTREE=$(mktemp -d -t pdh-turnsmoke-XXXXXX)
echo "[turn-smoke] worktree: $WORKTREE"

cleanup() {
  if [ "${KEEP_WORKTREE:-0}" = "1" ]; then
    echo "[turn-smoke] KEEP_WORKTREE=1 — leaving $WORKTREE for inspection"
  else
    rm -rf "$WORKTREE"
  fi
  pkill -P $$ 2>/dev/null || true
}
trap cleanup EXIT

TICKET_ID="260508-100000-turn-loop-smoke"
RUN_ID="turn-smoke-$(date +%s)"

(
  cd "$WORKTREE"
  mkdir -p tickets
  cat > "tickets/${TICKET_ID}.md" <<'TICKET'
---
ticket_id: 260508-100000-turn-loop-smoke
title: Describe a hat
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
  git -c user.email=t@t -c user.name=t commit -q -m "[setup] seed turn-loop smoke"
)

echo "[turn-smoke] running engine in background (real claude, ~30-90s before question)..."
node src/cli/index.ts run-engine \
  --ticket "$TICKET_ID" \
  --flow pdh-turn-smoke \
  --variant full \
  --worktree "$WORKTREE" \
  --run-id "$RUN_ID" \
  --timeout-ms 600000 \
  > /tmp/pdh-turn-smoke.stdout.log \
  2> /tmp/pdh-turn-smoke.stderr.log &
ENGINE_PID=$!

# Poll for the question file (engine should land on it within ~60s with
# real claude).
QFILE="$WORKTREE/.pdh-flow/runs/$RUN_ID/turns/ask_user/turn-001-question.json"
echo "[turn-smoke] waiting for question file at $QFILE"
WAITED=0
while [ ! -f "$QFILE" ]; do
  if ! kill -0 $ENGINE_PID 2>/dev/null; then
    echo "[turn-smoke] engine exited before producing a question — fail"
    echo "--- stderr tail ---"
    tail -40 /tmp/pdh-turn-smoke.stderr.log
    echo "--- stdout tail ---"
    tail -20 /tmp/pdh-turn-smoke.stdout.log
    exit 1
  fi
  if [ $WAITED -ge 180 ]; then
    echo "[turn-smoke] timed out waiting for question (180s)"
    kill $ENGINE_PID 2>/dev/null || true
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "[turn-smoke] question file appeared after ${WAITED}s"
echo "--- question ---"
cat "$QFILE"
echo ""

echo "[turn-smoke] answering via pdh-flow turn-respond CLI..."
node src/cli/index.ts turn-respond \
  --run-id "$RUN_ID" \
  --node-id ask_user \
  --worktree "$WORKTREE" \
  --text "I'd like a fedora — gray felt, narrow brim." \
  --responder smoke-script \
  --via cli

echo "[turn-smoke] waiting for engine to finish..."
if ! wait $ENGINE_PID; then
  echo "[turn-smoke] engine failed after the answer was delivered"
  echo "--- stderr tail ---"
  tail -50 /tmp/pdh-turn-smoke.stderr.log
  exit 1
fi

echo ""
echo "[turn-smoke] engine output:"
cat /tmp/pdh-turn-smoke.stdout.log

FINAL_STATE=$(grep -o '"final_state": *"[^"]*"' /tmp/pdh-turn-smoke.stdout.log | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
if [ "$FINAL_STATE" != "terminal" ]; then
  echo "[turn-smoke] FAIL — final_state=${FINAL_STATE:-<missing>}"
  exit 1
fi

# K2 cleanup runs `clearTurnsDir` after final, so the turn files are
# gone by terminal — verify the note section captures both Q and A.
echo ""
echo "[turn-smoke] note tail:"
tail -40 "$WORKTREE/current-note.md"

if ! grep -q "asked" "$WORKTREE/current-note.md"; then
  echo "[turn-smoke] FAIL — note doesn't show the turn was logged"
  exit 1
fi

echo "[turn-smoke] PASS"
