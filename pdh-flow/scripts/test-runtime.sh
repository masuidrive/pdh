#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/pdh-flow-runtime-tests"
rm -rf "$TMP_ROOT"
mkdir -p "$TMP_ROOT"

seed_repo() {
  local name="$1"
  local repo="$TMP_ROOT/$name"
  cp -R "$ROOT/examples/sample1" "$repo"
  cd "$repo"
  git init >/dev/null
  git add .
  git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -m "Seed runtime fixture" >/dev/null
  ./ticket.sh start runtime-test >/dev/null
  git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -am "ticket.sh start runtime-test" >/dev/null
  printf '%s\n' "$repo"
}

advance_to_provider_step() {
  local repo="$1"
  local run_id
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant light --start-step PD-C-5 | sed -n '1p')"
  node "$ROOT/src/cli.mjs" run-next --repo "$repo" >"$TMP_ROOT/$run_id.gate.json"
  node "$ROOT/src/cli.mjs" approve --repo "$repo" --step PD-C-5 --reason ok >/dev/null
  node "$ROOT/src/cli.mjs" run-next --repo "$repo" --stop-after-step >"$TMP_ROOT/$run_id.stop.txt"
  printf '%s\n' "$run_id"
}

write_fake_codex_fail() {
  local path="$TMP_ROOT/fake-codex-fail.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
cat >/dev/null || true
printf '%s\n' '{"type":"error","message":"planned provider failure"}'
exit 9
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_codex_success() {
  local path="$TMP_ROOT/fake-codex-success.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
if [ -n "${FAKE_CODEX_ARGS_FILE:-}" ]; then
  printf '%s\n' "$@" > "$FAKE_CODEX_ARGS_FILE"
elif [ -n "${FAKE_ARGS_FILE:-}" ]; then
  printf '%s\n' "$@" > "$FAKE_ARGS_FILE"
fi
prompt="$(cat || true)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p' | head -1)"
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p' | head -1)"
repair_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*repair.json\)`\.$/\1/p' | head -1)"
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'JSON'
{
  "summary": ["fake provider summary"],
  "risks": ["fake provider risk"],
  "ready_when": ["fake provider ready condition"],
  "notes": "fake notes"
}
JSON
fi
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  cat >"$review_path" <<'JSON'
{
  "status": "No Critical/Major",
  "summary": "codex reviewer found no blocking issues",
  "findings": [],
  "notes": "codex review notes"
}
JSON
fi
if [ -n "$repair_path" ]; then
  mkdir -p "$(dirname "$repair_path")"
  cat >"$repair_path" <<'JSON'
{
  "summary": "fake repair applied",
  "verification": ["fake repair verification"],
  "remaining_risks": [],
  "notes": "fake repair notes"
}
JSON
fi
printf '%s\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\n' '{"type":"turn.completed","final_message":"fake success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_codex_hang_then_resume() {
  local path="$TMP_ROOT/fake-codex-hang-then-resume.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
count_file="${FAKE_COUNT_FILE:?}"
args_dir="${FAKE_ARGS_DIR:?}"
mkdir -p "$args_dir"
count=0
if [ -f "$count_file" ]; then
  count="$(cat "$count_file")"
fi
count="$((count + 1))"
printf '%s\n' "$count" >"$count_file"
printf '%s\n' "$@" >"$args_dir/args-$count.txt"
cat >/dev/null || true
printf '%s\n' '{"type":"thread.started","thread_id":"fake-resume-thread"}'
if [ "$count" -eq 1 ]; then
  sleep 5
  exit 0
fi
printf '%s\n' '{"type":"turn.completed","final_message":"fake resumed success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_claude_success() {
  local path="$TMP_ROOT/fake-claude-success.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
if [ -n "${FAKE_CLAUDE_ARGS_FILE:-}" ]; then
  printf '%s\n' "$@" > "$FAKE_CLAUDE_ARGS_FILE"
elif [ -n "${FAKE_ARGS_FILE:-}" ]; then
  printf '%s\n' "$@" > "$FAKE_ARGS_FILE"
fi
prompt=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-p" ]; then
    prompt="$2"
    shift 2
    continue
  fi
  shift
done
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p' | head -1)"
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p' | head -1)"
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'JSON'
{
  "summary": ["fake review summary"],
  "risks": [],
  "ready_when": ["fake review ready condition"],
  "notes": "fake review notes",
  "judgement": {
    "kind": "plan_review",
    "status": "No Critical/Major",
    "summary": "fake review accepted"
  }
}
JSON
fi
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  cat >"$review_path" <<'JSON'
{
  "status": "No Critical/Major",
  "summary": "claude reviewer found no blocking issues",
  "findings": [],
  "notes": "claude review notes"
}
JSON
fi
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"assistant","message":{"content":"fake review success"}}'
printf '%s\n' '{"type":"result","subtype":"success","result":"fake review success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_claude_review_loop() {
  local path="$TMP_ROOT/fake-claude-review-loop.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
count_file="${FAKE_REVIEW_COUNT_FILE:?}"
prompt=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-p" ]; then
    prompt="$2"
    shift 2
    continue
  fi
  shift
done
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p' | head -1)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p' | head -1)"
count=0
if [ -f "$count_file" ]; then
  count="$(cat "$count_file")"
fi
count="$((count + 1))"
printf '%s\n' "$count" >"$count_file"
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  if [ "$count" -le 3 ]; then
    cat >"$review_path" <<'JSON'
{
  "status": "Major",
  "summary": "claude reviewer still sees a blocking issue",
  "findings": [
    {
      "severity": "major",
      "title": "Blocking review issue",
      "evidence": "fake round-one blocker",
      "recommendation": "apply a repair and rerun the same reviewer role"
    }
  ],
  "notes": "fake blocker"
}
JSON
  else
    cat >"$review_path" <<'JSON'
{
  "status": "No Critical/Major",
  "summary": "claude reviewer no longer sees blocking issues",
  "findings": [],
  "notes": "fake pass"
}
JSON
  fi
fi
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  # Aggregator: worst-status-wins parsed from prompt's reviewer block
  worst="No Critical/Major"
  while IFS= read -r line; do
    case "$line" in
      Critical) worst="Critical"; break ;;
      Major) [ "$worst" != "Critical" ] && worst="Major" ;;
    esac
  done < <(printf '%s\n' "$prompt" | sed -n 's/.*"status": "\(.*\)".*/\1/p')
  cat >"$ui_path" <<JSON
{
  "summary": ["aggregator consensus: $worst"],
  "risks": [],
  "ready_when": [],
  "notes": "aggregator round summary",
  "judgement": {
    "kind": "plan_review",
    "status": "$worst",
    "summary": "aggregator says $worst"
  }
}
JSON
fi
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"assistant","message":{"content":"fake review loop run"}}'
printf '%s\n' '{"type":"result","subtype":"success","result":"fake review loop run"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_claude_purpose_validation() {
  local path="$TMP_ROOT/fake-claude-purpose-validation.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-p" ]; then
    prompt="$2"
    shift 2
    continue
  fi
  shift
done
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p' | head -1)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p' | head -1)"
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  cat >"$review_path" <<'JSON'
{
  "status": "No Unverified",
  "summary": "every Product AC has concrete evidence and no close blocker remains",
  "findings": [],
  "notes": "purpose validation passed"
}
JSON
fi
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'JSON'
{
  "summary": ["aggregator confirmed all Product ACs are verified"],
  "risks": [],
  "ready_when": ["aggregator concurs with reviewers"],
  "notes": "aggregator purpose validation passed",
  "judgement": {
    "kind": "purpose_validation",
    "status": "No Unverified",
    "summary": "aggregator confirms No Unverified"
  }
}
JSON
fi
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"assistant","message":{"content":"fake PD-C-8 review success"}}'
printf '%s\n' '{"type":"result","subtype":"success","result":"fake PD-C-8 review success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_codex_guard_repair() {
  local path="$TMP_ROOT/fake-codex-guard-repair.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt="$(cat || true)"
repair_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*repair.json\)`\.$/\1/p' | head -1)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p' | head -1)"
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'JSON'
{
  "summary": ["aggregator confirmed AC table is complete"],
  "risks": [],
  "ready_when": ["guard-repair completed and AC table is populated"],
  "notes": "aggregator final verification passed",
  "judgement": {
    "kind": "final_verification",
    "status": "Ready",
    "summary": "aggregator confirms Ready"
  }
}
JSON
fi
if [ -n "$repair_path" ]; then
  node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = "current-note.md";
