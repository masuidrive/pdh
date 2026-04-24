# pdh-flowchart Technical Plan

更新日: 2026-04-24

## 1. Architecture Decision

### Adopted

- Canonical runtime state lives in `current-note.md` frontmatter.
- Durable ticket intent lives in `current-ticket.md`.
- `.pdh-flowchart/` stores transient local artifacts only.
- CLI commands are repo-centric.
- Web UI is read-only and derives state from note frontmatter plus transient artifacts.
- Flow semantics are internalized in this repo; runtime execution does not depend on external `pdh-dev` or `tmux-director` skills.
- Review-step orchestration semantics (reviewer roster, pass conditions, loop-back intent) are defined in flow YAML and compiled into runtime-owned prompts.
- Review-step reviewer rosters execute in parallel and are aggregated by the runtime into canonical note sections and structured judgement artifacts.

### Rejected

- SQLite or any separate state store as canonical state
- project-specific context YAML
- mirroring runtime state into multiple sources

The reason is straightforward: human interruptions and gate decisions change the meaning of the active ticket in real time. `current-note.md` and `current-ticket.md` already carry that meaning. Adding another state source creates divergence instead of clarity.

## 2. Data Model

### 2.1 Canonical files

#### `current-note.md`

Frontmatter:

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
  completed_at: null
---
```

Body:

- PD-C step sections
- AC verification table
- discoveries
- step history

#### `current-ticket.md`

- Why
- What
- Product AC
- Implementation Notes
- Related Links

No runtime metadata is written to this file.

### 2.2 Transient artifact layout

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
        PD-C-7/
          judgements/
            quality_review.json
        PD-C-10/
          human-gate-summary.md
          human-gate.json
```

These files are used for:

- logs
- resume tokens
- gate summaries
- interruptions
- note/ticket diffs
- transient diagnostics

They are not authoritative.

## 3. Runtime Modules

### `src/note-state.mjs`

Responsibilities:

- parse and write note frontmatter
- migrate the old metadata block into frontmatter
- update note sections
- append step-history lines

### `src/runtime-state.mjs`

Responsibilities:

- load repo runtime context from note frontmatter
- initialize a run
- update repo-centric run state
- append progress events
- manage step attempts and provider session metadata
- manage human gate artifacts
- clean transient run artifacts

### `src/cli.mjs`

Responsibilities:

- repo-centric user commands
- provider execution
- guard evaluation
- run-next loop
- human gates and interruptions
- final cleanup / close behavior

### `src/web-server.mjs`

Responsibilities:

- read-only API and dashboard
- current step and next action presentation
- step progress display for Full / Light variants
- event, artifact, and diff summaries
- right-panel merge of flow YAML contract, provider UI output, and runtime UI facts

## 4. CLI Surface

Primary commands:

```sh
node src/cli.mjs run --repo . --ticket ticket-id --variant full
node src/cli.mjs run-next --repo .
node src/cli.mjs status --repo .
node src/cli.mjs run-provider --repo .
node src/cli.mjs resume --repo .
node src/cli.mjs show-gate --repo .
node src/cli.mjs approve --repo . --step PD-C-5 --reason ok
node src/cli.mjs interrupt --repo . --message "..."
node src/cli.mjs answer --repo . --message "..."
node src/cli.mjs assist-open --repo .
node src/cli.mjs assist-signal --repo . --signal continue --reason "..."
```

Design intent:

- `run-next` is the default control surface
- `run-provider` and `resume` are debug / recovery commands
- `approve` / `reject` / `request-changes` resolve explicit human gates
- `assist-open` starts a fresh stop-state Claude session in the same repo checkout
- `assist-signal` is the only supported way for that assist session to hand control back to the runtime

## 5. Provider Execution

Codex and Claude stay on CLI adapters for now.

Default execution policy:

- Codex runs with bypass enabled unless `--bypass=false` is explicitly passed.
- Claude runs with `bypassPermissions` unless `--bypass=false` or an explicit `--permission-mode` is passed.

Persisted per attempt:

- raw JSONL log
- normalized progress events
- provider session id or resume token
- result metadata
- note/ticket patch proposal when canonical files changed
- provider-written `ui-output.yaml`
- runtime-written `ui-runtime.yaml`

## 6. Prompt Construction

The prompt includes:

- run context
- step instructions
- compiled semantic rules from `flows/pdh-ticket-core.yaml`
- required guards
- canonical file references for `current-ticket.md` and `current-note.md`
- a YAML contract for `.pdh-flowchart/.../ui-output.yaml`
- a required judgement payload for review steps whose guards consume judgement artifacts

The prompt does not inline the full contents of canonical files. The provider is expected to read those files directly inside the repo.

## 7. Guard Evaluation

Guard types still include:

- note section updated
- ticket section updated
- git commit exists
- command
- AC verification table
- artifact exists
- human approved
- judgement status

The runtime evaluates guards directly against:

- repo files
- current human gate artifact
- judgement artifacts
- transient local artifacts

## 8. Human Gates and Interruptions

### Human gate

1. `run-next` reaches a human step
2. runtime writes `human-gate-summary.md`
3. runtime writes `human-gate.json`
4. note frontmatter status becomes `needs_human`
5. user decides in CLI directly, or opens `assist-open` and later hands back control with `assist-signal`
6. next `run-next` advances based on the decision

### Interruption

1. user or runtime writes an interruption artifact
2. note frontmatter status becomes `interrupted`
3. provider execution is blocked
4. `answer` or `assist-signal --signal answer` resolves the latest open interruption
5. next provider prompt includes answered interruption context

### Stop-state assist

When the run is `needs_human`, `interrupted`, or `blocked`, the runtime can prepare a fresh Claude assist session in the same repo checkout.

Artifacts:

- `.pdh-flowchart/runs/<run-id>/steps/<step-id>/assist/manifest.yaml`
- `.pdh-flowchart/runs/<run-id>/steps/<step-id>/assist/prompt.md`
- `.pdh-flowchart/runs/<run-id>/steps/<step-id>/assist/system-prompt.txt`
- `.pdh-flowchart/runs/<run-id>/steps/<step-id>/assist/session.json`
- `.pdh-flowchart/runs/<run-id>/steps/<step-id>/assist/signals.jsonl`

Wrapper scripts:

- `./.pdh-flowchart/bin/assist-signal`
- `./.pdh-flowchart/bin/assist-test`

Runtime guarantees:

- the assist runs fresh and is not a continuation of the provider session
- the prompt tells Claude not to advance PDH flow directly
- progression still happens through runtime state updates plus `run-next`

## 9. Cleanup and Close

At `PD-C-10` approval:

1. append durable step-history lines to `current-note.md`
2. remove `.pdh-flowchart/runs/<run-id>/`
3. run `ticket.sh close` when available
4. mark note frontmatter `status: completed`
5. clear `run_id`

This keeps the repo with one durable story:

- code
- ticket
- note
- git history

and removes transient execution noise.

## 10. Verification Strategy

Routine checks:

```sh
source /home/masuidrive/.nvm/nvm.sh
npm run check
npm run test:runtime
```

User-flow checks:

- fixture repo with light flow
- gate open / approve / stop-after-step
- provider success
- provider failure
- resume
- interruption
- read-only Web UI

Intentional real-provider check:

```sh
node src/cli.mjs smoke-calc
```

This remains an explicit smoke path and is not part of normal unit-style verification.

## 11. Deferred Work

- Dockerized execution and hardening
- richer review schemas
- Epic flow support
- optional SDK-based adapters after the CLI path is stable
