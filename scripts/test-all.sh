#!/usr/bin/env bash
# Run the release's shared workflow, installer, and installed GitHub bot contracts.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/test-shared-gate.sh
python3 -B -m unittest discover -s tests -p 'test_*.py'
bash scripts/fast-checks.sh
FORCE_COLOR=3 bash scripts/fast-checks.sh
python3 scripts/check-links.py
bash scripts/check-github-bot.sh
bash scripts/test-pdh-hooks-awaiting.sh
bash scripts/test-bot-attachments.sh
bash scripts/test-distributed-scripts.sh
while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(git ls-files -z --cached --others --exclude-standard -- '*.sh')
echo 'test-all: all checks passed'