const replacementLines = [
  "## AC 裏取り結果",
  "",
  "| item | classification | status | evidence | deferral ticket |",
  "| --- | --- | --- | --- | --- |",
  "| addition success case | functional | verified | scripts/test-all.sh covers the baseline addition example from current-ticket.md | - |",
  "| parentheses success case | functional | verified | scripts/test-all.sh covers committed parentheses success paths | - |",
  "| malformed parentheses failure case | edge-case | verified | scripts/test-all.sh asserts exit status 2 and `error:` prefix for malformed parentheses | - |",
  ""
];
const text = readFileSync(path, "utf8");
const lines = text.split(/\r?\n/);
const start = lines.findIndex((line) => line.trim() === "## AC 裏取り結果");
if (start >= 0) {
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      end = index;
      break;
    }
  }
  lines.splice(start, end - start, ...replacementLines);
  writeFileSync(path, lines.join("\n"));
} else {
  writeFileSync(path, `${text.trimEnd()}\n\n${replacementLines.join("\n")}\n`);
}
NODE
  mkdir -p "$(dirname "$repair_path")"
  cat >"$repair_path" <<'JSON'
{
  "summary": "added the AC verification table required by the guard",
  "verification": ["checked current-note.md for AC 裏取り結果 rows"],
  "remaining_risks": [],
  "notes": "guard repair"
}
JSON
fi
printf '%s\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\n' '{"type":"turn.completed","final_message":"fake guard repair success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

test_frontmatter_run() {
  local repo
  repo="$(seed_repo frontmatter)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >"$TMP_ROOT/frontmatter.run.txt"
  grep -q "^run-" "$TMP_ROOT/frontmatter.run.txt"
  grep -q '"current_step": "PD-C-3"' "$repo/.pdh-flow/runtime.json"
  grep -q '"run_id": "run-' "$repo/.pdh-flow/runtime.json"
}

test_nested_section_guard() {
  local repo
  repo="$(seed_repo nested-section-guard)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node --input-type=module -e "import { replaceNoteSection } from '$ROOT/src/note-state.mjs'; replaceNoteSection('$repo', 'PD-C-3. 計画', '### 実装方針\\n\\n- nested plan detail\\n\\n### テスト計画\\n\\n- nested verification detail');"
  node --input-type=module -e "import { evaluateGuard } from '$ROOT/src/guards.mjs'; const result = evaluateGuard({ id: 'plan-recorded', type: 'note_section_updated', path: 'current-note.md', section: 'PD-C-3. 計画' }, { repoPath: '$repo' }); console.log(JSON.stringify(result));" >"$TMP_ROOT/nested-section-guard.json"
  grep -q '"status":"passed"' "$TMP_ROOT/nested-section-guard.json"
}

