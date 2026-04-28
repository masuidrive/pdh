# pdh-flow

`pdh-flow` is a repo-centric runtime for executing the PD-C ticket flow with explicit gates, transient local artifacts, and a viewer-first progress UI with stop-state assist launch.

## Core Model

- `current-note.md` frontmatter is the canonical runtime state.
- `current-ticket.md` is the durable ticket record for Why / What / Product AC / Implementation Notes.
- `.pdh-flow/` holds transient prompts, raw provider logs, gate summaries, interruptions, and other local artifacts. It is not committed.
- The CLI operates on a repo, not on a separate SQLite run database.
- The Web UI is viewer-first. It can launch a stop-state assist terminal, but runtime decisions and execution still stay in CLI commands or assist signals.
- Runtime semantics are owned by this repo's flow YAML and prompt/runtime code. `pdh-dev` and `tmux-director` are not runtime dependencies.
- Reviewer rosters, review-loop pass conditions, and review-step intent are also defined in this repo's flow YAML and compiled into provider prompts.
- Review steps execute their configured reviewer roster in parallel, and the runtime aggregates those reviewer outputs into note sections, UI output, and guard-facing judgements.
- When review steps still have blocking findings, the runtime can run bounded repair rounds and re-run the same reviewer roster before escalating back to the user.

## Local Setup

Source nvm before Node or provider commands:

```sh
source /home/masuidrive/.nvm/nvm.sh
```

Provider commands load `.env` from the repo root. `.env` is ignored by git and may contain `OPENAI_API_KEY`.

By default, both Codex and Claude run in bypass mode for provider steps. Use `--bypass=false` or an explicit Claude `--permission-mode` only when intentionally debugging permission behavior.

## Common Commands

```sh
node src/cli.mjs init --repo .
node src/cli.mjs run --repo . --ticket ticket-id --variant full
node src/cli.mjs status --repo .
node src/cli.mjs run-next --repo .
node src/cli.mjs run-next --repo . --stop-after-step
node src/cli.mjs run-next --repo . --manual-provider
node src/cli.mjs run-provider --repo .
node src/cli.mjs resume --repo .
node src/cli.mjs show-gate --repo .
node src/cli.mjs approve --repo . --step PD-C-5 --reason ok
node src/cli.mjs assist-open --repo .
node src/cli.mjs assist-signal --repo . --signal continue --reason "ready"
node src/cli.mjs interrupt --repo . --message "Need clarification"
node src/cli.mjs answer --repo . --message "Use the existing fallback"
node src/provider-cli.mjs ask --repo . --message "Need clarification"
node src/cli.mjs prompt --repo .
node src/cli.mjs metadata --repo .
node src/cli.mjs flow --variant full
node src/cli.mjs flow-graph --repo . --variant full
node src/cli.mjs web --repo . --host 0.0.0.0 --port 8765
node src/cli.mjs smoke-calc
npm run check
npm run test:runtime
```

## Typical Flow

### 1. Start a ticket

```sh
node src/cli.mjs run --repo . --ticket calc-cli --variant full
```

Output:

```text
run-20260424022333-726697
Current step: PD-C-2 調査
Next: node src/cli.mjs run-next --repo /path/to/repo
```

The first line still prints the transient artifact run id, but normal operation after that is repo-centric.

### 2. Let the runtime advance

```sh
node src/cli.mjs run-next --repo .
```

This auto-runs provider steps until one of these happens:

- a human gate opens
- an interruption needs an answer
- a guard fails
- a provider run fails
- the flow completes

### 3. Human gate

When a gate opens:

```text
{
  "status": "needs_human",
  "stepId": "PD-C-5",
  "summary": "/path/to/repo/.pdh-flow/runs/.../steps/PD-C-5/human-gate-summary.md",
  "nextCommands": [
    "node src/cli.mjs approve --repo /path/to/repo --step PD-C-5 --reason ok"
  ]
}
```

Review the summary, then decide in the terminal:

```sh
node src/cli.mjs show-gate --repo .
node src/cli.mjs assist-open --repo .
./.pdh-flow/bin/assist-signal --step PD-C-5 --signal recommend-approve --reason "ready to implement"
node src/cli.mjs accept-recommendation --repo . --step PD-C-5
```

If you want a fresh Claude session to discuss code or run tests before deciding, use `assist-open`. It prepares repo-local wrappers:

- `./.pdh-flow/bin/assist-signal`
- `./.pdh-flow/bin/assist-test`

The assist session stays in the same repo checkout, but the runtime still owns progression. At human gates the assist should hand control back with a single recommendation signal, and the user then confirms it with `accept-recommendation` or sends it back with `decline-recommendation`.

### 4. Exactly one completed step

If you want a demo that stops before the next provider starts:

```sh
node src/cli.mjs run-next --repo . --stop-after-step
```

Output:

```text
Stopped After Step: PD-C-5 -> PD-C-6
Current step: PD-C-6 実装
Next: node src/cli.mjs run-next --repo /path/to/repo
```

### 5. Provider debugging

Normally you should keep using `run-next`. For step-level debugging:

