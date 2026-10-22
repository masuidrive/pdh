#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 tests/scripts/coding_bot_conflict_report_test.py
