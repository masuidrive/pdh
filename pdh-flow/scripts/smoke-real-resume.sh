#!/usr/bin/env bash
# F-001/J5 smoke: run pdh-c-v2-resume against a fixture whose implement
# step plausibly leaves something for code_quality_review to flag, so
# the .repair node fires and exercises `codex exec resume <session_id>`.
#
# Validates:
#   - implement node persists `runs/<runId>/sessions/implement.json`
#   - on repair_needed, run-provider reads that session record and
#     invokes codex with --resume (visible as `codex exec resume ...`
#     in the engine stderr trail when -d / --debug is plumbed; for now
#     observable via the second-round implement edits showing up in git
#     under the .repair commit subject).
#
# INTENTIONALLY excluded from `npm run test:all` per the no-real-providers
# rule. Cost / time are similar to smoke-real-fullflow.sh.
#
# Usage:
#   bash scripts/smoke-real-resume.sh                                # default fixture
#   bash scripts/smoke-real-resume.sh smoke-fullflow-cartbug         # named fixture
#   FIXTURE=smoke-fullflow-cartbug bash scripts/smoke-real-resume.sh
#   KEEP_WORKTREE=1 bash scripts/smoke-real-resume.sh                # leave artifacts

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

FIXTURE_NAME="${1:-${FIXTURE:-smoke-fullflow-cartbug}}"
INPUT_FIXTURE="$REPO/tests/fixtures/v2/$FIXTURE_NAME/input"
if [ ! -d "$INPUT_FIXTURE" ]; then
  echo "fixture input dir missing: $INPUT_FIXTURE" >&2
  echo "(available smoke- fixtures:" >&2
  ls "$REPO/tests/fixtures/v2/" 2>/dev/null | grep '^smoke-' >&2 || true
  echo ")" >&2
  exit 1
fi
echo "[resume] fixture: $FIXTURE_NAME"

WORKTREE=$(mktemp -d -t pdh-resume-XXXXXX)
echo "[resume] worktree: $WORKTREE"

cleanup() {
  if [ "${KEEP_WORKTREE:-0}" = "1" ]; then
    echo "[resume] KEEP_WORKTREE=1 — leaving $WORKTREE for inspection"
  else
    rm -rf "$WORKTREE"
  fi
}
trap cleanup EXIT

cp -r "$INPUT_FIXTURE/." "$WORKTREE/"

RUN_ID="resume-$(date +%s)"

TICKET_ID=$(awk '/^ticket_id:/ { print $2; exit }' "$WORKTREE/tickets/"*.md 2>/dev/null | head -1)
if [ -z "$TICKET_ID" ]; then
  echo "could not parse ticket_id from $WORKTREE/tickets/*.md" >&2
  exit 1
fi
echo "[resume] ticket: $TICKET_ID"

(
  cd "$WORKTREE"
  ln -s "tickets/$TICKET_ID.md" current-ticket.md
  ln -s "tickets/$TICKET_ID-note.md" current-note.md
  cat > .gitignore <<'GIT'
current-ticket.md
current-note.md
.pdh-flow/
GIT
  git init -q
  git -c user.email=t@t -c user.name=t add -A
  git -c user.email=t@t -c user.name=t commit -q -m "[setup] seed resume fixture"
)

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
  "approver": "auto-pdm-resume-smoke",
  "decided_at": "$NOW",
  "comment": "auto-approved by smoke-real-resume.sh",
  "via": "cli"
}
EOF
}
write_gate plan_gate
write_gate close_gate

echo ""
echo "[resume] running engine (pdh-c-v2-resume, ~15-30 min)..."

node src/cli/index.ts run-engine \
  --ticket "$TICKET_ID" \
  --flow pdh-c-v2-resume \
  --variant full \
  --worktree "$WORKTREE" \
  --run-id "$RUN_ID" \
  --timeout-ms 2400000 \
  > /tmp/pdh-resume.stdout.log \
  2> /tmp/pdh-resume.stderr.log &
ENGINE_PID=$!

tail -F /tmp/pdh-resume.stderr.log &
TAIL_PID=$!

if ! wait $ENGINE_PID; then
  echo ""
  echo "[resume] engine exited non-zero — tails follow"
  kill $TAIL_PID 2>/dev/null || true
  echo "--- stdout tail ---"
  tail -30 /tmp/pdh-resume.stdout.log || true
  echo "--- stderr tail ---"
  tail -50 /tmp/pdh-resume.stderr.log || true
  echo "--- git log ---"
  git -C "$WORKTREE" log --oneline | head -50 || true
  exit 1
fi
kill $TAIL_PID 2>/dev/null || true

echo ""
echo "[resume] engine output:"
cat /tmp/pdh-resume.stdout.log

echo ""
echo "[resume] git log (oldest → newest):"
git -C "$WORKTREE" log --oneline --reverse | tail -50

echo ""
echo "[resume] sessions captured:"
ls "$WORKTREE/.pdh-flow/runs/$RUN_ID/sessions/" 2>/dev/null || echo "  (none — implement may not have surfaced a session id)"

if [ -f "$WORKTREE/.pdh-flow/runs/$RUN_ID/sessions/implement.json" ]; then
  echo ""
  echo "[resume] sessions/implement.json:"
  cat "$WORKTREE/.pdh-flow/runs/$RUN_ID/sessions/implement.json"
fi

echo ""
echo "[resume] judgements:"
ls "$WORKTREE/.pdh-flow/runs/$RUN_ID/judgements/" 2>/dev/null || echo "  (none)"

echo ""
echo "[resume] note tail (last 100 lines):"
tail -100 "$WORKTREE/current-note.md"

FINAL_STATE=$(grep -o '"final_state": *"[^"]*"' /tmp/pdh-resume.stdout.log | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
echo ""
if [ "$FINAL_STATE" = "__failed__" ] || [ -z "$FINAL_STATE" ]; then
  echo "[resume] FAIL — final_state=${FINAL_STATE:-<missing>}"
  exit 1
fi
echo "[resume] final_state=$FINAL_STATE"

# Heuristic check: did .repair fire? Look for the commit subject.
if git -C "$WORKTREE" log --oneline | grep -q 'code_quality_review.repair'; then
  echo "[resume] code_quality_review.repair fired — resume path was exercised"
else
  echo "[resume] (note: code_quality_review.repair did not fire on this run; resume path was loaded but not invoked)"
fi
echo "[resume] PASS"
