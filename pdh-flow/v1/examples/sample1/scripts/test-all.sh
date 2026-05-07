#!/usr/bin/env bash
set -euo pipefail

out="$(uv run calc "1+2")"
test "$out" = "3"

out="$(uv run calc "2*5+1")"
test "$out" = "11"

if uv run calc "2**10" >/tmp/sample1-calc.out 2>&1; then
  echo "expected unsupported expression to fail" >&2
  exit 1
fi
