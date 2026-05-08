#!/usr/bin/env bash
# Hands-on try-it: spin up a real engine + Web UI on a fresh worktree.
#
# Differences from smoke-real-fullflow.sh:
#   - DOES NOT pre-write gate approvals. The engine pauses at plan_gate and
#     close_gate; the user must approve via the Web UI.
#   - Web server stays in the foreground so Ctrl+C cleans up everything.
#   - Engine logs go to /tmp/pdh-tryit.engine.log so the foreground stays
#     readable while the engine runs.
#   - The worktree is preserved by default for inspection (override with
#     CLEAN_ON_EXIT=1 if you want auto-cleanup).
#
# Usage:
#   bash scripts/try-it.sh                              # default fixture (smoke-fullflow-divide)
#   bash scripts/try-it.sh smoke-fullflow-power         # named fixture
#   FIXTURE=smoke-fullflow-modulo bash scripts/try-it.sh
#   PORT=5180 bash scripts/try-it.sh                    # different port
#
# After Ctrl+C the worktree path is printed so you can inspect commits etc.

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
if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI not found in PATH" >&2
  exit 1
fi

FIXTURE_NAME="${1:-${FIXTURE:-smoke-fullflow-divide}}"
PORT="${PORT:-5170}"
INPUT_FIXTURE="$REPO/tests/fixtures/v2/$FIXTURE_NAME/input"
if [ ! -d "$INPUT_FIXTURE" ]; then
  echo "fixture input dir missing: $INPUT_FIXTURE" >&2
  echo "available fixtures:" >&2
  ls "$REPO/tests/fixtures/v2/" 2>/dev/null | grep '^smoke-' | sed 's/^/  /' >&2 || true
  exit 1
fi

WORKTREE=$(mktemp -d -t pdh-tryit-XXXXXX)
RUN_ID="tryit-$(date +%s)"
echo "[try-it] fixture: $FIXTURE_NAME"
echo "[try-it] worktree: $WORKTREE"
echo "[try-it] run-id: $RUN_ID"

cp -r "$INPUT_FIXTURE/." "$WORKTREE/"
(
  cd "$WORKTREE"
  git init -q
  git -c user.email=t@t -c user.name=t add -A
  git -c user.email=t@t -c user.name=t commit -q -m "[setup] seed try-it fixture"
)

TICKET_ID=$(awk '/^ticket_id:/ { print $2; exit }' "$INPUT_FIXTURE/current-ticket.md")
if [ -z "$TICKET_ID" ]; then
  echo "could not parse ticket_id from $INPUT_FIXTURE/current-ticket.md" >&2
  exit 1
fi
echo "[try-it] ticket: $TICKET_ID"

# ── Start the engine in background. 30 min timeout gives you plenty of time
#    to approve gates manually. Engine logs are tail-able from another terminal.
ENGINE_LOG="/tmp/pdh-tryit.engine.log"
: > "$ENGINE_LOG"
echo "[try-it] starting engine (logs: $ENGINE_LOG)"
node src/cli/index.ts run-engine \
  --ticket "$TICKET_ID" \
  --flow pdh-c-v2 \
  --variant full \
  --worktree "$WORKTREE" \
  --run-id "$RUN_ID" \
  --timeout-ms 1800000 \
  > "$ENGINE_LOG" 2>&1 &
ENGINE_PID=$!

cleanup() {
  echo ""
  echo "[try-it] stopping engine (pid=$ENGINE_PID)…"
  kill "$ENGINE_PID" 2>/dev/null || true
  wait "$ENGINE_PID" 2>/dev/null || true
  if [ "${CLEAN_ON_EXIT:-0}" = "1" ]; then
    echo "[try-it] removing worktree $WORKTREE"
    rm -rf "$WORKTREE"
  else
    echo "[try-it] worktree preserved at: $WORKTREE"
    echo "[try-it]   git -C $WORKTREE log --oneline | head"
    echo "[try-it]   ls $WORKTREE/.pdh-flow/runs/$RUN_ID/"
  fi
}
trap cleanup EXIT

cat <<EOF

[try-it] ── ready ────────────────────────────────────────────────
  Open    http://localhost:$PORT/  in your browser.

  - Click 'Open' on the run.
  - Wait for plan_review to finish (~3-5 min); when the engine
    reaches plan_gate the UI shows 'Approval needed: plan_gate'.
  - Fill an approver name + click Approve.
  - Wait for code_quality_review + final_verification (~5-7 min).
  - Approve close_gate when prompted.
  - The run state turns 'closed' / 'terminal' when done.

  Watch engine output:  tail -f $ENGINE_LOG
  Stop:                 Ctrl+C  (worktree preserved)
[try-it] ─────────────────────────────────────────────────────────

EOF

# Foreground web server. Ctrl+C drops to cleanup() above.
node src/cli/index.ts serve --worktree "$WORKTREE" --port "$PORT"