test_recorded_step_commit_guard() {
  local repo before
  repo="$(seed_repo recorded-step-commit)"
  before="$(git -C "$repo" rev-parse HEAD)"
  printf '\nrecorded commit test\n' >>"$repo/current-note.md"
  git -C "$repo" add current-note.md
  git -C "$repo" -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -m "Unrelated commit subject" >/dev/null
  node --input-type=module -e "import { writeStepCommitRecord, loadStepCommitRecord } from '$ROOT/src/step-commit.mjs'; const record = writeStepCommitRecord({ repoPath: '$repo', stateDir: '$repo/.pdh-flow', runId: 'run-test', stepId: 'PD-C-2', beforeCommit: '$before' }); if (!record?.commit) throw new Error('step commit record missing'); const loaded = loadStepCommitRecord({ stateDir: '$repo/.pdh-flow', runId: 'run-test', stepId: 'PD-C-2' }); if (!loaded?.commit) throw new Error('step commit record not reloadable');"
  node --input-type=module -e "import { evaluateGuard } from '$ROOT/src/guards.mjs'; import { loadStepCommitRecord } from '$ROOT/src/step-commit.mjs'; const stepCommit = loadStepCommitRecord({ stateDir: '$repo/.pdh-flow', runId: 'run-test', stepId: 'PD-C-2' }); const result = evaluateGuard({ id: 'step-commit', type: 'git_commit_exists', pattern: '^\\\\[PD-C-2\\\\]', stepCommit }, { repoPath: '$repo' }); console.log(JSON.stringify(result));" >"$TMP_ROOT/recorded-step-commit.json"
  grep -q '"status":"passed"' "$TMP_ROOT/recorded-step-commit.json"
}

test_reviewer_placeholder_sanitization() {
  local repo
  repo="$(seed_repo reviewer-placeholder-sanitization)"
  mkdir -p "$repo/.pdh-flow/runs/run-test/steps/PD-C-7/reviewers/code_reviewer-1"
  cat >"$repo/.pdh-flow/runs/run-test/steps/PD-C-7/reviewers/code_reviewer-1/review.json" <<'JSON'
{
  "status": "No Critical/Major",
  "summary": "looks fine",
  "findings": [
    {
      "severity": "note",
      "title": "[object Object]",
      "evidence": "",
      "recommendation": ""
    },
    {
      "severity": "note",
      "title": "Nested metadata",
      "evidence": {
        "command": "uv run calc \"2-5\"",
        "observed": -3
      },
      "recommendation": ""
    }
  ],
  "notes": {
    "lines": ["one", "two"]
  }
}
JSON
  node --input-type=module -e "import { loadReviewerOutput } from '$ROOT/src/review-runtime.mjs'; const output = loadReviewerOutput({ stateDir: '$repo/.pdh-flow', runId: 'run-test', stepId: 'PD-C-7', reviewerId: 'code_reviewer-1' }); if (output.findings.length !== 1) throw new Error('placeholder finding should be dropped'); if (!output.findings[0].evidence.includes('uv run calc')) throw new Error('structured evidence not preserved: ' + output.findings[0].evidence); if (!output.notes.includes('one') || !output.notes.includes('two')) throw new Error('structured notes not rendered: ' + output.notes);"
}

test_replace_note_section_with_nested_headings() {
  local repo
  repo="$(seed_repo replace-note-section-nested)"
  node --input-type=module -e "import { replaceNoteSection, extractSection } from '$ROOT/src/note-state.mjs'; import { readFileSync } from 'node:fs'; replaceNoteSection('$repo', 'PD-C-7. 品質検証結果', 'Updated: now\\n\\n### Findings\\n\\n- clean finding\\n\\n### Review Rounds\\n\\n#### Round 1\\n\\n- ok'); const text = readFileSync('$repo/current-note.md', 'utf8'); const section = extractSection(text, 'PD-C-7. 品質検証結果'); if (!section.includes('### Findings')) throw new Error('nested heading missing'); if (!section.includes('#### Round 1')) throw new Error('nested child heading missing'); if (!text.includes('## PD-C-8. 目的妥当性確認')) throw new Error('next top-level section removed');"
}

test_prompt_context() {
  local repo prompt_path
  repo="$(seed_repo prompt-context)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  prompt_path="$(node "$ROOT/src/cli.mjs" prompt --repo "$repo")"
  grep -q "^# pdh-flow Step Prompt" "$prompt_path"
  grep -q "^## Run Context" "$prompt_path"
  grep -q "^- Current step: PD-C-3" "$prompt_path"
  grep -q "^# あなたの位置づけ" "$prompt_path"
  grep -q "^# 用語" "$prompt_path"
  grep -q "ui-output.json" "$prompt_path"
  grep -q "node src/provider-cli.mjs ask --repo . --message" "$prompt_path"
  grep -q "^# PD-C-3. 計画" "$prompt_path"
  if grep -q "^## current-ticket.md" "$prompt_path"; then
    echo "prompt should not inline current-ticket.md" >&2
    exit 1
  fi
}

test_stop_after_step() {
  local repo run_id
  repo="$(seed_repo stop-after-step)"
  run_id="$(advance_to_provider_step "$repo")"
  grep -q "Stopped After Step: PD-C-5 -> PD-C-6" "$TMP_ROOT/$run_id.stop.txt"
  grep -q '"current_step": "PD-C-6"' "$repo/.pdh-flow/runtime.json"
  node "$ROOT/src/cli.mjs" status --repo "$repo" >"$TMP_ROOT/$run_id.status.txt"
  grep -q "Status: running" "$TMP_ROOT/$run_id.status.txt"
  grep -q "Current Step: PD-C-6 実装" "$TMP_ROOT/$run_id.status.txt"
}

test_blocked_run() {
  local repo run_id
  repo="$(seed_repo blocked)"
  run_id="$(advance_to_provider_step "$repo")"
  node "$ROOT/src/cli.mjs" run-next --repo "$repo" --manual-provider >"$TMP_ROOT/$run_id.blocked.txt"
  grep -q "provider_step_requires_execution" "$TMP_ROOT/$run_id.blocked.txt"
  node "$ROOT/src/cli.mjs" status --repo "$repo" >"$TMP_ROOT/$run_id.blocked-status.txt"
  grep -q "Status: blocked" "$TMP_ROOT/$run_id.blocked-status.txt"
}

test_auto_provider_run() {
  local repo run_id fake args
  repo="$(seed_repo auto-provider)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_success)"
  args="$TMP_ROOT/$run_id.auto-provider-args.txt"
  CODEX_BIN="$fake" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli.mjs" run-next --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.auto-provider.txt" || true
  test -f "$args"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/ui-output.json"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/ui-runtime.json"
  grep -q "guard_failed" "$TMP_ROOT/$run_id.auto-provider.txt"
}

