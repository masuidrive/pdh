#!/usr/bin/env bash
# Phase G smoke: run pdh-smoke-real flow with the real claude CLI.
#
# This script is INTENTIONALLY excluded from npm run test:all. Per
# CLAUDE.md "No real providers in tests" — automated tests must replay
# fixtures, not call live LLMs. Use this script manually when:
#   - validating that the engine wires real claude correctly
#   - recording a new fixture
#   - debugging real-mode regressions
#
# Cost: ~2 claude subscription calls (reviewer + aggregator).
# Time: ~1–2 min.
#
# Usage:
#   bash scripts/smoke-real-claude.sh

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

INPUT_FIXTURE="$REPO/tests/fixtures/v2/code_quality_review_round1_pass/input"
if [ ! -d "$INPUT_FIXTURE" ]; then
  echo "fixture input dir missing: $INPUT_FIXTURE" >&2
  exit 1
fi

WORKTREE=$(mktemp -d -t pdh-smoke-claude-XXXXXX)
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
(
  cd "$WORKTREE"
  git init -q
  git -c user.email=t@t -c user.name=t add -A
  git -c user.email=t@t -c user.name=t commit -q -m "[setup] seed fixture input"
)

RUN_ID="smoke-claude-$(date +%s)"

echo "[smoke] running engine (real claude, ~1-2 min)..."
node src/cli/index.ts run-engine \
  --ticket 260507-220000-calc-divide \
  --flow pdh-smoke-real \
  --variant full \
  --worktree "$WORKTREE" \
  --run-id "$RUN_ID"

echo ""
echo "[smoke] git log:"
git -C "$WORKTREE" log --oneline | head -20

echo ""
echo "[smoke] judgements:"
ls -la "$WORKTREE/.pdh-flow/runs/$RUN_ID/judgements/" 2>/dev/null || echo "(no judgements dir)"

echo ""
echo "[smoke] note tail:"
tail -40 "$WORKTREE/current-note.md"

echo ""
echo "[smoke] PASS"
