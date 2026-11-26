#!/usr/bin/env bash
# Run the installed bot contracts in a disposable copy of its consuming layout.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
target=$(mktemp -d)
trap 'rm -rf "$target"' EXIT
cp -R "$root/github-bot/.github" "$target/.github"
cp "$root/github-bot/"{pdh-hooks.sh,_pdh.md,_github-issue.md} "$target/.github/coding-bot/"
cp "$root/shared/ticket.sh" "$target/"
mkdir -p "$target/tests"
cp -R "$root/tests/scripts" "$target/tests/"
# These scripts are already installed in projects running the stage-based bot.
# Use that release as the consumer fixture, while testing the bot from this checkout.
mkdir -p "$target/scripts"
for file in pdh-review-range.sh check-pdh-ticket.sh pdh-stage-checklist.sh; do
  git -C "$root" show "5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41:claude/templates/$file" > "$target/scripts/$file"
  chmod +x "$target/scripts/$file"
done
export PDH_TEST_ROOT="$target" PYTHONDONTWRITEBYTECODE=1
for test in "$target/tests/scripts/"*_test.sh; do
  (cd "$target" && bash "$test")
done