test_auto_review_judgement() {
  local repo run_id fake_claude fake_codex args
  repo="$(seed_repo auto-review-judgement)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  fake_claude="$(write_fake_claude_success)"
  fake_codex="$(write_fake_codex_success)"
  args="$TMP_ROOT/$run_id.review-claude-args.txt"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" FAKE_CLAUDE_ARGS_FILE="$args" \
    node "$ROOT/src/cli.mjs" run-provider --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.review.txt"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/ui-output.json"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/judgements/plan_review.json"
  grep -q '"status": "No Critical/Major"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/judgements/plan_review.json"
  grep -q "Devil's Advocate" "$repo/current-note.md"
  grep -q "codex reviewer found no blocking issues" "$repo/current-note.md"
  grep -q -- "--disable-slash-commands" "$args"
  grep -q -- "--setting-sources" "$args"
  grep -q -- "user" "$args"
  if grep -q -- "--bare" "$args"; then
    echo "reviewer claude should not use --bare" >&2
    exit 1
  fi
}

test_review_loop_auto_repair() {
  local repo run_id fake_claude fake_codex count_file
  repo="$(seed_repo review-loop)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  fake_claude="$(write_fake_claude_review_loop)"
  fake_codex="$(write_fake_codex_success)"
  count_file="$TMP_ROOT/$run_id.review-count.txt"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" FAKE_REVIEW_COUNT_FILE="$count_file" \
    node "$ROOT/src/cli.mjs" run-provider --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.review-loop.txt"
  grep -q "completed" "$TMP_ROOT/$run_id.review-loop.txt"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-1/aggregate.json"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-1/repair.json"
  find "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-1/reviewers" -name review.json | grep -q .
  find "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-2/reviewers" -name review.json | grep -q .
  grep -R -q "Prior blocking findings from this reviewer role" "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-2/reviewers"
  grep -q "#### Round 1" "$repo/current-note.md"
  grep -q "Repair summary: fake repair applied" "$repo/current-note.md"
  grep -q '"status": "No Critical/Major"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/judgements/plan_review.json"
}

test_review_guard_auto_repair() {
  local repo run_id fake_claude fake_codex
  repo="$(seed_repo review-guard-auto-repair)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-8 | sed -n '1p')"
  fake_claude="$(write_fake_claude_purpose_validation)"
  fake_codex="$(write_fake_codex_guard_repair)"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" \
    node "$ROOT/src/cli.mjs" run-next --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.review-guard-repair.txt"
  grep -q "PD-C-10" "$TMP_ROOT/$run_id.review-guard-repair.txt"
  grep -q "## AC 裏取り結果" "$repo/current-note.md"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-8/review-rounds/round-2/repair.json"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-8/step-commit.json"
  node "$ROOT/src/cli.mjs" status --repo "$repo" >"$TMP_ROOT/$run_id.review-guard-status.txt"
  grep -q "Current Step: PD-C-10" "$TMP_ROOT/$run_id.review-guard-status.txt"
}

test_failed_run() {
  local repo run_id fake summary_path
  repo="$(seed_repo failed)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_fail)"
  CODEX_BIN="$fake" node "$ROOT/src/cli.mjs" run-provider --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.provider.txt" || true
  grep -q "failed" "$TMP_ROOT/$run_id.provider.txt"
  grep -q "Failure Summary:" "$TMP_ROOT/$run_id.provider.txt"
  summary_path="$(sed -n 's/^Failure Summary: //p' "$TMP_ROOT/$run_id.provider.txt")"
  test -f "$summary_path"
  grep -q "Exit code: 9" "$summary_path"
  node "$ROOT/src/cli.mjs" status --repo "$repo" >"$TMP_ROOT/$run_id.failed-status.txt"
  grep -q "Status: failed" "$TMP_ROOT/$run_id.failed-status.txt"
}

test_auto_resume_after_idle_timeout() {
  local repo run_id fake args_dir count_file
  repo="$(seed_repo auto-resume-idle)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_hang_then_resume)"
  args_dir="$TMP_ROOT/$run_id.auto-resume-args"
  count_file="$TMP_ROOT/$run_id.auto-resume-count.txt"
  CODEX_BIN="$fake" FAKE_ARGS_DIR="$args_dir" FAKE_COUNT_FILE="$count_file" \
    node "$ROOT/src/cli.mjs" run-provider --repo "$repo" --max-attempts 2 --retry-backoff-ms 0 --timeout-ms 5000 --idle-timeout-ms 200 \
    >"$TMP_ROOT/$run_id.auto-resume.txt"
  grep -q "completed" "$TMP_ROOT/$run_id.auto-resume.txt"
  grep -q "resume" "$args_dir/args-2.txt"
  grep -q "fake-resume-thread" "$args_dir/args-2.txt"
  grep -q '"status": "failed"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/attempt-1/result.json"
  grep -q '"sessionId": "fake-resume-thread"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/attempt-1/result.json"
  grep -q '"timeoutKind": "idle"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/attempt-1/result.json"
}

test_stale_normalization_respects_step_finished() {
  local repo run_id
  repo="$(seed_repo stale-normalization-finished)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-8 | sed -n '1p')"
  node --input-type=module -e "import { appendProgressEvent, defaultStateDir, loadRuntime, updateRun, writeAttemptResult, latestAttemptResult } from '$ROOT/src/runtime-state.mjs'; const repo = '$repo'; const runId = '$run_id'; const stateDir = defaultStateDir(repo); writeAttemptResult({ stateDir, runId, stepId: 'PD-C-8', attempt: 1, result: { provider: 'claude', status: 'running', pid: null, exitCode: null, finalMessage: null, stderr: '', timedOut: false, timeoutKind: null, signal: null, sessionId: null, resumeToken: null, rawLogPath: 'raw', startedAt: '2026-04-27T00:00:00.000Z', lastEventAt: '2026-04-27T00:00:00.000Z' } }); appendProgressEvent({ repoPath: repo, runId, stepId: 'PD-C-8', attempt: 1, type: 'step_finished', provider: 'runtime', message: 'PD-C-8 completed', payload: { finalMessage: 'done' } }); updateRun(repo, { status: 'running', current_step_id: 'PD-C-8' }); loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); const runtime = loadRuntime(repo); const latest = latestAttemptResult({ stateDir, runId, stepId: 'PD-C-8', provider: null }); if (runtime.run.status !== 'running') throw new Error('run status should stay running'); if (latest.status !== 'completed') throw new Error('attempt should be normalized to completed');"
}

