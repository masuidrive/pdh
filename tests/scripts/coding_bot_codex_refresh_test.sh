#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
python3 "$ROOT_DIR/tests/scripts/coding_bot_codex_refresh_test.py"
