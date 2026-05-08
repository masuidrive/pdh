#!/usr/bin/env bash
# Phase H6 smoke: run pdh-c-v2 (full variant) end-to-end with real claude+codex.
#
# Validates the entire ticket flow:
#   assist → investigate_plan → plan_review (4 reviewers + aggregate, maybe repair)
#       → plan_gate (auto-approved) → implement
#       → code_quality_review (5 reviewers + aggregate, maybe repair)
#       → final_verification → close_gate (auto-approved) → close_finalize → success.
#
# Gate decisions are pre-written to disk before engine start so the gate poller
# returns immediately. INTENTIONALLY excluded from `npm run test:all` per the
# "no real providers in tests" rule.
#
# Cost: ~12-20 LLM calls (claude subscription + codex subscription) plus
# a handful of Anthropic API calls for the judge (~$0.10 / ticket).
# Time: ~12-30 min wall clock.
#
# Usage:
#   bash scripts/smoke-real-fullflow.sh                              # default fixture (smoke-fullflow-divide)
#   bash scripts/smoke-real-fullflow.sh smoke-fullflow-power         # named fixture
#   FIXTURE=smoke-fullflow-power bash scripts/smoke-real-fullflow.sh # via env
#   KEEP_WORKTREE=1 bash scripts/smoke-real-fullflow.sh              # leave artifacts

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
INPUT_FIXTURE="$REPO/tests/fixtures/v2/$FIXTURE_NAME/input"
if [ ! -d "$INPUT_FIXTURE" ]; then
  echo "fixture input dir missing: $INPUT_FIXTURE" >&2
  echo "(available fixtures with smoke- prefix:" >&2
  ls "$REPO/tests/fixtures/v2/" 2>/dev/null | grep '^smoke-' >&2 || true
  echo ")" >&2
  exit 1
fi
echo "[fullflow] fixture: $FIXTURE_NAME"

WORKTREE=$(mktemp -d -t pdh-fullflow-XXXXXX)
echo "[fullflow] worktree: $WORKTREE"

cleanup() {
  if [ "${KEEP_WORKTREE:-0}" = "1" ]; then
    echo "[fullflow] KEEP_WORKTREE=1 — leaving $WORKTREE for inspection"
  else
    rm -rf "$WORKTREE"
  fi
}
trap cleanup EXIT

cp -r "$INPUT_FIXTURE/." "$WORKTREE/"
(
  cd "$WORKTREE"
  git init -q
  git -c user.email=t@t -c user.name=t add -A
  git -c user.email=t@t -c user.name=t commit -q -m "[setup] seed fullflow fixture"
)

RUN_ID="fullflow-$(date +%s)"

# Pull the ticket_id from the fixture's frontmatter so a single runner can
# drive any fixture without code edits.
TICKET_ID=$(awk '/^ticket_id:/ { print $2; exit }' "$INPUT_FIXTURE/current-ticket.md")
if [ -z "$TICKET_ID" ]; then
  echo "could not parse ticket_id from $INPUT_FIXTURE/current-ticket.md" >&2
  exit 1
fi
echo "[fullflow] ticket: $TICKET_ID"

# Pre-create gate approval files so the gate poller resolves immediately when
# the engine reaches plan_gate / close_gate. This stands in for the real CLI /
# Web UI delivery channel.
GATES_DIR="$WORKTREE/.pdh-flow/runs/$RUN_ID/gates"
mkdir -p "$GATES_DIR"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

write_gate() {
  local node_id="$1"
  cat > "$GATES_DIR/$node_id.json" <<EOF
{
  "status": "completed",
  "node_id": "$node_id",
  "round": 1,
  "decision": "approved",
  "approver": "auto-pdm-fullflow-smoke",
  "decided_at": "$NOW",
  "comment": "auto-approved by smoke-real-fullflow.sh",
  "via": "cli"
}
EOF
}
write_gate plan_gate
write_gate close_gate

echo "[fullflow] before:"
echo "  calc.py size: $(wc -l < "$WORKTREE/calc.py") lines"
echo "  test_calc.py size: $(wc -l < "$WORKTREE/test_calc.py") lines"

echo ""
echo "[fullflow] running engine (real claude+codex, ~15-30 min)..."

# 40 min hard cap. The default in run.ts is 20 min; this flow is slower because
# review_loop dispatches multiple reviewers per round.
node src/cli/index.ts run-engine \
  --ticket "$TICKET_ID" \
  --flow pdh-c-v2 \
  --variant full \
  --worktree "$WORKTREE" \
  --run-id "$RUN_ID" \
  --timeout-ms 2400000 \
  > /tmp/pdh-fullflow.stdout.log \
  2> /tmp/pdh-fullflow.stderr.log &
ENGINE_PID=$!

# Tail engine stderr to console so we can watch progress.
tail -F /tmp/pdh-fullflow.stderr.log &
TAIL_PID=$!

if ! wait $ENGINE_PID; then
  echo ""
  echo "[fullflow] engine exited non-zero — last stderr / stdout snippets follow"
  kill $TAIL_PID 2>/dev/null || true
  echo "--- stdout tail ---"
  tail -30 /tmp/pdh-fullflow.stdout.log || true
  echo "--- stderr tail ---"
  tail -50 /tmp/pdh-fullflow.stderr.log || true
  echo "--- git log ---"
  git -C "$WORKTREE" log --oneline | head -50 || true
  exit 1
fi
kill $TAIL_PID 2>/dev/null || true

echo ""
echo "[fullflow] engine output:"
cat /tmp/pdh-fullflow.stdout.log

echo ""
echo "[fullflow] git log (oldest → newest):"
git -C "$WORKTREE" log --oneline --reverse | tail -50

echo ""
echo "[fullflow] judgements:"
ls "$WORKTREE/.pdh-flow/runs/$RUN_ID/judgements/" 2>/dev/null || echo "  (none)"

echo ""
echo "[fullflow] calc.py after:"
echo "  size: $(wc -l < "$WORKTREE/calc.py") lines"
echo "  --- last 20 lines ---"
tail -20 "$WORKTREE/calc.py"

echo ""
echo "[fullflow] note tail (last 80 lines):"
tail -80 "$WORKTREE/current-note.md"

FINAL_STATE=$(grep -o '"final_state": *"[^"]*"' /tmp/pdh-fullflow.stdout.log | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
echo ""
if [ "$FINAL_STATE" = "__failed__" ] || [ -z "$FINAL_STATE" ]; then
  echo "[fullflow] FAIL — final_state=${FINAL_STATE:-<missing>}"
  echo "  see /tmp/pdh-fullflow.stderr.log for the cause"
  exit 1
fi
echo "[fullflow] final_state=$FINAL_STATE"
echo "[fullflow] PASS"