test_supervisor_running_blocks_stale_normalization() {
  local repo run_id
  repo="$(seed_repo supervisor-running)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-2 | sed -n '1p')"
  node --input-type=module -e "import { defaultStateDir, loadRuntime, startRunSupervisor } from '$ROOT/src/runtime-state.mjs'; const repo = '$repo'; const stateDir = defaultStateDir(repo); startRunSupervisor({ stateDir, repoPath: repo, runId: '$run_id', stepId: 'PD-C-2', command: 'run-next', pid: process.pid }); const runtime = loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); if (runtime.run.status !== 'running') throw new Error('supervisor-backed run should stay running'); if (runtime.supervisor?.status !== 'running') throw new Error('supervisor should stay running');"
}

test_supervisor_stale_without_attempt_fails_run() {
  local repo run_id
  repo="$(seed_repo supervisor-stale)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-2 | sed -n '1p')"
  node --input-type=module -e "import { defaultStateDir, loadRuntime, startRunSupervisor } from '$ROOT/src/runtime-state.mjs'; const repo = '$repo'; const stateDir = defaultStateDir(repo); startRunSupervisor({ stateDir, repoPath: repo, runId: '$run_id', stepId: 'PD-C-2', command: 'run-next', pid: 999999 }); const runtime = loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); if (runtime.run.status !== 'failed') throw new Error('stale supervisor should fail the run'); if (runtime.supervisor?.status !== 'stale') throw new Error('supervisor should be stale');"
}

test_run_refuses_active_run() {
  local repo
  repo="$(seed_repo run-refuses-active)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  if node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >"$TMP_ROOT/refuse.out" 2>"$TMP_ROOT/refuse.err"; then
    echo "second run should fail without --force-reset" >&2
    exit 1
  fi
  grep -q "Active run already exists" "$TMP_ROOT/refuse.err"
  grep -q "pdh-flow resume" "$TMP_ROOT/refuse.err"
  grep -q "pdh-flow stop" "$TMP_ROOT/refuse.err"
}

test_force_reset_creates_archive_tag() {
  local repo
  repo="$(seed_repo force-reset-archive)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-2 --force-reset >"$TMP_ROOT/force-reset.out"
  grep -q "Archived prior run state under git tag" "$TMP_ROOT/force-reset.out"
  git -C "$repo" tag --list | grep -q "^pdh-flow-archive/runtime-test/.*-PD-C-3$"
}

test_step_recovery_tag() {
  local repo
  repo="$(seed_repo step-recovery-tag)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  printf '\nstep tag commit body\n' >>"$repo/current-note.md"
  (
    cd "$repo"
    git add current-note.md tickets/runtime-test-note.md 2>/dev/null || git add current-note.md
    node "$ROOT/src/cli.mjs" commit-step --repo "$repo" --step PD-C-3 --message "Plan recorded" --ticket runtime-test >/dev/null
  )
  git -C "$repo" tag --list | grep -q "^pdh-flow/runtime-test/PD-C-3$"
}

test_pdh_stop_marks_user_stopped() {
  local repo
  repo="$(seed_repo pdh-stop)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-2 >/dev/null
  node --input-type=module -e "import { defaultStateDir, startRunSupervisor } from '$ROOT/src/runtime-state.mjs'; startRunSupervisor({ stateDir: defaultStateDir('$repo'), repoPath: '$repo', runId: 'placeholder', stepId: 'PD-C-2', command: 'run-next', pid: process.pid });"
  node "$ROOT/src/cli.mjs" stop --repo "$repo" --reason "user requested" >"$TMP_ROOT/pdh-stop.json"
  grep -q '"status": "stopped"' "$TMP_ROOT/pdh-stop.json"
  grep -q '"staleReason": "user_stopped"' "$repo/.pdh-flow/runtime-supervisor.json"
  grep -q '"status": "failed"' "$repo/.pdh-flow/runtime.json"
}

test_resume_after_process_lost() {
  local repo run_id
  repo="$(seed_repo resume-after-loss)"
  run_id="$(advance_to_provider_step "$repo")"
  node --input-type=module -e "import { defaultStateDir, startRunSupervisor, loadRuntime } from '$ROOT/src/runtime-state.mjs'; const stateDir = defaultStateDir('$repo'); startRunSupervisor({ stateDir, repoPath: '$repo', runId: '$run_id', stepId: 'PD-C-6', command: 'run-next', pid: 999999 }); loadRuntime('$repo', { normalizeStaleRunning: true, staleAfterMs: 0 });"
  grep -q '"status": "failed"' "$repo/.pdh-flow/runtime.json"
  grep -q '"status": "stale"' "$repo/.pdh-flow/runtime-supervisor.json"
  local fake
  fake="$(write_fake_codex_success)"
  CODEX_BIN="$fake" node "$ROOT/src/cli.mjs" resume --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.resume-loss.txt" || true
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/ui-output.json"
}

