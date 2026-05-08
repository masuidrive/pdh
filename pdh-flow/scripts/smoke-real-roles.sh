#!/usr/bin/env bash
# Phase H5 smoke: run pdh-smoke-roles flow with real claude+codex.
#
# Validates assist / planner / implementer prompts produce useful output
# end-to-end. INTENTIONALLY excluded from npm run test:all per the
# "no real providers in tests" rule.
#
# Cost: ~1 claude + 2 codex subscription calls.
# Time: ~2-3 min.
#
# Usage:
#   bash scripts/smoke-real-roles.sh
#   KEEP_WORKTREE=1 bash scripts/smoke-real-roles.sh   # leave artifacts

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

INPUT_FIXTURE="$REPO/tests/fixtures/v2/smoke-roles/input"
if [ ! -d "$INPUT_FIXTURE" ]; then
  echo "fixture input dir missing: $INPUT_FIXTURE" >&2
  exit 1
fi

WORKTREE=$(mktemp -d -t pdh-smoke-roles-XXXXXX)
echo "[smoke] worktree: $WORKTREE"

cleanup() {
  if [ "${KEEP_WORKTREE:-0}" = "1" ]; then
    echo "[smoke] KEEP_WORKTREE=1 — leaving $WORKTREE for inspection"
  else
    rm -rf "$WORKTREE"
  fi
}
trap cleanup EXIT

cp -r "$INPUT_FIXTURE/." "$WORKTREE/"
TICKET_ID=$(awk '/^ticket_id:/ { print $2; exit }' "$WORKTREE/tickets/"*.md 2>/dev/null | head -1)
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
  git -c user.email=t@t -c user.name=t commit -q -m "[setup] seed smoke-roles fixture"
)

RUN_ID="smoke-roles-$(date +%s)"

echo "[smoke] before:"
echo "  calc.py size: $(wc -l < $WORKTREE/calc.py) lines"

echo ""
echo "[smoke] running engine (real claude+codex, ~2-3 min)..."
node src/cli/index.ts run-engine \
  --ticket 260508-085000-smoke-divide \
  --flow pdh-smoke-roles \
  --variant full \
  --worktree "$WORKTREE" \
  --run-id "$RUN_ID"

echo ""
echo "[smoke] git log:"
git -C "$WORKTREE" log --oneline | head -10

echo ""
echo "[smoke] calc.py after:"
echo "  size: $(wc -l < $WORKTREE/calc.py) lines"
echo "  --- last 20 lines ---"
tail -20 "$WORKTREE/calc.py"

echo ""
echo "[smoke] note tail (last 60 lines):"
tail -60 "$WORKTREE/current-note.md"

echo ""
echo "[smoke] PASS"
