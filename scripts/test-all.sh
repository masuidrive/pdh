#!/usr/bin/env bash
# test-all.sh — checks for the PDH repository itself.
#
# This repo ships text, not a running product, so "tests" here mean: the
# distribution set is internally consistent, and the shipped shell scripts parse.
# Real verification (does a consuming project still work after this change?) is
# not automatable here — see CLAUDE.md「テスト・検証」.
#
# This is NOT the distributed template; that is templates/test-all.sh.
set -uo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

failed=0
run() {
  printf '\n=== %s ===\n' "$1"
  shift
  if ! "$@"; then
    failed=1
  fi
}

run "fast-checks" bash scripts/fast-checks.sh
run "distribution consistency" bash scripts/check-distribution.sh

printf '\n=== shell syntax (shipped scripts) ===\n'
syntax_failed=0
while IFS= read -r script; do
  if ! bash -n "$script"; then
    syntax_failed=1
  fi
done < <(git ls-files -- '*.sh')
if [[ "$syntax_failed" -ne 0 ]]; then
  failed=1
else
  printf 'shell syntax: all *.sh parse\n'
fi

printf '\n'
if [[ "$failed" -ne 0 ]]; then
  printf 'test-all: FAILED\n' >&2
  exit 1
fi
printf 'test-all: all checks passed\n'
