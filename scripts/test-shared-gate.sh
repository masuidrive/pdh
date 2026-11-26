#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
cp -R shared/. "$test_root/"
mkdir -p "$test_root/scripts/tests"
cp tests/gate/test_pdh*.py "$test_root/scripts/tests/"
ln -sf current-ticket "$test_root/current_ticket"
echo '/tmp/' > "$test_root/.gitignore"
printf '*/tmp/\ndone/*/tmp/\n' > "$test_root/tickets/.gitignore"
cd "$test_root"
export GIT_AUTHOR_NAME='PDH test' GIT_COMMITTER_NAME='PDH test'
export GIT_AUTHOR_EMAIL='pdh@example.invalid' GIT_COMMITTER_EMAIL='pdh@example.invalid'
python3 -B -m unittest discover -s scripts/tests -p 'test_pdh*.py'