```sh
node src/cli.mjs run-provider --repo .
node src/cli.mjs resume --repo .
node src/cli.mjs prompt --repo .
```

Provider retries now reuse the latest saved session automatically when a retry happens after a failed or timed-out attempt. The runtime also saves the provider session id as soon as the CLI emits it, so `resume` can work even when a provider stalled before clean exit. Use `--idle-timeout-ms` to shorten or disable the no-output stall detector for debugging.

### 6. Stop-state assist

When a step is in `needs_human`, `interrupted`, or `blocked`, you can open a fresh Claude assist session:

```sh
node src/cli.mjs assist-open --repo .
```

For non-interactive use, prepare the prompt and wrapper scripts without launching Claude:

```sh
node src/cli.mjs assist-open --repo . --prepare-only
```

The assist session is hardened for this use case:

- disables slash commands
- loads user settings only
- tells Claude not to follow repo-local PDH automation docs for progression
- tells Claude to hand control back with `./.pdh-flow/bin/assist-signal`

At human gates, the expected pattern is:

1. assist edits, verifies, and decides the next move
2. assist emits one recommendation signal such as:

```sh
./.pdh-flow/bin/assist-signal --step PD-C-5 --signal recommend-rerun-from --target-step PD-C-4 --reason "plan changed after app review"
```

3. the user answers Yes or No by running:

```sh
node src/cli.mjs accept-recommendation --repo . --step PD-C-5
node src/cli.mjs decline-recommendation --repo . --step PD-C-5 --reason "keep working"
```

## Prompt Model

Provider prompts now include:

- run context
- step instructions
- compiled semantic rules from `flows/pdh-ticket-core.yaml`
- required guards
- canonical file paths for `current-ticket.md` and `current-note.md`
- a YAML contract for step-local UI output written to `.pdh-flow/.../ui-output.yaml`
- a review-step judgement block in `ui-output.yaml` when the step guard requires one

They do not inline the full contents of `current-ticket.md` or `current-note.md`.

## Canonical Files

### `current-ticket.md`

Durable ticket record:

- Why
- What
- Product AC
- Implementation Notes
- Related Links

### `current-note.md`

Process record:

- frontmatter runtime state
- PD-C step sections
- AC verification table
- discoveries
- step history

Frontmatter shape:

```yaml
---
pdh:
  ticket: calc-cli
  flow: pdh-ticket-core
  variant: full
  status: running
  current_step: PD-C-3
  run_id: run-20260424022333-726697
  started_at: 2026-04-24T02:23:33.060Z
  updated_at: 2026-04-24T02:23:33.060Z
---
```

## Local Artifact Layout

```text
.pdh-flow/
  locks/
  runs/
    run-20260424022333-726697/
      progress.jsonl
      steps/
        PD-C-5/
          human-gate-summary.md
          human-gate.json
          assist/
            manifest.yaml
            prompt.md
            system-prompt.txt
            session.json
            signals.jsonl
        PD-C-6/
          prompt.md
          ui-output.yaml
          ui-runtime.yaml
          attempt-1/
            codex.raw.jsonl
            result.json
            note-ticket.patch
```

These files are local evidence only. The canonical runtime state stays in `current-note.md`.

## Cleanup Rule

Before close, the runtime appends durable step-history lines to `current-note.md` and removes the local `.pdh-flow/runs/<run-id>/` artifacts. The repo should retain:

- code changes
- `current-ticket.md`
- `current-note.md`
- normal git history

It should not retain transient provider logs or prompts.

## Web UI

```sh
node src/cli.mjs web --repo . --host 0.0.0.0 --port 8765
```

The UI shows:

- current step and next CLI action
- the active flow variant for the current run
- per-step progress
- step-specific viewer / decision contract from flow YAML
- provider-written semantic UI output from `ui-output.yaml`
- runtime-written fact summary from `ui-runtime.yaml`
- clickable detail rows for `mustShow` items backed by note, ticket, gate, or runtime evidence
- gate or interruption state
- recent events
- step artifacts
- git diff summary

It does not execute providers or record decisions.

## Example Fixture

`examples/fake-pdh-dev` is a tiny throwaway repo for user-flow checks. It starts with a working `uv run calc "1+2"` path and a failing multiplication AC.

See [examples/fake-pdh-dev/README.md](examples/fake-pdh-dev/README.md) for a complete repo-centric walkthrough.

## Current Scope

- Full `pdh-ticket-core` flow is the baseline; Light remains a supported variant.
- Codex and Claude adapters save raw JSONL logs under `.pdh-flow/`.
- Guards validate note sections, ticket sections, commits, commands, AC tables, and human approvals.
- `run-next` is the main user command.
- Human gates and interruptions are explicit blocking states.
- `current-note.md` frontmatter replaces the old SQLite / metadata-block state model.
- The Web UI stays viewer-first and follows the repo-centric CLI. Its only direct action is launching a stop-state assist terminal.
- Providers should not drive runtime progression directly. When a provider needs one precise user answer, it should call `node src/provider-cli.mjs ask --repo . --message "..."` and stop.

## Deferred

- Dockerized execution and hardening
- Epic flow support
- richer review schemas