test_recover_from_tags_rebuilds_runtime() {
  local repo
  repo="$(seed_repo recover-from-tags)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  printf '\nrecover seed\n' >>"$repo/current-note.md"
  (
    cd "$repo"
    git add current-note.md tickets/runtime-test-note.md 2>/dev/null || git add current-note.md
    node "$ROOT/src/cli.mjs" commit-step --repo "$repo" --step PD-C-3 --message "Plan" --ticket runtime-test >/dev/null
  )
  git -C "$repo" tag --list | grep -q "^pdh-flow/runtime-test/PD-C-3$"
  rm -rf "$repo/.pdh-flow"
  node "$ROOT/src/cli.mjs" recover --repo "$repo" >"$TMP_ROOT/recover.json"
  grep -q '"status": "recovered"' "$TMP_ROOT/recover.json"
  grep -q '"stepId": "PD-C-3"' "$TMP_ROOT/recover.json"
  grep -q '"current_step": "PD-C-3"' "$repo/.pdh-flow/runtime.json"
  grep -q '"staleReason": "recovered_from_tags"' "$repo/.pdh-flow/runtime-supervisor.json"
}

test_resumed_run() {
  local repo run_id fake first_args second_args
  repo="$(seed_repo resumed)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_success)"
  first_args="$TMP_ROOT/$run_id.first-args.txt"
  second_args="$TMP_ROOT/$run_id.second-args.txt"
  CODEX_BIN="$fake" FAKE_ARGS_FILE="$first_args" node "$ROOT/src/cli.mjs" run-provider --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >/dev/null
  CODEX_BIN="$fake" FAKE_ARGS_FILE="$second_args" node "$ROOT/src/cli.mjs" resume --repo "$repo" --max-attempts 2 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.resume.txt"
  grep -q "completed" "$TMP_ROOT/$run_id.resume.txt"
  grep -q "resume" "$second_args"
  grep -q "fake-thread" "$second_args"
}

test_interrupted_run() {
  local repo run_id fake args prompt_path
  repo="$(seed_repo interrupted)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_success)"
  args="$TMP_ROOT/$run_id.interrupted-args.txt"

  node "$ROOT/src/provider-cli.mjs" ask --repo "$repo" --message "Should multiplication use integer arithmetic?" >"$TMP_ROOT/$run_id.interrupt.txt"
  grep -q "interrupted" "$TMP_ROOT/$run_id.interrupt.txt"

  node "$ROOT/src/cli.mjs" status --repo "$repo" >"$TMP_ROOT/$run_id.interrupted-status.txt"
  grep -q "Status: interrupted" "$TMP_ROOT/$run_id.interrupted-status.txt"

  if CODEX_BIN="$fake" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli.mjs" run-provider --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.open-interrupt-provider.txt" 2>&1; then
    echo "run-provider should block while an interruption is open" >&2
    exit 1
  fi
  grep -q "needs_interrupt_answer" "$TMP_ROOT/$run_id.open-interrupt-provider.txt"
  test ! -f "$args"

  node "$ROOT/src/cli.mjs" answer --repo "$repo" --message "Yes. Preserve integer arithmetic for this fixture." >"$TMP_ROOT/$run_id.answer.txt"
  grep -q "answered" "$TMP_ROOT/$run_id.answer.txt"

  prompt_path="$(node "$ROOT/src/cli.mjs" prompt --repo "$repo")"
  grep -q "Should multiplication use integer arithmetic" "$prompt_path"
  grep -q "Preserve integer arithmetic" "$prompt_path"

  CODEX_BIN="$fake" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli.mjs" run-provider --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.answered-provider.txt"
  grep -q "completed" "$TMP_ROOT/$run_id.answered-provider.txt"
}

test_assist_gate_flow() {
  local repo run_id manifest prompt_path signal_path
  repo="$(seed_repo assist-gate)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-5 | sed -n '1p')"
  node "$ROOT/src/cli.mjs" run-next --repo "$repo" >"$TMP_ROOT/$run_id.assist-gate-open.json"
  node "$ROOT/src/cli.mjs" assist-open --repo "$repo" --step PD-C-5 --prepare-only >"$TMP_ROOT/$run_id.assist-open.json"
  manifest="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!data.allowedSignals.includes('recommend-approve')) throw new Error('recommend-approve missing'); if(!data.allowedSignals.includes('recommend-rerun-from')) throw new Error('recommend-rerun-from missing'); if(!data.command.join(' ').includes('--setting-sources')) throw new Error('assist command missing settings hardening'); console.log(data.manifestPath);" "$TMP_ROOT/$run_id.assist-open.json")"
  prompt_path="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(data.promptPath);" "$TMP_ROOT/$run_id.assist-open.json")"
  test -f "$manifest"
  test -f "$prompt_path"
  grep -q "Allowed signals now: recommend-approve, recommend-request-changes, recommend-reject, recommend-rerun-from" "$prompt_path"
  grep -q "## What This Stop Means" "$prompt_path"
  grep -q "## Checkpoints For This Step" "$prompt_path"
  grep -q "If plan or ticket intent changed during the gate, prefer a rerun recommendation instead of approve." "$prompt_path"
  grep -q "Do not run ticket.sh" "$repo/.pdh-flow/runs/$run_id/steps/PD-C-5/assist/system-prompt.txt"
  test -x "$repo/.pdh-flow/bin/assist-signal"
  test -x "$repo/.pdh-flow/bin/assist-test"
  node "$ROOT/src/cli.mjs" assist-signal --repo "$repo" --step PD-C-5 --signal recommend-approve --reason ok --no-run-next >"$TMP_ROOT/$run_id.assist-signal.json"
  grep -q '"action": "approve"' "$TMP_ROOT/$run_id.assist-signal.json"
  signal_path="$repo/.pdh-flow/runs/$run_id/steps/PD-C-5/assist/latest-signal.json"
  test -f "$signal_path"
  grep -q '"signal": "recommend-approve"' "$signal_path"
  "$repo/.pdh-flow/bin/assist-signal" --step PD-C-5 --signal recommend-rerun-from --target-step PD-C-4 --reason "wrapper path check" --no-run-next >"$TMP_ROOT/$run_id.wrapper-rerun.json"
  grep -q '"target_step_id": "PD-C-4"' "$TMP_ROOT/$run_id.wrapper-rerun.json"
  node "$ROOT/src/cli.mjs" assist-signal --repo "$repo" --step PD-C-5 --signal recommend-approve --reason ok --no-run-next >"$TMP_ROOT/$run_id.assist-signal-2.json"
  node "$ROOT/src/cli.mjs" accept-recommendation --repo "$repo" --step PD-C-5 --no-run-next >"$TMP_ROOT/$run_id.accept-recommendation.json"
  grep -q '"to": "PD-C-6"' "$TMP_ROOT/$run_id.accept-recommendation.json"
  grep -q '"current_step": "PD-C-6"' "$repo/.pdh-flow/runtime.json"
}

