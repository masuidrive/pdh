#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
cp -R integration/. "$test_root/"
mkdir -p "$test_root/pdh" "$test_root/tickets" "$test_root/tests/gate" "$test_root/scripts"
cp -R scripts checks skills "$test_root/pdh/"
cp tests/gate/test_pdh*.py "$test_root/tests/gate/"
ln -sf current-ticket "$test_root/current_ticket"
echo '/tmp/' > "$test_root/.gitignore"
printf '*/tmp/\ndone/*/tmp/\n' > "$test_root/tickets/.gitignore"
cd "$test_root"
export GIT_AUTHOR_NAME='PDH test' GIT_COMMITTER_NAME='PDH test'
export GIT_AUTHOR_EMAIL='pdh@example.invalid' GIT_COMMITTER_EMAIL='pdh@example.invalid'
unset CLAUDECODE  # Tests set the invoking engine explicitly when needed.
python3 -B -m unittest discover -s tests/gate -p 'test_pdh*.py'
