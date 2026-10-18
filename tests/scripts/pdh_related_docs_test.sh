#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/bin" "$TEST_DIR/repo/docs" "$TEST_DIR/repo/specs" "$TEST_DIR/repo/tasks/current" "$TEST_DIR/repo/tasks/done/old" "$TEST_DIR/repo/tasks/done/other"
cat > "$TEST_DIR/bin/codex" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == *'model_reasoning_effort="low"'* && "$*" == *'danger-full-access'* && "$*" == *'--skip-git-repo-check'* ]]
prompt=$(cat)
printf '%s\n' "$prompt" >> "$CALL_LOG"
printf '\n---CALL---\n' >> "$CALL_LOG"
case "$prompt" in
  *'TASK: select-past-tickets'*)
    [[ "$prompt" == *'Old title'* && "$prompt" == *'old description'* ]]
    [[ "$prompt" != *'OLD_BODY_SECRET'* ]]
    printf 'tasks/done/old/ticket.md\n' ;;
  *'TASK: read-past-tickets'*)
    [[ "$prompt" == *'OLD_BODY_SECRET'* && "$prompt" != *'OTHER_BODY_SECRET'* ]]
    printf 'tasks/done/old/ticket.md:6・old quote・related reason\n' ;;
  *'TASK: read-documents'*)
    [[ "$prompt" == *'CURRENT_QUESTION'* ]]
    printf 'docs/guide.md:1・doc quote・related reason\n' ;;
  *) exit 3 ;;
esac
FAKE
chmod +x "$TEST_DIR/bin/codex"
printf '# Current\nCURRENT_QUESTION\n' > "$TEST_DIR/repo/tasks/current/ticket.md"
printf -- '---\ndescription: old description\n---\n# Old title\n\nOLD_BODY_SECRET\n' > "$TEST_DIR/repo/tasks/done/old/ticket.md"
printf -- '---\ndescription: other description\n---\n# Other title\nOTHER_BODY_SECRET\n' > "$TEST_DIR/repo/tasks/done/other/ticket.md"
for i in $(seq 1 80); do printf 'line %s full document text\n' "$i"; done > "$TEST_DIR/repo/docs/guide.md"
printf 'SPEC_END\n' > "$TEST_DIR/repo/specs/api.md"
cd "$TEST_DIR/repo"
export PATH="$TEST_DIR/bin:$PATH" CALL_LOG="$TEST_DIR/calls" PDH_RELATED_DOCS_BATCH_CHARS=700
printf 'review hash records\n' > tasks/current/related-docs.md
cp tasks/current/related-docs.md "$TEST_DIR/records"
bash "$ROOT_DIR/scripts/pdh-related-docs.sh" tasks/current
cmp "$TEST_DIR/records" tasks/current/related-docs.md
[[ -f tasks/current/related-docs-fulltext.md ]]
[[ $(grep -c 'TASK: read-documents' "$CALL_LOG") -gt 1 ]]
grep -q 'docs/guide.md:80: line 80 full document text' "$CALL_LOG"
grep -q 'specs/api.md:1: SPEC_END' "$CALL_LOG"
grep -q 'TASK: select-past-tickets' "$CALL_LOG"
grep -q 'TASK: read-past-tickets' "$CALL_LOG"
grep -q 'tasks/done/old/ticket.md:6' tasks/current/related-docs-fulltext.md
# Engine failure preserves the previous complete report.
printf '#!/usr/bin/env bash\nexit 9\n' > "$TEST_DIR/bin/codex"
cp tasks/current/related-docs-fulltext.md "$TEST_DIR/before"
if bash "$ROOT_DIR/scripts/pdh-related-docs.sh" tasks/current; then exit 1; fi
cmp "$TEST_DIR/before" tasks/current/related-docs-fulltext.md
mkdir -p "$TEST_DIR/claude-bin"
cat > "$TEST_DIR/claude-bin/claude" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == '-p --model opus' ]]
cat >/dev/null
printf 'fallback output\n'
FAKE
chmod +x "$TEST_DIR/claude-bin/claude"
PATH="$TEST_DIR/claude-bin:/usr/bin:/bin" bash "$ROOT_DIR/scripts/pdh-related-docs.sh" tasks/current docs
# The fallback is exercised without executing an installed codex.
grep -q 'fallback output' tasks/current/related-docs-fulltext.md
cmp "$TEST_DIR/records" tasks/current/related-docs.md
printf 'PASS: related docs batching, two-stage history, output and failure preservation\n'