test_gate_baseline_rerun_requirement() {
  local repo run_id baseline_commit
  repo="$(seed_repo gate-baseline)"
  printf '\nGate baseline seed\n' >>"$repo/current-note.md"
  (
    cd "$repo"
    git add current-note.md tickets/runtime-test-note.md
    git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -m "[PD-C-4] Seed review baseline" >/dev/null
  )
  baseline_commit="$(cd "$repo" && git rev-parse HEAD)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-5 | sed -n '1p')"
  node "$ROOT/src/cli.mjs" run-next --repo "$repo" >/dev/null
  node -e "const fs=require('fs'); const gate=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(gate.baseline.step_id!=='PD-C-4') throw new Error('baseline step mismatch'); if(gate.baseline.commit!==process.argv[2]) throw new Error('baseline commit mismatch');" "$repo/.pdh-flow/runs/$run_id/steps/PD-C-5/human-gate.json" "$baseline_commit"

  python - "$repo/current-ticket.md" <<'PY'
from pathlib import Path
path = Path(__import__('sys').argv[1])
text = path.read_text()
needle = '### Acceptance Criteria\n'
replacement = needle + '- `uv run calc "(1+2)*3"` は将来対応候補として検討する。\n'
new_text = text.replace(needle, replacement, 1)
if new_text == text:
    raise SystemExit("could not find Acceptance Criteria heading in current-ticket.md")
path.write_text(new_text)
PY
  node "$ROOT/src/cli.mjs" assist-signal --repo "$repo" --step PD-C-5 --signal recommend-approve --reason "looks good" --no-run-next >/dev/null
  node -e "const fs=require('fs'); const gate=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(gate.rerun_requirement.target_step_id!=='PD-C-3') throw new Error('rerun requirement missing');" "$repo/.pdh-flow/runs/$run_id/steps/PD-C-5/human-gate.json"
  if node "$ROOT/src/cli.mjs" accept-recommendation --repo "$repo" --step PD-C-5 --no-run-next >"$TMP_ROOT/$run_id.accept-should-fail.txt" 2>&1; then
    echo "accept-recommendation should fail when gate edits require rerun" >&2
    exit 1
  fi
  grep -q "require rerun from PD-C-3" "$TMP_ROOT/$run_id.accept-should-fail.txt"
}

test_assist_rerun_recommendation() {
  local repo run_id
  repo="$(seed_repo assist-rerun)"
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-5 | sed -n '1p')"
  node "$ROOT/src/cli.mjs" run-next --repo "$repo" >/dev/null
  node "$ROOT/src/cli.mjs" assist-signal --repo "$repo" --step PD-C-5 --signal recommend-rerun-from --target-step PD-C-4 --reason "plan changed after discussion" --no-run-next >"$TMP_ROOT/$run_id.rerun-recommendation.json"
  grep -q '"target_step_id": "PD-C-4"' "$TMP_ROOT/$run_id.rerun-recommendation.json"
  node "$ROOT/src/cli.mjs" accept-recommendation --repo "$repo" --step PD-C-5 --no-run-next >"$TMP_ROOT/$run_id.accept-rerun.json"
  grep -q '"to": "PD-C-4"' "$TMP_ROOT/$run_id.accept-rerun.json"
  grep -q '"current_step": "PD-C-4"' "$repo/.pdh-flow/runtime.json"
}

test_assist_answer_flow() {
  local repo run_id
  repo="$(seed_repo assist-answer)"
  run_id="$(advance_to_provider_step "$repo")"
  node "$ROOT/src/cli.mjs" interrupt --repo "$repo" --message "Need a decision on integer rounding." >/dev/null
  node "$ROOT/src/cli.mjs" assist-open --repo "$repo" --step PD-C-6 --prepare-only >"$TMP_ROOT/$run_id.assist-answer-open.json"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(data.allowedSignals.join(',')!=='answer') throw new Error('answer signal missing');" "$TMP_ROOT/$run_id.assist-answer-open.json"
  node "$ROOT/src/cli.mjs" assist-signal --repo "$repo" --step PD-C-6 --signal answer --message "Keep integer arithmetic." --no-run-next >"$TMP_ROOT/$run_id.assist-answer.json"
  grep -q '"answered": "interrupt-' "$TMP_ROOT/$run_id.assist-answer.json"
  grep -q "Keep integer arithmetic." "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/interruptions/"*-answer.md
}

test_assist_failed_continue() {
  local repo run_id fake_fail fake_success args prompt_path
  repo="$(seed_repo assist-failed-continue)"
  run_id="$(advance_to_provider_step "$repo")"
  fake_fail="$(write_fake_codex_fail)"
  fake_success="$(write_fake_codex_success)"
  CODEX_BIN="$fake_fail" node "$ROOT/src/cli.mjs" run-provider --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >/dev/null || true
  node "$ROOT/src/cli.mjs" assist-open --repo "$repo" --step PD-C-6 --prepare-only >"$TMP_ROOT/$run_id.assist-failed-open.json"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(data.allowedSignals.join(',')!=='continue') throw new Error('continue signal missing for failed state'); console.log(data.promptPath);" "$TMP_ROOT/$run_id.assist-failed-open.json" >"$TMP_ROOT/$run_id.assist-failed-prompt-path.txt"
  prompt_path="$(cat "$TMP_ROOT/$run_id.assist-failed-prompt-path.txt")"
  grep -q "Allowed signals now: continue" "$prompt_path"
  grep -q 'When the blocker is addressed, send `continue` so the runtime reruns PD-C-6 from the current step.' "$prompt_path"
  node "$ROOT/src/cli.mjs" assist-signal --repo "$repo" --step PD-C-6 --signal continue --reason "edits are ready" --no-run-next >"$TMP_ROOT/$run_id.assist-failed-signal.json"
  grep -q '"pendingConfirmation": true' "$TMP_ROOT/$run_id.assist-failed-signal.json"
  grep -q '"status": "pending"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/assist/latest-signal.json"
  node "$ROOT/src/cli.mjs" apply-assist-signal --repo "$repo" --step PD-C-6 --no-run-next >"$TMP_ROOT/$run_id.assist-failed-apply.json"
  grep -q '"status": "ok"' "$TMP_ROOT/$run_id.assist-failed-apply.json"
  grep -q '"status": "accepted"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/assist/latest-signal.json"
  grep -q '"status": "running"' "$repo/.pdh-flow/runtime.json"
  args="$TMP_ROOT/$run_id.assist-failed-rerun-args.txt"
  CODEX_BIN="$fake_success" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli.mjs" run-next --repo "$repo" --force --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >/dev/null || true
  test -f "$args"
}

