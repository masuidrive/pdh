#!/usr/bin/env bash
# Run the release's shared workflow, installer, and installed GitHub bot contracts.
set -euo pipefail
cd "$(dirname "$0")/.."
bash tools/test-shared-gate.sh
python3 -B -m unittest discover -s tests -p 'test_*.py'
bash tools/fast-checks.sh
FORCE_COLOR=3 bash tools/fast-checks.sh
python3 tools/check-links.py
bash tools/check-github-bot.sh
bash tools/test-pdh-hooks-awaiting.sh
bash tools/test-bot-attachments.sh
bash tools/test-distributed-scripts.sh
while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(git ls-files -z --cached --others --exclude-standard -- '*.sh')
echo 'test-all: all checks passed'
