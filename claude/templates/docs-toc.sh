#!/usr/bin/env bash
# Usage: bash scripts/docs-toc.sh [--stage <PDH-stage>] [--all] [<dir>...]
# Defaults to docs/ and specs/. Requires Python 3 and PyYAML; uses no LLM.
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/docs-policy.py" toc "$@"
