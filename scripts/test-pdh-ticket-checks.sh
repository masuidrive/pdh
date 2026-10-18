#!/usr/bin/env bash
# Compatibility entrypoint for the evidence suite; use the real installation fixture.
set -euo pipefail
case ${1:-} in claude|codex) ;; *) printf 'usage: test-pdh-ticket-checks.sh claude|codex\n' >&2; exit 2 ;; esac
root=$(cd "$(dirname "$0")/.." && pwd)
PDH_TEST_ENGINE_ONLY=$1 PDH_TEST_FILTER=pdh_ticket_evidence_checks_test.sh \
  bash "$root/scripts/test-distributed-scripts.sh"
