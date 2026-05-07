#!/usr/bin/env bash
# Phase E verification: end-to-end engine run against v2 fixtures.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [ -f /home/masuidrive/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  source /home/masuidrive/.nvm/nvm.sh >/dev/null
fi

exec node scripts/test-engine-prototype.ts
