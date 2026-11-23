#!/usr/bin/env bash
set -uo pipefail
failed=0
python3 "$PDH_TEST_ROOT/tests/scripts/pdh_review_contracts_test.py" || failed=1
python3 "$PDH_TEST_ROOT/tests/scripts/pdh_review_round2_test.py" || failed=1
python3 "$PDH_TEST_ROOT/tests/scripts/pdh_note_state_test.py" || failed=1
exit "$failed"
