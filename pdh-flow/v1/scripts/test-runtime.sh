#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_TMP_ROOT="${TMP_ROOT:-${TMPDIR:-/tmp}/pdh-flow-runtime-tests}"
WORKER_FN="${2:-}"

if [ "${1:-}" = "--worker" ]; then
  TMP_ROOT="$BASE_TMP_ROOT/$WORKER_FN"
  LOG_DIR="${LOG_DIR:-$TMP_ROOT/.logs}"
  rm -rf "$TMP_ROOT"
  mkdir -p "$TMP_ROOT" "$LOG_DIR"
else
  TMP_ROOT="$BASE_TMP_ROOT"
  LOG_DIR="${LOG_DIR:-$TMP_ROOT/.logs}"
  rm -rf "$TMP_ROOT"
  mkdir -p "$TMP_ROOT" "$LOG_DIR"
fi

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
  local fake_claude
  fake_claude="$(write_fake_claude_pdc5_gate)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant light --start-step PD-C-5 | sed -n '1p')"
  CLAUDE_BIN="$fake_claude" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" >"$TMP_ROOT/$run_id.gate.json"
  node "$ROOT/src/cli/index.ts" approve --repo "$repo" --step PD-C-5 --reason ok >/dev/null
  node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --stop-after-step >"$TMP_ROOT/$run_id.stop.txt"
  printf '%s\n' "$run_id"
}

