# pdh-flowchart

`pdh-flowchart` is a repo-centric runtime for executing the PD-C ticket flow with explicit gates, transient local artifacts, and a read-only progress UI.

## Core Model

- `current-note.md` frontmatter is the canonical runtime state.
- `current-ticket.md` is the durable ticket record for Why / What / Product AC / Implementation Notes.
- `.pdh-flowchart/` holds transient prompts, raw provider logs, gate summaries, interruptions, and other local artifacts. It is not committed.
- The CLI operates on a repo, not on a separate SQLite run database.
- The Web UI is read-only. Decisions and execution stay in the CLI.
- Runtime semantics are owned by this repo's flow YAML and prompt/runtime code. `pdh-dev` and `tmux-director` are not runtime dependencies.
- Reviewer rosters, review-loop pass conditions, and review-step intent are also defined in this repo's flow YAML and compiled into provider prompts.
- Review steps execute their configured reviewer roster in parallel, and the runtime aggregates those reviewer outputs into note sections, UI output, and guard-facing judgements.

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
node src/cli.mjs interrupt --repo . --message "Need clarification"
node src/cli.mjs answer --repo . --message "Use the existing fallback"
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
  "summary": "/path/to/repo/.pdh-flowchart/runs/.../steps/PD-C-5/human-gate-summary.md",
  "nextCommands": [
    "node src/cli.mjs approve --repo /path/to/repo --step PD-C-5 --reason ok"
  ]
}
```

Review the summary, then decide in the terminal:

```sh
node src/cli.mjs show-gate --repo .
node src/cli.mjs approve --repo . --step PD-C-5 --reason ok
node src/cli.mjs run-next --repo .
```

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

## Prompt Model

Provider prompts now include:

- run context
- step instructions
- compiled semantic rules from `flows/pdh-ticket-core.yaml`
- required guards
- canonical file paths for `current-ticket.md` and `current-note.md`
- a YAML contract for step-local UI output written to `.pdh-flowchart/.../ui-output.yaml`
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
.pdh-flowchart/
  locks/
  runs/
    run-20260424022333-726697/
      progress.jsonl
      steps/
        PD-C-5/
          human-gate-summary.md
          human-gate.json
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

Before close, the runtime appends durable step-history lines to `current-note.md` and removes the local `.pdh-flowchart/runs/<run-id>/` artifacts. The repo should retain:

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
- Codex and Claude adapters save raw JSONL logs under `.pdh-flowchart/`.
- Guards validate note sections, ticket sections, commits, commands, AC tables, and human approvals.
- `run-next` is the main user command.
- Human gates and interruptions are explicit blocking states.
- `current-note.md` frontmatter replaces the old SQLite / metadata-block state model.
- The Web UI is read-only and follows the repo-centric CLI.

## Deferred

- Dockerized execution and hardening
- Epic flow support
- richer review schemas
