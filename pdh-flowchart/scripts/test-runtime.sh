#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/pdh-flowchart-runtime-tests"
rm -rf "$TMP_ROOT"
mkdir -p "$TMP_ROOT"

seed_repo() {
  local name="$1"
  local repo="$TMP_ROOT/$name"
  cp -R "$ROOT/examples/fake-pdh-dev" "$repo"
  cd "$repo"
  git init >/dev/null
  git add .
  git -c user.name="pdh runtime test" -c user.email="pdh-runtime@example.invalid" commit -m "Seed runtime fixture" >/dev/null
  printf '%s\n' "$repo"
}

advance_to_provider_step() {
  local repo="$1"
  local run_id
  run_id="$(node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --variant light --start-step PD-C-5 | sed -n '1p')"
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
printf '%s\n' "$@" > "${FAKE_ARGS_FILE:?}"
prompt="$(cat || true)"
ui_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write plain YAML to `\([^`]*ui-output.yaml\)`\.$/\1/p' | head -1)"
if [ -n "$ui_path" ]; then
  mkdir -p "$(dirname "$ui_path")"
  cat >"$ui_path" <<'YAML'
summary:
  - fake provider summary
risks:
  - fake provider risk
ready_when:
  - fake provider ready condition
notes: |
  fake notes
YAML
fi
printf '%s\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\n' '{"type":"turn.completed","final_message":"fake success"}'
SH
  chmod +x "$path"
  printf '%s\n' "$path"
}

test_frontmatter_run() {
  local repo
  repo="$(seed_repo frontmatter)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --variant full --start-step PD-C-3 >"$TMP_ROOT/frontmatter.run.txt"
  grep -q "^run-" "$TMP_ROOT/frontmatter.run.txt"
  grep -q "current_step: PD-C-3" "$repo/current-note.md"
  grep -q "run_id: run-" "$repo/current-note.md"
}

test_prompt_context() {
  local repo prompt_path
  repo="$(seed_repo prompt-context)"
  node "$ROOT/src/cli.mjs" run --repo "$repo" --ticket runtime-test --variant full --start-step PD-C-3 >/dev/null
  prompt_path="$(node "$ROOT/src/cli.mjs" prompt --repo "$repo")"
  grep -q "## Canonical Files" "$prompt_path"
  grep -q "current-note.md frontmatter is the canonical runtime state" "$prompt_path"
  grep -q "Required references: (none)" "$prompt_path"
  grep -q "## UI Output Artifact" "$prompt_path"
  grep -q "ui-output.yaml" "$prompt_path"
  if grep -q "## current-ticket.md" "$prompt_path"; then
    echo "prompt should not inline current-ticket.md" >&2
    exit 1
  fi
}

test_stop_after_step() {
  local repo run_id
  repo="$(seed_repo stop-after-step)"
  run_id="$(advance_to_provider_step "$repo")"
  grep -q "Stopped After Step: PD-C-5 -> PD-C-6" "$TMP_ROOT/$run_id.stop.txt"
  grep -q "current_step: PD-C-6" "$repo/current-note.md"
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
  test -f "$repo/.pdh-flowchart/runs/$run_id/steps/PD-C-6/ui-output.yaml"
  test -f "$repo/.pdh-flowchart/runs/$run_id/steps/PD-C-6/ui-runtime.yaml"
  grep -q "guard_failed" "$TMP_ROOT/$run_id.auto-provider.txt"
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

  node "$ROOT/src/cli.mjs" interrupt --repo "$repo" --message "Should multiplication use integer arithmetic?" >"$TMP_ROOT/$run_id.interrupt.txt"
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
if (state.mode !== "read-only") throw new Error("web mode is not read-only");
if (!state.runtime.run) throw new Error("run missing from web state");
if (!state.flow.variants.full.steps.some((step) => step.id === "PD-C-6" && step.label === "実装")) throw new Error("flow labels missing");
const implementation = state.flow.variants.light.steps.find((step) => step.id === "PD-C-6");
if (!implementation?.uiContract?.viewer) throw new Error("ui contract missing");
if (!implementation?.uiOutput?.summary?.includes("fake provider summary")) throw new Error("ui output missing");
if (!implementation?.uiRuntime?.changedFiles?.includes("current-note.md")) throw new Error("ui runtime missing changed files");
if (!state.current.nextAction.commands.some((command) => command.includes("run-next"))) throw new Error("next action command missing");
const mermaid = await (await fetch(`${url}api/flow.mmd`)).text();
if (!mermaid.includes("PD-C-6") || !mermaid.includes("実装")) throw new Error("mermaid flow labels missing");
const html = await (await fetch(url)).text();
if (!html.includes("PDH Dev Dashboard")) throw new Error("html shell missing");
const mutation = await fetch(`${url}api/state`, { method: "POST" });
if (mutation.status !== 405) throw new Error(`mutation endpoint should be rejected, got ${mutation.status}`);
NODE
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}

test_frontmatter_run
test_prompt_context
test_stop_after_step
test_blocked_run
test_auto_provider_run
test_failed_run
test_resumed_run
test_interrupted_run
test_web_readonly

echo "runtime tests passed"
