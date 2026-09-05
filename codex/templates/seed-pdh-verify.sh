#!/usr/bin/env bash
# seed-pdh-verify.sh — Local-only seed hook for PDH verify / human-review.
#
# Copy to scripts/seed-pdh-verify.sh and edit for the project.
# Keep this script reproducible and local-only. Do not touch production or
# remote data from this hook.
set -euo pipefail

cat <<'MSG'
No PDH verify seed is configured for this project yet.

If UI/API verification needs fixtures, local database reset, dummy login
accounts, cookie helpers, or reproducible curl/browser commands, implement them
in scripts/seed-pdh-verify.sh.

If no seed is needed, keeping this no-op success is acceptable.
MSG