write_fake_codex_fail() {
  local path="$TMP_ROOT/fake-codex-fail-$$.sh"
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
  local path="$TMP_ROOT/fake-codex-success-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
if [ -n "${FAKE_CODEX_ARGS_FILE:-}" ]; then
  printf '%s\n' "$@" > "$FAKE_CODEX_ARGS_FILE"
elif [ -n "${FAKE_ARGS_FILE:-}" ]; then
  printf '%s\n' "$@" > "$FAKE_ARGS_FILE"
fi
prompt="$(cat || true)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
repair_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*repair.json\)`\.$/\1/p; s/^`\([^`]*repair.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
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
  local path="$TMP_ROOT/fake-codex-hang-then-resume-$$.sh"
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
  local path="$TMP_ROOT/fake-claude-success-$$.sh"
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
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
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

write_fake_claude_pdc5_gate() {
  local path="$TMP_ROOT/fake-claude-pdc5-gate-$$.sh"
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
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'JSON'
{
  "summary": ["implementation gate summary"],
  "risks": ["fake gate risk"],
  "ready_when": ["human approves PD-C-5"],
  "notes": "fake gate notes"
}
JSON
fi
if [ -f current-note.md ]; then
  cat >>current-note.md <<'MD'

## PD-C-5. 実装承認待ち

- fake implementation gate summary
- fake risk: verify before PD-C-6
MD
fi
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"assistant","message":{"content":"fake gate success"}}'
printf '%s\n' '{"type":"result","subtype":"success","result":"fake gate success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_claude_review_loop() {
  local path="$TMP_ROOT/fake-claude-review-loop-$$.sh"
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
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
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

write_fake_claude_ac_verification() {
  local path="$TMP_ROOT/fake-claude-ac-verification-$$.sh"
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
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  cat >"$review_path" <<'JSON'
{
  "status": "No Critical/Major",
  "summary": "every Product AC has concrete evidence and no close blocker remains",
  "findings": [],
  "notes": "AC verification + PdM purpose check passed"
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
  "notes": "aggregator AC verification passed",
  "judgement": {
    "kind": "ac_verification",
    "status": "Ready",
    "summary": "aggregator confirms Ready"
  }
}
JSON
fi
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"assistant","message":{"content":"fake PD-C-9 review success"}}'
printf '%s\n' '{"type":"result","subtype":"success","result":"fake PD-C-9 review success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_codex_guard_repair() {
  local path="$TMP_ROOT/fake-codex-guard-repair-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt="$(cat || true)"
repair_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*repair.json\)`\.$/\1/p; s/^`\([^`]*repair.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
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

write_fake_claude_reviewer_fail() {
  # Reviewer call (review.json prompt) exits non-zero without writing any
  # output. Aggregator / repair calls would still succeed but should not
  # be reached because executeParallelReviewStep breaks on a failed
  # reviewer.
  local path="$TMP_ROOT/fake-claude-reviewer-fail-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-p" ]; then prompt="$2"; shift 2; continue; fi
  shift
done
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$review_path" ]; then
  printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
  printf '%s\n' '{"type":"error","message":"reviewer planned failure"}'
  exit 9
fi
# Non-reviewer calls (aggregator, repair) — happy default so a future
# code change does not silently turn this fixture into a different test.
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"result","subtype":"success","result":"non-reviewer call"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_claude_aggregator_fail() {
  # Reviewer writes a clean No Critical/Major review.json. Aggregator
  # call (ui-output.json path) exits non-zero. Used to exercise the
  # aggregator-failure break path.
  local path="$TMP_ROOT/fake-claude-aggregator-fail-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-p" ]; then prompt="$2"; shift 2; continue; fi
  shift
done
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  cat >"$review_path" <<'JSON'
{
  "status": "No Critical/Major",
  "summary": "claude reviewer ok",
  "findings": [],
  "notes": "fake reviewer pass"
}
JSON
  printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
  printf '%s\n' '{"type":"result","subtype":"success","result":"reviewer pass"}'
  exit 0
fi
if [ -n "$ui_path" ]; then
  printf '%s\n' '{"type":"error","message":"aggregator planned failure"}'
  exit 9
fi
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"result","subtype":"success","result":"unknown call"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_claude_review_always_major() {
  # Reviewer always writes Major. Aggregator always writes a Major
  # judgement. Used by repair / rerun-from / maxRounds tests so the
  # round loop never accepts the judgement.
  local path="$TMP_ROOT/fake-claude-review-always-major-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-p" ]; then prompt="$2"; shift 2; continue; fi
  shift
done
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  cat >"$review_path" <<'JSON'
{
  "status": "Major",
  "summary": "always-major reviewer keeps blocking",
  "findings": [
    {
      "severity": "major",
      "title": "Persistent blocker",
      "evidence": "fake always-major evidence",
      "recommendation": "rerun planning"
    }
  ],
  "notes": "fake always-major"
}
JSON
fi
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'JSON'
{
  "summary": ["aggregator forced Major"],
  "risks": [],
  "ready_when": [],
  "notes": "aggregator round summary",
  "judgement": {
    "kind": "plan_review",
    "status": "Major",
    "summary": "aggregator says Major"
  }
}
JSON
fi
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"result","subtype":"success","result":"always-major call"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_codex_repair_in_place() {
  # PD-C-4 has codex both as a reviewer (Critical Reviewer) and as the
  # repair provider, so this fake must handle review.json (write a
  # Major reviewer output to keep the always-major scenario consistent)
  # AND repair.json (commit_required:false → in-place repair).
  local path="$TMP_ROOT/fake-codex-repair-in-place-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt="$(cat || true)"
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
repair_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*repair.json\)`\.$/\1/p; s/^`\([^`]*repair.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  cat >"$review_path" <<'JSON'
{
  "status": "Major",
  "summary": "codex reviewer also flags blocking issue",
  "findings": [
    {
      "severity": "major",
      "title": "Codex reviewer blocker",
      "evidence": "fake codex always-major evidence",
      "recommendation": "rerun planning"
    }
  ],
  "notes": "fake codex always-major"
}
JSON
fi
if [ -n "$repair_path" ]; then
  mkdir -p "$(dirname "$repair_path")"
  cat >"$repair_path" <<'JSON'
{
  "summary": "in-place repair attempt",
  "verification": ["touched current-note.md"],
  "remaining_risks": ["reviewer may still flag the plan"],
  "commit_required": false,
  "rerun_target_step": null,
  "notes": "fake in-place repair"
}
JSON
fi
printf '%s\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\n' '{"type":"turn.completed","final_message":"fake in-place repair"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_fake_codex_repair_commit_required() {
  # As above, codex is both the Critical Reviewer and the repair
  # provider. Reviewer call: write a Major review.json. Repair call:
  # write commit_required:true with rerun_target_step: PD-C-3.
  local path="$TMP_ROOT/fake-codex-repair-commit-required-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt="$(cat || true)"
review_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*review.json\)`\.$/\1/p; s/^`\([^`]*review.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
repair_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*repair.json\)`\.$/\1/p; s/^`\([^`]*repair.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$review_path" ]; then
  mkdir -p "$(dirname "$review_path")"
  cat >"$review_path" <<'JSON'
{
  "status": "Major",
  "summary": "codex reviewer flags blocking issue",
  "findings": [
    {
      "severity": "major",
      "title": "Codex reviewer blocker",
      "evidence": "fake codex always-major evidence",
      "recommendation": "rerun planning"
    }
  ],
  "notes": "fake codex always-major"
}
JSON
fi
if [ -n "$repair_path" ]; then
  mkdir -p "$(dirname "$repair_path")"
  cat >"$repair_path" <<'JSON'
{
  "summary": "plan needs a code spike, rerun PD-C-3",
  "verification": [],
  "remaining_risks": [],
  "commit_required": true,
  "rerun_target_step": "PD-C-3",
  "notes": "fake commit-required repair"
}
JSON
fi
printf '%s\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\n' '{"type":"turn.completed","final_message":"fake commit-required repair"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

test_frontmatter_run() {
  local repo
  repo="$(seed_repo frontmatter)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >"$TMP_ROOT/frontmatter.run.txt"
  grep -q "^run-" "$TMP_ROOT/frontmatter.run.txt"
  grep -q '"current_step": "PD-C-3"' "$repo/.pdh-flow/runtime.json"
  grep -q '"run_id": "run-' "$repo/.pdh-flow/runtime.json"
}

test_nested_section_guard() {
  local repo
  repo="$(seed_repo nested-section-guard)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node --input-type=module -e "import { replaceNoteSection } from '$ROOT/src/repo/note.ts'; replaceNoteSection('$repo', 'PD-C-3. 調査と計画', '### 実装方針\\n\\n- nested plan detail\\n\\n### テスト計画\\n\\n- nested verification detail');"
  node --input-type=module -e "import { evaluateGuard } from '$ROOT/src/flow/guards/index.ts'; const result = evaluateGuard({ id: 'plan-recorded', type: 'note_section_updated', path: 'current-note.md', section: 'PD-C-3. 調査と計画' }, { repoPath: '$repo' }); console.log(JSON.stringify(result));" >"$TMP_ROOT/nested-section-guard.json"
  grep -q '"status":"passed"' "$TMP_ROOT/nested-section-guard.json"
}

test_recorded_step_commit_guard() {
  local repo before
  repo="$(seed_repo recorded-step-commit)"
  before="$(git -C "$repo" rev-parse HEAD)"
  printf '\nrecorded commit test\n' >>"$repo/current-note.md"
  git -C "$repo" add current-note.md
  git -C "$repo" -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -m "Unrelated commit subject" >/dev/null
  node --input-type=module -e "import { writeStepCommitRecord, loadStepCommitRecord } from '$ROOT/src/runtime/step-commit.ts'; const record = writeStepCommitRecord({ repoPath: '$repo', stateDir: '$repo/.pdh-flow', runId: 'run-test', stepId: 'PD-C-3', beforeCommit: '$before' }); if (!record?.commit) throw new Error('step commit record missing'); const loaded = loadStepCommitRecord({ stateDir: '$repo/.pdh-flow', runId: 'run-test', stepId: 'PD-C-3' }); if (!loaded?.commit) throw new Error('step commit record not reloadable');"
  node --input-type=module -e "import { evaluateGuard } from '$ROOT/src/flow/guards/index.ts'; import { loadStepCommitRecord } from '$ROOT/src/runtime/step-commit.ts'; const stepCommit = loadStepCommitRecord({ stateDir: '$repo/.pdh-flow', runId: 'run-test', stepId: 'PD-C-3' }); const result = evaluateGuard({ id: 'step-commit', type: 'step_commit_recorded', stepCommit }, { repoPath: '$repo' }); console.log(JSON.stringify(result));" >"$TMP_ROOT/recorded-step-commit.json"
  grep -q '"status":"passed"' "$TMP_ROOT/recorded-step-commit.json"
}

test_step_commit_guard_fails_without_record() {
  local repo
  repo="$(seed_repo step-commit-no-record)"
  git -C "$repo" -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit --allow-empty -m "[PD-C-3] looks legit but no record" >/dev/null
  node --input-type=module -e "import { evaluateGuard } from '$ROOT/src/flow/guards/index.ts'; const result = evaluateGuard({ id: 'step-commit', type: 'step_commit_recorded' }, { repoPath: '$repo' }); console.log(JSON.stringify(result));" >"$TMP_ROOT/step-commit-no-record.json"
  grep -q '"status":"failed"' "$TMP_ROOT/step-commit-no-record.json"
  grep -q 'step-commit.json missing' "$TMP_ROOT/step-commit-no-record.json"
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
  node --input-type=module -e "import { loadReviewerOutput } from '$ROOT/src/runtime/review.ts'; const output = loadReviewerOutput({ stateDir: '$repo/.pdh-flow', runId: 'run-test', stepId: 'PD-C-7', reviewerId: 'code_reviewer-1' }); if (output.findings.length !== 1) throw new Error('placeholder finding should be dropped'); if (!output.findings[0].evidence.includes('uv run calc')) throw new Error('structured evidence not preserved: ' + output.findings[0].evidence); if (!output.notes.includes('one') || !output.notes.includes('two')) throw new Error('structured notes not rendered: ' + output.notes);"
}

test_replace_note_section_with_nested_headings() {
  local repo
  repo="$(seed_repo replace-note-section-nested)"
  node --input-type=module -e "import { replaceNoteSection, extractSection } from '$ROOT/src/repo/note.ts'; import { readFileSync } from 'node:fs'; replaceNoteSection('$repo', 'PD-C-7. 品質検証結果', 'Updated: now\\n\\n### Findings\\n\\n- clean finding\\n\\n### Review Rounds\\n\\n#### Round 1\\n\\n- ok'); const text = readFileSync('$repo/current-note.md', 'utf8'); const section = extractSection(text, 'PD-C-7. 品質検証結果'); if (!section.includes('### Findings')) throw new Error('nested heading missing'); if (!section.includes('#### Round 1')) throw new Error('nested child heading missing'); if (!text.includes('## PD-C-9. プロセスチェックリスト')) throw new Error('next top-level section removed');"
}

test_prompt_context() {
  local repo prompt_path
  repo="$(seed_repo prompt-context)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  prompt_path="$(node "$ROOT/src/cli/index.ts" prompt --repo "$repo")"
  grep -q "^# pdh-flow ステッププロンプト" "$prompt_path"
  grep -q "^## 実行コンテキスト" "$prompt_path"
  grep -q "^- 現在ステップ: PD-C-3" "$prompt_path"
  grep -q "^# あなたの位置づけ" "$prompt_path"
  grep -q "^# 用語" "$prompt_path"
  grep -q "ui-output.json" "$prompt_path"
  grep -q "provider ask --repo . --message" "$prompt_path"
  grep -q "^# PD-C-3. 調査と計画" "$prompt_path"
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
  node "$ROOT/src/cli/index.ts" status --repo "$repo" >"$TMP_ROOT/$run_id.status.txt"
  grep -q "Status: running" "$TMP_ROOT/$run_id.status.txt"
  grep -q "Current Step: PD-C-6 実装" "$TMP_ROOT/$run_id.status.txt"
}

test_blocked_run() {
  local repo run_id
  repo="$(seed_repo blocked)"
  run_id="$(advance_to_provider_step "$repo")"
  node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --manual-provider >"$TMP_ROOT/$run_id.blocked.txt"
  grep -q "provider_step_requires_execution" "$TMP_ROOT/$run_id.blocked.txt"
  node "$ROOT/src/cli/index.ts" status --repo "$repo" >"$TMP_ROOT/$run_id.blocked-status.txt"
  grep -q "Status: blocked" "$TMP_ROOT/$run_id.blocked-status.txt"
}

test_auto_provider_run() {
  local repo run_id fake args
  repo="$(seed_repo auto-provider)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_success)"
  args="$TMP_ROOT/$run_id.auto-provider-args.txt"
  CODEX_BIN="$fake" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.auto-provider.txt" || true
  test -f "$args"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/ui-output.json"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/ui-runtime.json"
  # fake codex never updates current-note.md, so the note_section_updated
  # guard for PD-C-6 fails. (step_commit_recorded would also fail but the
  # note guard fires first; this test is kept as the "provider produced no
  # durable surface" failure path.)
  grep -q "guard_failed" "$TMP_ROOT/$run_id.auto-provider.txt"
}

write_fake_codex_pdc6_no_commit() {
  # fake codex that updates current-note.md PD-C-6 section AND ui-output.json
  # but does NOT git commit. Used to verify the runtime auto-commits durable
  # changes after a completed edit-mode step (the "single commit owner"
  # invariant: provider never commits, runtime always commits).
  local path="$TMP_ROOT/fake-codex-pdc6-no-commit-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt="$(cat || true)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'JSON'
{
  "summary": ["fake implementation summary"],
  "risks": [],
  "ready_when": ["fake ready"],
  "notes": "fake implementation notes"
}
JSON
fi
# Find the worktree root (the prompt mentions current-note.md path
# implicitly via cwd of codex; fake codex inherits cwd from runtime).
if [ -f current-note.md ]; then
  if ! grep -q "^## PD-C-6" current-note.md; then
    printf '\n## PD-C-6\n\nfake implementation note\n' >> current-note.md
  else
    printf '\nfake implementation note (auto-commit test)\n' >> current-note.md
  fi
fi
printf '%s\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\n' '{"type":"turn.completed","final_message":"fake success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

test_runtime_auto_commits_when_provider_does_not() {
  # Verifies the single-owner invariant: when a completed edit-mode step
  # leaves durable changes (note/ticket/source) but the provider did not
  # commit, the runtime commits them so step_commit_recorded passes and
  # the next step has a stable diff baseline.
  local repo run_id fake before_head after_head
  repo="$(seed_repo runtime-auto-commit)"
  run_id="$(advance_to_provider_step "$repo")"
  before_head="$(git -C "$repo" rev-parse HEAD)"
  fake="$(write_fake_codex_pdc6_no_commit)"
  CODEX_BIN="$fake" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --stop-after-step --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.auto-commit.txt" || true
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/step-commit.json"
  grep -q '"subject": "\[PD-C-6\] Implementation"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/step-commit.json"
  after_head="$(git -C "$repo" rev-parse HEAD)"
  if [ "$before_head" = "$after_head" ]; then
    echo "expected runtime to advance HEAD via auto-commit; HEAD unchanged at $before_head" >&2
    git -C "$repo" status --short >&2
    exit 1
  fi
  # subject must be the canonical "[PD-C-6] Implementation" the runtime
  # writes via stepCommitSummary, not anything provider-derived.
  git -C "$repo" log -1 --format=%s | grep -q '^\[PD-C-6\] Implementation$'
  # NOTE: tickets/runtime-test-note.md may be dirty after the auto-commit
  # because advanceRun appends the post-commit Step History entry, which
  # naturally rolls into the next step's commit. That is by design.
}

write_fake_codex_pdc6_self_commit() {
  # fake codex that updates note AND commits itself. Used to verify that
  # the runtime detects a provider self-commit (HEAD changed) and does NOT
  # double-commit. Provider self-commits are deprecated but tolerated.
  local path="$TMP_ROOT/fake-codex-pdc6-self-commit-$$.sh"
  cat >"$path" <<'SH'
#!/usr/bin/env bash
prompt="$(cat || true)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'JSON'
{
  "summary": ["self-committing provider"],
  "risks": [],
  "ready_when": ["fake ready"],
  "notes": "self-committing provider notes"
}
JSON
fi
if [ -f current-note.md ]; then
  printf '\nself-committing provider edit\n' >> current-note.md
  # current-note.md may be a symlink to tickets/<id>-note.md; -A picks
  # up the underlying file change either way.
  git -c user.name="fake provider" -c user.email="fake-provider@example.invalid" \
    add -A >/dev/null 2>&1 || true
  git -c user.name="fake provider" -c user.email="fake-provider@example.invalid" \
    commit -m "[provider] custom commit subject" >/dev/null 2>&1 || true
fi
printf '%s\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\n' '{"type":"turn.completed","final_message":"fake success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

test_runtime_respects_provider_self_commit() {
  # When the provider commits itself, the runtime must not double-commit.
  # This documents the deprecated-but-tolerated path: HEAD changed during
  # the step -> runtime keeps that commit and emits a provider_commit_detected
  # event so prompts can be cleaned up.
  local repo run_id fake before_head after_head events_path
  repo="$(seed_repo runtime-respects-self-commit)"
  run_id="$(advance_to_provider_step "$repo")"
  before_head="$(git -C "$repo" rev-parse HEAD)"
  fake="$(write_fake_codex_pdc6_self_commit)"
  CODEX_BIN="$fake" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --stop-after-step --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.self-commit.txt" || true
  after_head="$(git -C "$repo" rev-parse HEAD)"
  if [ "$before_head" = "$after_head" ]; then
    echo "fake provider should have committed; HEAD unchanged" >&2
    exit 1
  fi
  # Exactly one new commit (the provider's), no runtime double-commit on top.
  test "$(git -C "$repo" rev-list --count "$before_head..HEAD")" = "1"
  git -C "$repo" log -1 --format=%s | grep -q '^\[provider\] custom commit subject$'
  events_path="$repo/.pdh-flow/runs/$run_id/progress.jsonl"
  test -f "$events_path"
  grep -q '"type":"provider_commit_detected"' "$events_path"
}

test_auto_review_judgement() {
  local repo run_id fake_claude fake_codex args
  repo="$(seed_repo auto-review-judgement)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  fake_claude="$(write_fake_claude_success)"
  fake_codex="$(write_fake_codex_success)"
  args="$TMP_ROOT/$run_id.review-claude-args.txt"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" FAKE_CLAUDE_ARGS_FILE="$args" \
    node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.review.txt"
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
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  fake_claude="$(write_fake_claude_review_loop)"
  fake_codex="$(write_fake_codex_success)"
  count_file="$TMP_ROOT/$run_id.review-count.txt"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" FAKE_REVIEW_COUNT_FILE="$count_file" \
    node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.review-loop.txt"
  grep -q "completed" "$TMP_ROOT/$run_id.review-loop.txt"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-1/aggregate.json"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-1/repair.json"
  find "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-1/reviewers" -name review.json | grep -q .
  find "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-2/reviewers" -name review.json | grep -q .
  grep -R -q "この reviewer 役割の過去 blocker" "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-2/reviewers"
  grep -q "#### Round 1" "$repo/current-note.md"
  grep -q "Repair summary: fake repair applied" "$repo/current-note.md"
  grep -q '"status": "No Critical/Major"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/judgements/plan_review.json"
}

test_review_reviewer_failed_marks_attempt_failed() {
  # break path: a reviewer subprocess exits non-zero. The runtime
  # should mark the attempt failed and surface the failure summary;
  # it must NOT silently treat the missing review.json as a No
  # Critical/Major pass.
  local repo run_id fake_claude fake_codex
  repo="$(seed_repo review-reviewer-failed)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  fake_claude="$(write_fake_claude_reviewer_fail)"
  fake_codex="$(write_fake_codex_success)"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" \
    node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 \
    >"$TMP_ROOT/$run_id.review-reviewer-fail.txt" 2>&1 || true
  grep -q '"status": "failed"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/attempt-1/result.json"
  test ! -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/judgements/plan_review.json"
}

test_review_aggregator_failed_marks_attempt_failed() {
  # break path: reviewers complete cleanly but the aggregator call
  # exits non-zero. Attempt should be marked failed; no judgement
  # artifact written because aggregator never produced one.
  local repo run_id fake_claude fake_codex
  repo="$(seed_repo review-aggregator-failed)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  fake_claude="$(write_fake_claude_aggregator_fail)"
  fake_codex="$(write_fake_codex_success)"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" \
    node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 \
    >"$TMP_ROOT/$run_id.review-aggregator-fail.txt" 2>&1 || true
  grep -q '"status": "failed"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/attempt-1/result.json"
  test ! -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/judgements/plan_review.json"
}

test_review_repair_commit_required_triggers_rerun_from() {
  # break path: the aggregator says Major, the repair signals
  # commit_required:true with rerun_target_step: PD-C-3. The runtime
  # should call rerunFromStep — afterwards run.current_step_id must be
  # PD-C-3 (the rerun target), not PD-C-4. Also runs with
  # --max-attempts 3 to confirm the outer attempt loop does NOT retry
  # the review after a rerun-from: the run has already moved away from
  # PD-C-4, so re-executing reviewers would just churn LLM calls and
  # leave a phantom attempt-2 dir.
  local repo run_id fake_claude fake_codex
  repo="$(seed_repo review-commit-required)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  fake_claude="$(write_fake_claude_review_always_major)"
  fake_codex="$(write_fake_codex_repair_commit_required)"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" \
    node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 3 --retry-backoff-ms 0 --timeout-ms 5000 \
    >"$TMP_ROOT/$run_id.review-commit-required.txt" 2>&1 || true
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-1/repair.json"
  grep -q '"commit_required": true' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-1/repair.json"
  test ! -d "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/attempt-2" || { echo "rerun-from must not trigger an attempt-2 retry" >&2; exit 1; }
  # attempt.status is the canonical lifecycle value (completed); the
  # rerun-from semantics live in attempt.verdict so that a re-entry
  # into PD-C-4 won't trip hasCompletedProviderAttempt and skip the
  # review.
  grep -q '"status": "completed"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/attempt-1/result.json" || { echo "rerun-from attempt should record status=completed" >&2; cat "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/attempt-1/result.json" >&2; exit 1; }
  grep -q '"verdict": "rerun_from"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/attempt-1/result.json" || { echo "rerun-from attempt should record verdict=rerun_from" >&2; cat "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/attempt-1/result.json" >&2; exit 1; }
  node "$ROOT/src/cli/index.ts" status --repo "$repo" >"$TMP_ROOT/$run_id.review-commit-required.status.txt"
  grep -q "Current Step: PD-C-3" "$TMP_ROOT/$run_id.review-commit-required.status.txt" || { echo "expected current step to advance to PD-C-3 after rerun-from, status output:" >&2; cat "$TMP_ROOT/$run_id.review-commit-required.status.txt" >&2; exit 1; }
}

test_blocked_run_does_not_silently_rerun() {
  # Regression test: when cmdRunNext is invoked on a run that is
  # already in run.status="blocked", it must surface the blocked
  # status and exit 1 — not fall through to the provider-step branch
  # and silently re-run the previous step (whose latest attempt was
  # blocked, so hasCompletedProviderAttempt returns false and the
  # runtime would otherwise spawn another reviewer batch).
  local repo run_id
  repo="$(seed_repo blocked-run-no-rerun)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  node --input-type=module -e "import { updateRun } from '$ROOT/src/runtime/state.ts'; updateRun('$repo', { status: 'blocked', current_step_id: 'PD-C-4' });"
  out_file="$TMP_ROOT/$run_id.blocked-run-next.txt"
  if node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$out_file" 2>&1; then
    echo "run-next on a blocked run should exit non-zero" >&2
    cat "$out_file" >&2
    exit 1
  fi
  grep -q "Blocked: PD-C-4" "$out_file" || { echo "expected blocked status surface, got:" >&2; cat "$out_file" >&2; exit 1; }
  test ! -d "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds" || { echo "blocked run-next must not start a new review round" >&2; exit 1; }
}

test_review_force_rerun_after_max_in_place_repairs() {
  # break path: every round the aggregator says Major and the repair
  # comes back commit_required:false. After maxInPlaceRepairs (default
  # 2) such rounds, the runtime should force a rerun-from using
  # defaultRerunStep (PD-C-3 per PD-C-4 yaml). Without the force-rerun
  # the loop would run all maxRounds (= 6) iterations without
  # progress — the test asserts that we do NOT do that.
  local repo run_id fake_claude fake_codex
  repo="$(seed_repo review-force-rerun)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  fake_claude="$(write_fake_claude_review_always_major)"
  fake_codex="$(write_fake_codex_repair_in_place)"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" \
    node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 \
    >"$TMP_ROOT/$run_id.review-force-rerun.txt" 2>&1 || true
  # Round 1 + round 2 = in-place. Round 3 should detect
  # forceRerun (inPlaceRepairCount >= maxInPlaceRepairs) and rerun-from.
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-3/repair.json"
  test ! -d "$repo/.pdh-flow/runs/$run_id/steps/PD-C-4/review-rounds/round-4"
  node "$ROOT/src/cli/index.ts" status --repo "$repo" >"$TMP_ROOT/$run_id.review-force-rerun.status.txt"
  grep -q "Current Step: PD-C-3" "$TMP_ROOT/$run_id.review-force-rerun.status.txt" || { echo "expected force-rerun to land on PD-C-3, status output:" >&2; cat "$TMP_ROOT/$run_id.review-force-rerun.status.txt" >&2; exit 1; }
}

test_review_guard_auto_repair() {
  local repo run_id fake_claude fake_codex
  repo="$(seed_repo review-guard-auto-repair)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-9 | sed -n '1p')"
  fake_claude="$(write_fake_claude_ac_verification)"
  fake_codex="$(write_fake_codex_guard_repair)"
  CLAUDE_BIN="$fake_claude" CODEX_BIN="$fake_codex" \
    node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.review-guard-repair.txt"
  grep -q "PD-C-10" "$TMP_ROOT/$run_id.review-guard-repair.txt"
  grep -q "## AC 裏取り結果" "$repo/current-note.md"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-9/review-rounds/round-2/repair.json"
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-9/step-commit.json"
  node "$ROOT/src/cli/index.ts" status --repo "$repo" >"$TMP_ROOT/$run_id.review-guard-status.txt"
  grep -q "Current Step: PD-C-10" "$TMP_ROOT/$run_id.review-guard-status.txt"
}

test_failed_run() {
  local repo run_id fake summary_path
  repo="$(seed_repo failed)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_fail)"
  CODEX_BIN="$fake" node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.provider.txt" || true
  grep -q "failed" "$TMP_ROOT/$run_id.provider.txt"
  grep -q "Failure Summary:" "$TMP_ROOT/$run_id.provider.txt"
  summary_path="$(sed -n 's/^Failure Summary: //p' "$TMP_ROOT/$run_id.provider.txt")"
  test -f "$summary_path"
  grep -q "Exit code: 9" "$summary_path"
  node "$ROOT/src/cli/index.ts" status --repo "$repo" >"$TMP_ROOT/$run_id.failed-status.txt"
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
    node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 2 --retry-backoff-ms 0 --timeout-ms 5000 --idle-timeout-ms 200 \
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
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-9 | sed -n '1p')"
  node --input-type=module -e "import { appendProgressEvent, defaultStateDir, loadRuntime, updateRun, writeAttemptResult, latestAttemptResult } from '$ROOT/src/runtime/state.ts'; const repo = '$repo'; const runId = '$run_id'; const stateDir = defaultStateDir(repo); writeAttemptResult({ stateDir, runId, stepId: 'PD-C-9', attempt: 1, result: { provider: 'claude', status: 'running', pid: null, exitCode: null, finalMessage: null, stderr: '', timedOut: false, timeoutKind: null, signal: null, sessionId: null, resumeToken: null, rawLogPath: 'raw', startedAt: '2026-04-27T00:00:00.000Z', lastEventAt: '2026-04-27T00:00:00.000Z' } }); appendProgressEvent({ repoPath: repo, runId, stepId: 'PD-C-9', attempt: 1, type: 'step_finished', provider: 'runtime', message: 'PD-C-9 completed', payload: { finalMessage: 'done' } }); updateRun(repo, { status: 'running', current_step_id: 'PD-C-9' }); loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); const runtime = loadRuntime(repo); const latest = latestAttemptResult({ stateDir, runId, stepId: 'PD-C-9', provider: null }); if (runtime.run.status !== 'running') throw new Error('run status should stay running'); if (latest.status !== 'completed') throw new Error('attempt should be normalized to completed');"
}

test_supervisor_running_blocks_stale_normalization() {
  local repo run_id
  repo="$(seed_repo supervisor-running)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 | sed -n '1p')"
  node --input-type=module -e "import { defaultStateDir, loadRuntime, startRunSupervisor } from '$ROOT/src/runtime/state.ts'; const repo = '$repo'; const stateDir = defaultStateDir(repo); startRunSupervisor({ stateDir, repoPath: repo, runId: '$run_id', stepId: 'PD-C-3', command: 'run-next', pid: process.pid }); const runtime = loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); if (runtime.run.status !== 'running') throw new Error('supervisor-backed run should stay running'); if (runtime.supervisor?.status !== 'running') throw new Error('supervisor should stay running');"
}

test_supervisor_stale_without_attempt_keeps_run_running() {
  # PDH steps are designed to be re-invokable, so a dead supervisor
  # without any in-flight attempt is *not* a permanent failure — the
  # next run-next call just spawns a fresh attempt. The supervisor
  # itself is marked stale so the UI can show "no live worker", but
  # the run stays running.
  local repo run_id
  repo="$(seed_repo supervisor-stale)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 | sed -n '1p')"
  node --input-type=module -e "import { defaultStateDir, loadRuntime, startRunSupervisor } from '$ROOT/src/runtime/state.ts'; const repo = '$repo'; const stateDir = defaultStateDir(repo); startRunSupervisor({ stateDir, repoPath: repo, runId: '$run_id', stepId: 'PD-C-3', command: 'run-next', pid: 999999 }); const runtime = loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); if (runtime.run.status !== 'running') throw new Error('stale supervisor should keep run running, not fail it (got ' + runtime.run.status + ')'); if (runtime.supervisor?.status !== 'stale') throw new Error('supervisor should be marked stale');"
}

test_supervisor_stale_with_running_attempt_abandons_attempt() {
  # When the supervisor dies with an in-flight attempt, that attempt is
  # marked "abandoned" and an attempt_abandoned event is emitted. The
  # run stays running so the next run-next call spawns attempt N+1.
  local repo run_id
  repo="$(seed_repo supervisor-stale-running-attempt)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 | sed -n '1p')"
  node --input-type=module -e "import { defaultStateDir, latestAttemptResult, loadRuntime, startRunSupervisor, updateRun, writeAttemptResult } from '$ROOT/src/runtime/state.ts'; const repo = '$repo'; const runId = '$run_id'; const stateDir = defaultStateDir(repo); writeAttemptResult({ stateDir, runId, stepId: 'PD-C-3', attempt: 1, result: { provider: 'codex', status: 'running', pid: null, exitCode: null, finalMessage: null, stderr: '', timedOut: false, timeoutKind: null, signal: null, sessionId: null, resumeToken: null, rawLogPath: 'raw', startedAt: '2026-04-27T00:00:00.000Z', lastEventAt: '2026-04-27T00:00:00.000Z' } }); updateRun(repo, { status: 'running', current_step_id: 'PD-C-3' }); startRunSupervisor({ stateDir, repoPath: repo, runId, stepId: 'PD-C-3', command: 'run-next', pid: 999999 }); const runtime = loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); if (runtime.run.status !== 'running') throw new Error('run should stay running so the next run-next can re-spawn (got ' + runtime.run.status + ')'); const attempt = latestAttemptResult({ stateDir, runId, stepId: 'PD-C-3', provider: 'codex' }); if (attempt.status !== 'abandoned') throw new Error('in-flight attempt should be marked abandoned (got ' + attempt.status + ')');"
}

test_supervisor_stale_after_completed_attempt_keeps_running() {
  local repo run_id
  repo="$(seed_repo supervisor-stale-after-completed)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  node --input-type=module -e "import { appendProgressEvent, defaultStateDir, loadRuntime, startRunSupervisor, updateRun, writeAttemptResult } from '$ROOT/src/runtime/state.ts'; const repo = '$repo'; const runId = '$run_id'; const stateDir = defaultStateDir(repo); writeAttemptResult({ stateDir, runId, stepId: 'PD-C-4', attempt: 1, result: { provider: null, status: 'completed', pid: null, exitCode: 0, finalMessage: 'No Critical/Major', stderr: '', timedOut: false, timeoutKind: null, signal: null, sessionId: null, resumeToken: null, rawLogPath: 'raw', startedAt: '2026-04-27T00:00:00.000Z', finishedAt: '2026-04-27T00:00:01.000Z', lastEventAt: '2026-04-27T00:00:01.000Z' } }); appendProgressEvent({ repoPath: repo, runId, stepId: 'PD-C-4', attempt: 1, type: 'step_finished', provider: 'runtime', message: 'PD-C-4 completed', payload: { finalMessage: 'No Critical/Major' } }); updateRun(repo, { status: 'running', current_step_id: 'PD-C-4' }); startRunSupervisor({ stateDir, repoPath: repo, runId, stepId: 'PD-C-4', command: 'run-next', pid: 999999 }); const runtime = loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); if (runtime.run.status !== 'running') throw new Error('completed-then-stale supervisor should not flip run to failed (got ' + runtime.run.status + ')');"
}

test_review_judgement_accepted_recovers_failed_run() {
  local repo run_id
  repo="$(seed_repo judgement-accepted-recovers)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-4 | sed -n '1p')"
  # Simulate the calc-modulo bug: aggregator wrote an accepted judgement,
  # the supervisor died, and a previous normalize call mis-flipped the
  # run + attempt to "failed". The next loadRuntime must self-heal back
  # to running and rewrite the attempt as completed so cmdRunNext can
  # advance via the on_success transition.
  node --input-type=module -e "import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { defaultStateDir, latestAttemptResult, loadRuntime, updateRun, writeAttemptResult } from '$ROOT/src/runtime/state.ts'; const repo = '$repo'; const runId = '$run_id'; const stateDir = defaultStateDir(repo); const judgementsDir = join(stateDir, 'runs', runId, 'steps', 'PD-C-4', 'judgements'); mkdirSync(judgementsDir, { recursive: true }); writeFileSync(join(judgementsDir, 'plan_review.json'), JSON.stringify({ kind: 'plan_review', status: 'No Critical/Major', summary: 'all reviewers passed', source: 'aggregator', stepId: 'PD-C-4', runId, createdAt: new Date().toISOString(), details: {} }, null, 2)); writeAttemptResult({ stateDir, runId, stepId: 'PD-C-4', attempt: 1, result: { provider: null, status: 'failed', pid: null, exitCode: null, finalMessage: 'PD-C-4 stayed running without a live process (no active tracked processes).', stderr: 'PD-C-4 stayed running without a live process (no active tracked processes).', timedOut: false, timeoutKind: null, signal: null, sessionId: null, resumeToken: null, rawLogPath: 'raw', startedAt: '2026-04-27T00:00:00.000Z', finishedAt: '2026-04-27T00:00:02.000Z', lastEventAt: null } }); updateRun(repo, { status: 'failed', current_step_id: 'PD-C-4' }); const runtime = loadRuntime(repo, { normalizeStaleRunning: true, staleAfterMs: 0 }); if (runtime.run.status !== 'running') throw new Error('failed run with accepted judgement should be recovered to running (got ' + runtime.run.status + ')'); if (runtime.run.current_step_id !== 'PD-C-4') throw new Error('current_step_id should remain PD-C-4 (got ' + runtime.run.current_step_id + ')'); const attempt = latestAttemptResult({ stateDir, runId, stepId: 'PD-C-4', provider: null }); if (attempt.status !== 'completed') throw new Error('attempt should be rewritten to completed (got ' + attempt.status + ')');"
}

test_run_refuses_active_run() {
  local repo
  repo="$(seed_repo run-refuses-active)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  if node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >"$TMP_ROOT/refuse.out" 2>"$TMP_ROOT/refuse.err"; then
    echo "second run should fail without --force-reset" >&2
    exit 1
  fi
  grep -q "Active run already exists" "$TMP_ROOT/refuse.err"
  grep -q "resume --repo" "$TMP_ROOT/refuse.err"
  grep -q "stop --repo" "$TMP_ROOT/refuse.err"
}

test_force_reset_creates_archive_tag() {
  local repo
  repo="$(seed_repo force-reset-archive)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 --force-reset >"$TMP_ROOT/force-reset.out"
  grep -q "Archived prior run state under git tag" "$TMP_ROOT/force-reset.out"
  git -C "$repo" tag --list | grep -q "^pdh-flow-archive/runtime-test/.*-PD-C-3$"
}

test_step_recovery_tag() {
  local repo
  repo="$(seed_repo step-recovery-tag)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  printf '\nstep tag commit body\n' >>"$repo/current-note.md"
  (
    cd "$repo"
    git add current-note.md tickets/runtime-test-note.md 2>/dev/null || git add current-note.md
    node "$ROOT/src/cli/index.ts" commit-step --repo "$repo" --step PD-C-3 --message "Plan recorded" --ticket runtime-test >/dev/null
  )
  git -C "$repo" tag --list | grep -q "^pdh-flow/runtime-test/PD-C-3$"
}

test_pdh_stop_marks_user_stopped() {
  local repo
  repo="$(seed_repo pdh-stop)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node --input-type=module -e "import { defaultStateDir, startRunSupervisor } from '$ROOT/src/runtime/state.ts'; startRunSupervisor({ stateDir: defaultStateDir('$repo'), repoPath: '$repo', runId: 'placeholder', stepId: 'PD-C-3', command: 'run-next', pid: process.pid });"
  node "$ROOT/src/cli/index.ts" stop --repo "$repo" --reason "user requested" >"$TMP_ROOT/pdh-stop.json"
  grep -q '"status": "stopped"' "$TMP_ROOT/pdh-stop.json"
  grep -q '"staleReason": "user_stopped"' "$repo/.pdh-flow/runtime-supervisor.json"
  grep -q '"status": "failed"' "$repo/.pdh-flow/runtime.json"
}

test_resume_after_process_lost() {
  local repo run_id
  repo="$(seed_repo resume-after-loss)"
  run_id="$(advance_to_provider_step "$repo")"
  node --input-type=module -e "import { defaultStateDir, startRunSupervisor, loadRuntime } from '$ROOT/src/runtime/state.ts'; const stateDir = defaultStateDir('$repo'); startRunSupervisor({ stateDir, repoPath: '$repo', runId: '$run_id', stepId: 'PD-C-6', command: 'run-next', pid: 999999 }); loadRuntime('$repo', { normalizeStaleRunning: true, staleAfterMs: 0 });"
  grep -q '"status": "failed"' "$repo/.pdh-flow/runtime.json"
  grep -q '"status": "stale"' "$repo/.pdh-flow/runtime-supervisor.json"
  local fake
  fake="$(write_fake_codex_success)"
  CODEX_BIN="$fake" node "$ROOT/src/cli/index.ts" resume --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.resume-loss.txt" || true
  test -f "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/ui-output.json"
}

test_recover_from_tags_rebuilds_runtime() {
  local repo
  repo="$(seed_repo recover-from-tags)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  printf '\nrecover seed\n' >>"$repo/current-note.md"
  (
    cd "$repo"
    git add current-note.md tickets/runtime-test-note.md 2>/dev/null || git add current-note.md
    node "$ROOT/src/cli/index.ts" commit-step --repo "$repo" --step PD-C-3 --message "Plan" --ticket runtime-test >/dev/null
  )
  git -C "$repo" tag --list | grep -q "^pdh-flow/runtime-test/PD-C-3$"
  rm -rf "$repo/.pdh-flow"
  node "$ROOT/src/cli/index.ts" recover --repo "$repo" >"$TMP_ROOT/recover.json"
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
  CODEX_BIN="$fake" FAKE_ARGS_FILE="$first_args" node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >/dev/null
  CODEX_BIN="$fake" FAKE_ARGS_FILE="$second_args" node "$ROOT/src/cli/index.ts" resume --repo "$repo" --max-attempts 2 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.resume.txt"
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

  node "$ROOT/src/cli/index.ts" provider ask --repo "$repo" --message "Should multiplication use integer arithmetic?" >"$TMP_ROOT/$run_id.interrupt.txt"
  grep -q "interrupted" "$TMP_ROOT/$run_id.interrupt.txt"

  node "$ROOT/src/cli/index.ts" status --repo "$repo" >"$TMP_ROOT/$run_id.interrupted-status.txt"
  grep -q "Status: interrupted" "$TMP_ROOT/$run_id.interrupted-status.txt"

  if CODEX_BIN="$fake" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.open-interrupt-provider.txt" 2>&1; then
    echo "provider run should block while an interruption is open" >&2
    exit 1
  fi
  grep -q "needs_interrupt_answer" "$TMP_ROOT/$run_id.open-interrupt-provider.txt"
  test ! -f "$args"

  node "$ROOT/src/cli/index.ts" answer --repo "$repo" --message "Yes. Preserve integer arithmetic for this fixture." >"$TMP_ROOT/$run_id.answer.txt"
  grep -q "answered" "$TMP_ROOT/$run_id.answer.txt"

  prompt_path="$(node "$ROOT/src/cli/index.ts" prompt --repo "$repo")"
  grep -q "Should multiplication use integer arithmetic" "$prompt_path"
  grep -q "Preserve integer arithmetic" "$prompt_path"

  CODEX_BIN="$fake" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >"$TMP_ROOT/$run_id.answered-provider.txt"
  grep -q "completed" "$TMP_ROOT/$run_id.answered-provider.txt"
}

test_assist_gate_flow() {
  local repo run_id manifest prompt_path signal_path fake_claude
  repo="$(seed_repo assist-gate)"
  fake_claude="$(write_fake_claude_pdc5_gate)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-5 | sed -n '1p')"
  CLAUDE_BIN="$fake_claude" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" >"$TMP_ROOT/$run_id.assist-gate-open.json"
  node "$ROOT/src/cli/index.ts" assist-open --repo "$repo" --step PD-C-5 --prepare-only >"$TMP_ROOT/$run_id.assist-open.json"
  manifest="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!data.allowedSignals.includes('propose-approve')) throw new Error('propose-approve missing'); if(!data.allowedSignals.includes('propose-rerun-from')) throw new Error('propose-rerun-from missing'); if(!data.command.join(' ').includes('--setting-sources')) throw new Error('assist command missing settings hardening'); console.log(data.manifestPath);" "$TMP_ROOT/$run_id.assist-open.json")"
  prompt_path="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(data.promptPath);" "$TMP_ROOT/$run_id.assist-open.json")"
  test -f "$manifest"
  test -f "$prompt_path"
  grep -q "Allowed signals now: propose-approve, propose-request-changes, propose-reject, propose-rerun-from" "$prompt_path"
  grep -q "## What This Stop Means" "$prompt_path"
  grep -q "## Checkpoints For This Step" "$prompt_path"
  grep -q "If plan or ticket intent changed during the gate, prefer a rerun proposal instead of approve." "$prompt_path"
  grep -q "Do not run ticket.sh" "$repo/.pdh-flow/runs/$run_id/steps/PD-C-5/assist/system-prompt.txt"
  test -x "$repo/.pdh-flow/bin/assist-signal"
  test -x "$repo/.pdh-flow/bin/assist-test"
  node "$ROOT/src/cli/index.ts" assist-signal --repo "$repo" --step PD-C-5 --signal propose-approve --reason ok --no-run-next >"$TMP_ROOT/$run_id.assist-signal.json"
  grep -q '"action": "approve"' "$TMP_ROOT/$run_id.assist-signal.json"
  signal_path="$repo/.pdh-flow/runs/$run_id/steps/PD-C-5/assist/latest-signal.json"
  test -f "$signal_path"
  grep -q '"signal": "propose-approve"' "$signal_path"
  "$repo/.pdh-flow/bin/assist-signal" --step PD-C-5 --signal propose-rerun-from --target-step PD-C-4 --reason "wrapper path check" --no-run-next >"$TMP_ROOT/$run_id.wrapper-rerun.json"
  grep -q '"target_step_id": "PD-C-4"' "$TMP_ROOT/$run_id.wrapper-rerun.json"
  node "$ROOT/src/cli/index.ts" assist-signal --repo "$repo" --step PD-C-5 --signal propose-approve --reason ok --no-run-next >"$TMP_ROOT/$run_id.assist-signal-2.json"
  node "$ROOT/src/cli/index.ts" accept-proposal --repo "$repo" --step PD-C-5 --no-run-next >"$TMP_ROOT/$run_id.accept-proposal.json"
  grep -q '"to": "PD-C-6"' "$TMP_ROOT/$run_id.accept-proposal.json"
  grep -q '"current_step": "PD-C-6"' "$repo/.pdh-flow/runtime.json"
}

test_gate_baseline_rerun_requirement() {
  local repo run_id baseline_commit fake_claude
  repo="$(seed_repo gate-baseline)"
  fake_claude="$(write_fake_claude_pdc5_gate)"
  printf '\nGate baseline seed\n' >>"$repo/current-note.md"
  (
    cd "$repo"
    git add current-note.md tickets/runtime-test-note.md
    git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -m "[PD-C-4] Seed review baseline" >/dev/null
  )
  baseline_commit="$(cd "$repo" && git rev-parse HEAD)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-5 | sed -n '1p')"
  CLAUDE_BIN="$fake_claude" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" >/dev/null
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
  node "$ROOT/src/cli/index.ts" assist-signal --repo "$repo" --step PD-C-5 --signal propose-approve --reason "looks good" --no-run-next >/dev/null
  node -e "const fs=require('fs'); const gate=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(gate.rerun_requirement.target_step_id!=='PD-C-3') throw new Error('rerun requirement missing');" "$repo/.pdh-flow/runs/$run_id/steps/PD-C-5/human-gate.json"
  if node "$ROOT/src/cli/index.ts" accept-proposal --repo "$repo" --step PD-C-5 --no-run-next >"$TMP_ROOT/$run_id.accept-should-fail.txt" 2>&1; then
    echo "accept-proposal should fail when gate edits require rerun" >&2
    exit 1
  fi
  grep -q "require rerun from PD-C-3" "$TMP_ROOT/$run_id.accept-should-fail.txt"
}

test_assist_rerun_recommendation() {
  local repo run_id fake_claude
  repo="$(seed_repo assist-rerun)"
  fake_claude="$(write_fake_claude_pdc5_gate)"
  run_id="$(node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-5 | sed -n '1p')"
  CLAUDE_BIN="$fake_claude" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" >/dev/null
  node "$ROOT/src/cli/index.ts" assist-signal --repo "$repo" --step PD-C-5 --signal propose-rerun-from --target-step PD-C-4 --reason "plan changed after discussion" --no-run-next >"$TMP_ROOT/$run_id.rerun-recommendation.json"
  grep -q '"target_step_id": "PD-C-4"' "$TMP_ROOT/$run_id.rerun-recommendation.json"
  node "$ROOT/src/cli/index.ts" accept-proposal --repo "$repo" --step PD-C-5 --no-run-next >"$TMP_ROOT/$run_id.accept-rerun.json"
  grep -q '"to": "PD-C-4"' "$TMP_ROOT/$run_id.accept-rerun.json"
  grep -q '"current_step": "PD-C-4"' "$repo/.pdh-flow/runtime.json"
}

test_assist_answer_flow() {
  local repo run_id
  repo="$(seed_repo assist-answer)"
  run_id="$(advance_to_provider_step "$repo")"
  node "$ROOT/src/cli/index.ts" interrupt --repo "$repo" --message "Need a decision on integer rounding." >/dev/null
  node "$ROOT/src/cli/index.ts" assist-open --repo "$repo" --step PD-C-6 --prepare-only >"$TMP_ROOT/$run_id.assist-answer-open.json"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(data.allowedSignals.join(',')!=='answer') throw new Error('answer signal missing');" "$TMP_ROOT/$run_id.assist-answer-open.json"
  node "$ROOT/src/cli/index.ts" assist-signal --repo "$repo" --step PD-C-6 --signal answer --message "Keep integer arithmetic." --no-run-next >"$TMP_ROOT/$run_id.assist-answer.json"
  grep -q '"answered": "interrupt-' "$TMP_ROOT/$run_id.assist-answer.json"
  grep -q "Keep integer arithmetic." "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/interruptions/"*-answer.md
}

test_assist_failed_continue() {
  local repo run_id fake_fail fake_success args prompt_path
  repo="$(seed_repo assist-failed-continue)"
  run_id="$(advance_to_provider_step "$repo")"
  fake_fail="$(write_fake_codex_fail)"
  fake_success="$(write_fake_codex_success)"
  CODEX_BIN="$fake_fail" node "$ROOT/src/cli/index.ts" provider run --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >/dev/null || true
  node "$ROOT/src/cli/index.ts" assist-open --repo "$repo" --step PD-C-6 --prepare-only >"$TMP_ROOT/$run_id.assist-failed-open.json"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(data.allowedSignals.join(',')!=='continue') throw new Error('continue signal missing for failed state'); console.log(data.promptPath);" "$TMP_ROOT/$run_id.assist-failed-open.json" >"$TMP_ROOT/$run_id.assist-failed-prompt-path.txt"
  prompt_path="$(cat "$TMP_ROOT/$run_id.assist-failed-prompt-path.txt")"
  grep -q "Allowed signals now: continue" "$prompt_path"
  grep -q 'When the blocker is addressed, send `continue` so the runtime reruns PD-C-6 from the current step.' "$prompt_path"
  node "$ROOT/src/cli/index.ts" assist-signal --repo "$repo" --step PD-C-6 --signal continue --reason "edits are ready" --no-run-next >"$TMP_ROOT/$run_id.assist-failed-signal.json"
  grep -q '"pendingConfirmation": true' "$TMP_ROOT/$run_id.assist-failed-signal.json"
  grep -q '"status": "pending"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/assist/latest-signal.json"
  node "$ROOT/src/cli/index.ts" apply-assist-signal --repo "$repo" --step PD-C-6 --no-run-next >"$TMP_ROOT/$run_id.assist-failed-apply.json"
  grep -q '"status": "ok"' "$TMP_ROOT/$run_id.assist-failed-apply.json"
  grep -q '"status": "accepted"' "$repo/.pdh-flow/runs/$run_id/steps/PD-C-6/assist/latest-signal.json"
  grep -q '"status": "running"' "$repo/.pdh-flow/runtime.json"
  args="$TMP_ROOT/$run_id.assist-failed-rerun-args.txt"
  CODEX_BIN="$fake_success" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --force --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >/dev/null || true
  test -f "$args"
}

test_web_readonly() {
  local repo run_id fake args server_log server_pid url
  repo="$(seed_repo web)"
  run_id="$(advance_to_provider_step "$repo")"
  fake="$(write_fake_codex_success)"
  args="$TMP_ROOT/$run_id.web-args.txt"
  CODEX_BIN="$fake" FAKE_ARGS_FILE="$args" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" --max-attempts 1 --retry-backoff-ms 0 --timeout-ms 5000 >/dev/null || true
  server_log="$TMP_ROOT/web.log"
  node "$ROOT/src/cli/index.ts" web --repo "$repo" --host 127.0.0.1 --port 0 >"$server_log" 2>&1 &
  server_pid="$!"
  for _ in $(seq 1 50); do
    url="$(sed -n 's/^Web UI: //p' "$server_log" | tail -1)"
    if [ -n "$url" ]; then
      break
    fi
    sleep 0.1
  done
  if [ -z "$url" ]; then
    if grep -Eq 'listen (EPERM|EACCES)' "$server_log"; then
      kill "$server_pid" 2>/dev/null || true
      return 0
    fi
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
if (!state.current?.nextAction?.actions?.some((action) => action.kind === "run_next_direct")) throw new Error("run_next_direct action missing");
const gateStep = state.flow.variants.full.steps.find((step) => step.id === "PD-C-5");
if (!gateStep?.uiContract?.mustShow?.includes("変更対象")) throw new Error("gate diff contract missing");
if (!gateStep?.reviewDiff?.baseLabel) throw new Error("gate diff summary missing");
const mermaid = await (await fetch(`${url}api/flow.mmd`)).text();
if (!mermaid.includes("PD-C-6") || !mermaid.includes("実装")) throw new Error("mermaid flow labels missing");
  const html = await (await fetch(`${url}?assist=manual`)).text();
if (!html.includes("PDH Dev Dashboard")) throw new Error("html shell missing");
if (html.includes("flow-toggle")) throw new Error("flow toggle should not be rendered");
if (!html.includes('id="root"')) throw new Error("SPA root element missing");
const mutation = await fetch(`${url}api/state`, { method: "POST" });
if (mutation.status !== 405) throw new Error(`mutation endpoint should be rejected, got ${mutation.status}`);
NODE
  curl -s "${url}api/render-mermaid?code=graph%20TD%0AA--%3EB" | rg -q "<svg"
  curl -s "${url}api/diff?step=PD-C-5" | rg -q "\"baseLabel\":\""
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}

# Note-frontmatter overrides: variant edit-mode, edit-step agent
# override, review-step roster override, and lock violation. These
# stay at the loadRuntime + resolveStepAgent layer (no provider spawn)
# so they're fast and don't need fake-* fixtures.

test_note_frontmatter_variant_override() {
  local repo
  repo="$(seed_repo note-fm-variant)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node --input-type=module -e "
    import { writeNoteOverrides } from '$ROOT/src/repo/note-overrides.ts';
    import { loadRuntime } from '$ROOT/src/runtime/state.ts';
    writeNoteOverrides('$repo', { flow_variant: 'light' });
    const r = loadRuntime('$repo');
    if (r.run.flow_variant !== 'light') throw new Error('expected light, got ' + r.run.flow_variant);
    if (r.run.flow_variant_locked !== false) throw new Error('expected unlocked');
  "
}

test_note_frontmatter_agent_override_edit() {
  local repo
  repo="$(seed_repo note-fm-edit)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node --input-type=module -e "
    import { writeNoteOverrides } from '$ROOT/src/repo/note-overrides.ts';
    import { loadRuntime } from '$ROOT/src/runtime/state.ts';
    import { resolveStepAgent } from '$ROOT/src/runtime/providers/agent-resolution.ts';
    writeNoteOverrides('$repo', { agent_overrides: { 'PD-C-6': { provider: 'claude', model: 'opus' } } });
    const r = loadRuntime('$repo');
    const step = { id: 'PD-C-6', mode: 'edit' };
    const agent = resolveStepAgent({ flow: r.flow, runtimeRun: r.run, step });
    if (agent.kind !== 'edit') throw new Error('expected edit, got ' + agent.kind);
    if (agent.provider !== 'claude') throw new Error('expected claude, got ' + agent.provider);
    if (agent.model !== 'opus') throw new Error('expected opus, got ' + agent.model);
  "
}

test_note_frontmatter_agent_override_review() {
  local repo
  repo="$(seed_repo note-fm-review)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node --input-type=module -e "
    import { writeNoteOverrides } from '$ROOT/src/repo/note-overrides.ts';
    import { loadRuntime } from '$ROOT/src/runtime/state.ts';
    import { resolveStepAgent } from '$ROOT/src/runtime/providers/agent-resolution.ts';
    writeNoteOverrides('$repo', {
      agent_overrides: {
        'PD-C-7': {
          aggregator: { provider: 'claude', model: 'opus' },
          repair: { provider: 'codex' },
          reviewers: [{ role: 'critical', provider: 'codex', count: 1 }]
        }
      }
    });
    const r = loadRuntime('$repo');
    const step = { id: 'PD-C-7', mode: 'review' };
    const agent = resolveStepAgent({ flow: r.flow, runtimeRun: r.run, step });
    if (agent.kind !== 'review') throw new Error('expected review');
    if (agent.aggregator?.provider !== 'claude') throw new Error('aggregator provider mismatch');
    if (agent.aggregator?.model !== 'opus') throw new Error('aggregator model mismatch');
    if (agent.repair?.provider !== 'codex') throw new Error('repair provider mismatch');
    if (agent.reviewers.length !== 1) throw new Error('reviewers should be replaced wholesale');
    if (agent.reviewers[0].provider !== 'codex') throw new Error('reviewer provider mismatch');
  "
}

test_note_frontmatter_lock_violation() {
  local repo
  repo="$(seed_repo note-fm-lock)"
  node "$ROOT/src/cli/index.ts" run --repo "$repo" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null
  node --input-type=module -e "
    import { writeNoteOverrides } from '$ROOT/src/repo/note-overrides.ts';
    import { loadRuntime } from '$ROOT/src/runtime/state.ts';
    // Simulate the post-PD-C-3 state: variant locked, pdh-meta variant=full
    writeNoteOverrides('$repo', { flow_variant: 'full', flow_variant_locked: true });
    let r = loadRuntime('$repo');
    if (r.run.flow_variant !== 'full') throw new Error('locked baseline should be full');
    if (r.run.flow_variant_locked !== true) throw new Error('lock flag should be true');
    // User edits note to flip the variant; runtime ignores it and warns
    writeNoteOverrides('$repo', { flow_variant: 'light', flow_variant_locked: true });
    r = loadRuntime('$repo');
    if (r.run.flow_variant !== 'full') throw new Error('locked variant must stay full, got ' + r.run.flow_variant);
    const warnings = r.run.note_overrides_warnings || [];
    if (!warnings.some((w) => /flow_variant_locked/.test(w))) {
      throw new Error('expected lock-violation warning, got ' + JSON.stringify(warnings));
    }
  "
}

seed_repo_with_epic() {
  local name="$1"
  local repo="$TMP_ROOT/$name"
  cp -R "$ROOT/examples/sample1" "$repo"
  cd "$repo"
  git init -q -b main
  git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" add .
  git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -qm "Seed runtime fixture"
  mkdir -p epics
  cat >epics/test-epic.md <<'EPIC'
---
title: Test Epic for runtime close-flow test
created_at: 2026-05-06T00:00:00Z
branch: main
---

### Outcome

Runtime fixture for PD-D-* + finalize-epic close-flow.

### Exit Criteria

- All linked tickets are closed.
EPIC
  git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" add epics/
  git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -qm "Add test-epic"
  printf '%s\n' "$repo"
}

write_fake_claude_pd_d() {
  # Generic PD-D-* fake claude. Detects step from prompt and emits
  # the matching note section + ui-output.json. judgement.kind /
  # status hardcoded to the success path of each step.
  local path="$TMP_ROOT/fake-claude-pd-d-$$.sh"
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
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write valid JSON to `\([^`]*ui-output.json\)`\.$/\1/p; s/^`\([^`]*ui-output.json\)` に妥当な JSON を書く。$/\1/p' | head -1)"
step=""
case "$ui_path" in
  *"/PD-D-1/"*) step="PD-D-1" ;;
  *"/PD-D-3/"*) step="PD-D-3" ;;
  *"/PD-D-4/"*) step="PD-D-4" ;;
esac
case "$step" in
  PD-D-1)
    section="PD-D-1. Exit Criteria 裏取り"
    judgement_kind="exit-criteria-verification"
    judgement_status="verified"
    summary="1 / 1 verified"
    ;;
  PD-D-3)
    section="PD-D-3. UCS テスト結果"
    judgement_kind="ucs-test"
    judgement_status="pass"
    summary="UCS pass"
    ;;
  PD-D-4)
    section="PD-D-4. Epic クローズ準備"
    judgement_kind="epic-close-gate"
    judgement_status="Ready"
    summary="Epic Close Summary ready"
    ;;
  *)
    echo "fake-claude-pd-d: unknown step (ui_path=$ui_path)" >&2
    exit 2
    ;;
esac
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<JSON
{
  "summary": ["$summary"],
  "risks": [],
  "notes": "fake $step result",
  "judgement": {
    "kind": "$judgement_kind",
    "status": "$judgement_status",
    "summary": "fake $step pass"
  }
}
JSON
fi
if [ -f current-note.md ]; then
  cat >>current-note.md <<NOTE

## $section

- fake $step note section (test fixture)
NOTE
fi
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-session"}'
printf '%s\n' '{"type":"assistant","message":{"content":"fake '"$step"' done"}}'
printf '%s\n' '{"type":"result","subtype":"success","result":"fake '"$step"' done"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

test_epic_close_full_flow() {
  # End-to-end: start-epic → PD-D-1 → PD-D-3 → PD-D-4 (human approve)
  # → finalizeEpicCompletedRun → finalize-epic auto-fires → epic file
  # moved to epics/done/<slug>/index.md, main has squash commit.
  local repo
  repo="$(seed_repo_with_epic epic-close-full-flow)"
  local fake
  fake="$(write_fake_claude_pd_d)"

  node "$ROOT/src/cli/index.ts" start-epic --epic test-epic --repo "$repo" --variant light >"$TMP_ROOT/epic-close.start.txt"
  grep -q "^run-" "$TMP_ROOT/epic-close.start.txt"

  # run-next cascades through PD-D-1 → PD-D-3 → PD-D-4 in one invocation
  # because none of those steps have a non-human gate that pauses the
  # runtime; PD-D-4 is the first humanGate that stops cascade.
  CLAUDE_BIN="$fake" node "$ROOT/src/cli/index.ts" run-next --repo "$repo" >"$TMP_ROOT/epic-close.cascade.txt"
  grep -q '"current_step": "PD-D-4"' "$repo/.pdh-flow/runtime.json"

  # Approve → next run-next fires finalizeEpicCompletedRun → finalize-epic
  node "$ROOT/src/cli/index.ts" approve --repo "$repo" --step PD-D-4 --reason ok >/dev/null
  node "$ROOT/src/cli/index.ts" run-next --repo "$repo" >"$TMP_ROOT/epic-close.finalize.txt"

  # Verify finalize-epic side effects
  test -f "$repo/epics/done/test-epic/index.md" || {
    echo "epics/done/test-epic/index.md not created" >&2
    cat "$TMP_ROOT/epic-close.finalize.txt" >&2
    return 1
  }
  if [ -f "$repo/epics/test-epic.md" ]; then
    echo "epics/test-epic.md was not removed" >&2
    return 1
  fi
  # `git log | grep -q` exits 141 under set -o pipefail because grep -q
  # closes the pipe early — capture the log and grep separately.
  log_oneline="$(git -C "$repo" log --oneline)"
  printf '%s\n' "$log_oneline" | grep -q "Close epic test-epic"
}

TESTS=(
  test_frontmatter_run
  test_note_frontmatter_variant_override
  test_note_frontmatter_agent_override_edit
  test_note_frontmatter_agent_override_review
  test_note_frontmatter_lock_violation
  test_nested_section_guard
  test_recorded_step_commit_guard
  test_step_commit_guard_fails_without_record
  test_reviewer_placeholder_sanitization
  test_replace_note_section_with_nested_headings
  test_prompt_context
  test_stop_after_step
  test_blocked_run
  test_auto_provider_run
  test_runtime_auto_commits_when_provider_does_not
  test_runtime_respects_provider_self_commit
  test_auto_review_judgement
  test_review_loop_auto_repair
  test_review_reviewer_failed_marks_attempt_failed
  test_review_aggregator_failed_marks_attempt_failed
  test_review_repair_commit_required_triggers_rerun_from
  test_review_force_rerun_after_max_in_place_repairs
  test_blocked_run_does_not_silently_rerun
  test_failed_run
  test_auto_resume_after_idle_timeout
  test_review_guard_auto_repair
  test_stale_normalization_respects_step_finished
  test_supervisor_running_blocks_stale_normalization
  test_supervisor_stale_without_attempt_keeps_run_running
  test_supervisor_stale_with_running_attempt_abandons_attempt
  test_supervisor_stale_after_completed_attempt_keeps_running
  test_review_judgement_accepted_recovers_failed_run
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
  test_epic_close_full_flow
)

# Worker mode: run a single test in isolation. Invoked by the orchestrator
# below via `bash $0 --worker <fn>` so each worker has its own PID (and
# therefore its own fake-* script paths, captured via $$ in write_fake_*).
if [ "${1:-}" = "--worker" ]; then
  fn="$2"
  if "$fn" >"$LOG_DIR/$fn.stdout" 2>"$LOG_DIR/$fn.stderr"; then
    printf 'ok   %s\n' "$fn"
    exit 0
  fi
  rc=$?
  printf 'FAIL %s rc=%d\n' "$fn" "$rc"
  {
    printf '\n=== FAIL %s rc=%d ===\n' "$fn" "$rc"
    printf '%s\n' '--- stdout ---'
    cat "$LOG_DIR/$fn.stdout" 2>/dev/null || true
    printf '\n%s\n' '--- stderr ---'
    cat "$LOG_DIR/$fn.stderr" 2>/dev/null || true
  } >&2
  exit "$rc"
fi

# Orchestrator: PARALLEL=1 forces sequential mode (useful when debugging
# state ordering). Default to nproc.
PARALLEL="${PARALLEL:-$(nproc 2>/dev/null || echo 4)}"
if [ "$PARALLEL" -le 1 ]; then
  for fn in "${TESTS[@]}"; do "$fn"; done
else
  printf '%s\n' "${TESTS[@]}" | \
    PDH_TEST_WORKER=1 TMP_ROOT="$TMP_ROOT/workers" \
    xargs -P "$PARALLEL" -I{} bash "$0" --worker {}
fi

echo "runtime tests passed"
