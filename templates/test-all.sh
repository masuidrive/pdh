#!/usr/bin/env bash
# test-all.sh — Run all test suites for PDH projects
#
# Requirements:
# - Run all project test suites (backend, frontend, E2E, SDK, etc.)
# - Support parallel execution (--parallel flag) for faster CI/local runs
# - Each suite runs independently; failures don't block other suites
# - Exit non-zero if any suite fails
# - Print summary with pass/fail per suite
# - In parallel mode, capture logs per suite and show failed suite logs
#
# Usage:
#   scripts/test-all.sh            # sequential (default)
#   scripts/test-all.sh --parallel # parallel execution
#
# PDH integration:
# - PD-C-6 (implementation): Engineers run individual test commands for fast feedback
# - PD-C-9 (completion verification): Run this script to confirm all suites pass
# - Referenced in CLAUDE.md and pdh-dev SKILL.md
#
# Customize the `run` calls below for your project's test suites.
# Each `run "label" command args...` entry defines one suite.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

PARALLEL=false
if [[ "${1:-}" == "--parallel" ]]; then
  PARALLEL=true
fi

FAILED=()
PASSED=()

run_seq() {
  local label="$1"; shift
  echo ""
  echo "========================================"
  echo "  $label"
  echo "========================================"
  if "$@"; then
    PASSED+=("$label")
  else
    FAILED+=("$label")
    echo "  FAILED: $label"
  fi
}

# --- Parallel support ---
LOGDIR=""
PIDS=()
LABELS=()

run_par() {
  local label="$1"; shift
  local logfile="$LOGDIR/$(echo "$label" | tr ' ()/' '____').log"
  echo "  Starting: $label (log: $logfile)"
  "$@" >"$logfile" 2>&1 &
  PIDS+=($!)
  LABELS+=("$label")
}

collect_parallel() {
  local i
  for i in "${!PIDS[@]}"; do
    if wait "${PIDS[$i]}"; then
      PASSED+=("${LABELS[$i]}")
    else
      FAILED+=("${LABELS[$i]}")
    fi
  done
}

run() {
  if $PARALLEL; then
    run_par "$@"
  else
    run_seq "$@"
  fi
}

if $PARALLEL; then
  LOGDIR=$(mktemp -d)
  echo "Parallel mode: logs in $LOGDIR"
fi

# ============================================================
# Customize: Add your project's test suites below
# ============================================================

# Example: Backend (Python pytest)
# run "backend (SQLite)" uv run pytest -x -q
# run "backend (PostgreSQL)" env LLMHUB_DATABASE_URL=postgresql+asyncpg://user:pass@db/test uv run pytest -x -q

# Example: Frontend (vitest / jest)
# run "frontend" bash -c "cd frontend && npm test -- --run"

# Example: E2E (Playwright)
# run "E2E" bash -c "cd frontend && npx playwright test"

# Example: SDK
# run "SDK Python" bash -c "cd sdk/python && uv run pytest -x -q"
# run "SDK TypeScript" bash -c "cd sdk/typescript && npm test"

# ============================================================

# Wait for parallel jobs
if $PARALLEL; then
  collect_parallel
fi

# Summary
echo ""
echo "========================================"
echo "  Summary"
echo "========================================"
for p in "${PASSED[@]}"; do echo "  PASS: $p"; done
for f in "${FAILED[@]}"; do echo "  FAIL: $f"; done
if $PARALLEL && [ ${#FAILED[@]} -gt 0 ]; then
  for f in "${FAILED[@]}"; do
    logfile="$LOGDIR/$(echo "$f" | tr ' ()/' '____').log"
    if [ -f "$logfile" ]; then
      echo ""
      echo "--- $f (last 20 lines) ---"
      tail -20 "$logfile"
    fi
  done
fi
echo ""
echo "Passed: ${#PASSED[@]} / $(( ${#PASSED[@]} + ${#FAILED[@]} ))"

if [ ${#FAILED[@]} -gt 0 ]; then
  exit 1
fi