test_web_readonly() {
  local repo run_id fake args server_log server_pid url
  repo="$(seed_repo web)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_success)"
  args="$TMP_ROOT/$run_id.web-args.txt"
  CODEX_BIN="$fake" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli.mjs" run-next --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >/dev/null || true
  server_log="$TMP_ROOT/web.log"
  node "$ROOT/src/cli.mjs" web --repo "$repo" --host 127.0.0.1 --port 0 >"$server_log" 2>&1 &
  server_pid="$!"
  for _ in $(seq 1 50); do
    url="$(sed -n 's/^Web UI: //p' "$server_log" | tail -1)"
    if [ -n "$url" ]; then
      break
    fi
    sleep 0.1
  done
  if [ -z "$url" ]; then
    cat "$server_log" >&2
    kill "$server_pid" 2>/dev/null || true
    exit 1
  fi
  node - "$url" <<'NODE'
const url = process.argv[2];
const state = await (await fetch(`${url}api/state`)).json();
if (state.mode !== "viewer+assist") throw new Error("web mode is not viewer+assist");
if (!state.runtime.run) throw new Error("run missing from web state");
if (!state.flow.variants.full.steps.some((step) => step.id === "PD-C-6" && step.label === "実装")) throw new Error("flow labels missing");
const implementation = state.flow.variants.light.steps.find((step) => step.id === "PD-C-6");
if (!implementation?.uiContract?.viewer) throw new Error("ui contract missing");
if (!implementation?.uiOutput?.summary?.includes("fake provider summary")) throw new Error("ui output missing");
if (!implementation?.uiRuntime?.changedFiles?.includes("current-note.md")) throw new Error("ui runtime missing changed files");
if (!state.documents?.note?.path?.endsWith("current-note.md")) throw new Error("note document path missing");
if (!state.documents?.note?.text?.includes("PD-C-3")) throw new Error("note document text missing");
if (!state.documents?.ticket?.path?.endsWith("current-ticket.md")) throw new Error("ticket document path missing");
if (!state.current?.nextAction?.actions?.some((action) => action.kind === "assist")) throw new Error("assist action missing");
if (!state.current.nextAction.commands.some((command) => command.includes("run-next"))) throw new Error("next action command missing");
const gateStep = state.flow.variants.full.steps.find((step) => step.id === "PD-C-5");
if (!gateStep?.uiContract?.mustShow?.includes("変更差分")) throw new Error("gate diff contract missing");
if (!gateStep?.reviewDiff?.baseLabel) throw new Error("gate diff summary missing");
const mermaid = await (await fetch(`${url}api/flow.mmd`)).text();
if (!mermaid.includes("PD-C-6") || !mermaid.includes("実装")) throw new Error("mermaid flow labels missing");
  const html = await (await fetch(`${url}?assist=manual`)).text();
if (!html.includes("PDH Dev Dashboard")) throw new Error("html shell missing");
if (html.includes("flow-toggle")) throw new Error("flow toggle should not be rendered");
if (!html.includes("detail-modal")) throw new Error("detail modal shell missing");
const mutation = await fetch(`${url}api/state`, { method: "POST" });
if (mutation.status !== 405) throw new Error(`mutation endpoint should be rejected, got ${mutation.status}`);
NODE
  curl -s "${url}api/render-mermaid?code=graph%20TD%0AA--%3EB" | rg -q "<svg"
  curl -s "${url}api/artifact?step=PD-C-5&name=human-gate-summary.md" | rg -q "Human Gate Summary"
  curl -s "${url}api/diff?step=PD-C-5" | rg -q "\"baseLabel\":\""
  /usr/lib/chromium/chromium --headless --disable-gpu --no-sandbox --virtual-time-budget=5000 --dump-dom "${url}?assist=manual&doc=note&heading=PD-C-3.%20%E8%A8%88%E7%94%BB&mode=markdown" | rg -q "detail-view-toggle|detail-doc-viewer|current-note.md"
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}

test_frontmatter_run
test_nested_section_guard
test_recorded_step_commit_guard
test_reviewer_placeholder_sanitization
test_replace_note_section_with_nested_headings
test_prompt_context
test_stop_after_step
test_blocked_run
test_auto_provider_run
test_auto_review_judgement
test_review_loop_auto_repair
test_failed_run
test_auto_resume_after_idle_timeout
test_review_guard_auto_repair
test_stale_normalization_respects_step_finished
test_supervisor_running_blocks_stale_normalization
test_supervisor_stale_without_attempt_fails_run
test_run_refuses_active_run
test_force_reset_creates_archive_tag
test_step_recovery_tag
test_pdh_stop_marks_user_stopped
test_resume_after_process_lost
test_recover_from_tags_rebuilds_runtime
test_resumed_run
test_interrupted_run
test_assist_gate_flow
test_gate_baseline_rerun_requirement
test_assist_rerun_recommendation
test_assist_answer_flow
test_assist_failed_continue
test_web_readonly

echo "runtime tests passed"
