# pdh-flow Technical Plan

更新日: 2026-04-24

## 1. Architecture Decision

### Adopted

- Canonical runtime state lives in `current-note.md` frontmatter.
- Durable ticket intent lives in `current-ticket.md`.
- `.pdh-flow/` stores transient local artifacts only.
- Markdown body stays human-facing. Runtime transitions should prefer frontmatter and structured artifacts over markdown body parsing.
- CLI commands are repo-centric.
- Web UI is viewer-first and derives state from note frontmatter plus transient artifacts. It may launch a stop-state assist terminal, but progression still belongs to runtime commands and assist signals.
- Flow semantics are internalized in this repo; runtime execution does not depend on external `pdh-dev` or `tmux-director` skills.
- Review-step orchestration semantics (reviewer roster, pass conditions, loop-back intent) are defined in flow YAML and compiled into runtime-owned prompts.
- Review-step reviewer rosters execute in parallel and are aggregated by the runtime into canonical note sections and structured judgement artifacts.
- Review steps may run bounded repair rounds between reviewer rounds. The runtime owns round tracking, repair prompts, and the escalation point back to the user after repeated unresolved findings.

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

Frontmatter is the only markdown content the runtime should treat as canonical state. It should stay small, readable, and hand-editable. Only short scalar values, enums, timestamps, and compact status summaries belong there.

Target direction:

```yaml
---
pdh:
  ticket: calc-cli
  flow: pdh-ticket-core
  variant: full
  status: needs_human
  current_step: PD-C-5
  run_id: run-20260424022333-726697
  gate:
    step: PD-C-5
    status: pending
  rerun_target: null
  started_at: 2026-04-24T02:23:33.060Z
  updated_at: 2026-04-24T02:23:33.060Z
  completed_at: null
---
```

Do not store long findings, AC tables, diffs, or logs in frontmatter.

#### `current-ticket.md`

- Why
- What
- Product AC
- Implementation Notes
- Related Links

No runtime metadata is written to this file.

### 2.2 Transient artifact layout

```text
.pdh-flow/
  runtime-supervisor.json
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
          step-record.json
          step-commit.json
          attempt-1/
            codex.raw.jsonl
            result.json
            note-ticket.patch
        PD-C-7/
          judgements/
            quality_review.json
        PD-C-8/
          ac-verification.json
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

### 2.3 Structured artifact policy

Structured artifacts are machine-readable runtime evidence. They live only under `.pdh-flow/`, are gitignored, and must not be committed or retained after ticket close.

Primary runtime-facing artifacts:

- `runtime-supervisor.json`
  - top-level runtime execution only
  - tracks `run-next` / `run-provider` / `resume` liveness
- `step-record.json`
  - compact per-step runtime summary
  - replaces markdown section presence as the main step-record guard input
- `step-commit.json`
  - explicit step commit record
  - replaces commit-subject regex as the primary commit guard input
- `ac-verification.json`
  - machine-readable AC status and counts
  - replaces markdown AC table parsing as the primary AC authority
- `human-gate.json`
  - gate state, recommendation, rerun requirement, and baseline metadata

Lifecycle rules:

- Artifacts may exist only while a ticket run is active.
- Web UI may read them directly.
- On close, the runtime removes the active run directory and any remaining supervisor file.
- Durable repo state after close should be only:
  - product/source changes
  - durable ticket/note files
  - human-readable history mirrored into note body

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
- manage runtime-supervisor and structured step artifacts
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

- viewer-first API and dashboard
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
- `approve` / `reject` / `request-changes` remain direct override commands for human gates
- `assist-open` starts a fresh stop-state Claude session in the same repo checkout
- `assist-signal` is the only supported way for that assist session to hand control back to the runtime
- `accept-recommendation` / `decline-recommendation` are the normal human-gate confirmation commands after assist proposes a next move

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
- a YAML contract for `.pdh-flow/.../ui-output.yaml`
- a required judgement payload for review steps whose guards consume judgement artifacts

The prompt does not inline the full contents of canonical files. The provider is expected to read those files directly inside the repo.

## 7. Guard Evaluation

Guard types still include:

- note frontmatter state present
- ticket existence / path checks
- step record present
- step commit recorded
- command
- AC verification artifact
- artifact exists
- human approved
- judgement status

The runtime evaluates guards directly against:

- note frontmatter
- repo files
- current human gate artifact
- judgement artifacts
- transient local artifacts

Markdown body parsing is transitional only. The target state is:

- no markdown section guards for runtime transitions
- no markdown table parsing for AC authority
- no markdown section diff as the primary rerun decision input

## 8. Human Gates and Interruptions

### Human gate

1. `run-next` reaches a human step
2. runtime writes `human-gate-summary.md`
3. runtime writes `human-gate.json`
4. note frontmatter status becomes `needs_human`
5. user usually opens `assist-open`, and assist returns a recommendation with `assist-signal`
6. user confirms it with `accept-recommendation` or rejects it with `decline-recommendation`
7. direct `approve` / `reject` / `request-changes` still exist as manual override commands

### Interruption

1. user or runtime writes an interruption artifact
2. note frontmatter status becomes `interrupted`
3. provider execution is blocked
4. `answer` or `assist-signal --signal answer` resolves the latest open interruption
5. next provider prompt includes answered interruption context

### Stop-state assist

When the run is `needs_human`, `interrupted`, or `blocked`, the runtime can prepare a fresh Claude assist session in the same repo checkout.

Artifacts:

- `.pdh-flow/runs/<run-id>/steps/<step-id>/assist/manifest.yaml`
- `.pdh-flow/runs/<run-id>/steps/<step-id>/assist/prompt.md`
- `.pdh-flow/runs/<run-id>/steps/<step-id>/assist/system-prompt.txt`
- `.pdh-flow/runs/<run-id>/steps/<step-id>/assist/session.json`
- `.pdh-flow/runs/<run-id>/steps/<step-id>/assist/signals.jsonl`

Wrapper scripts:

- `./.pdh-flow/bin/assist-signal`
- `./.pdh-flow/bin/assist-test`

Runtime guarantees:

- the assist runs fresh and is not a continuation of the provider session
- the prompt tells Claude not to advance PDH flow directly
- progression still happens through runtime state updates plus `run-next`

## 9. Cleanup and Close

At `PD-C-10` approval:

1. append durable step-history lines to `current-note.md`
2. remove `.pdh-flow/runs/<run-id>/`
3. remove `.pdh-flow/runtime-supervisor.json`
4. run `ticket.sh close` when available
5. mark note frontmatter `status: completed`
6. clear `run_id`

This keeps the repo with one durable story:

- code
- ticket
- note
- git history

and removes transient execution noise.

Additional constraint:

- structured runtime artifacts must never survive onto `main`
- if close cannot remove them automatically, the close path should fail safe and return to a human-fixable state rather than silently leaving runtime files behind

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
- viewer-first Web UI with assist launch only

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

## 12. Migration Direction

Implementation should proceed in this order:

1. expand `current-note.md` frontmatter for compact current-state fields
2. add `step-record.json` and `ac-verification.json`
3. switch `git_commit_exists` to `step-commit.json` as the primary source
4. move rerun requirement derivation away from markdown section diff
5. retire markdown body guards after artifact coverage is complete
