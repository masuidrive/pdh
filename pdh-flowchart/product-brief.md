# pdh-flowchart PRD

## 1. Product Summary

`pdh-flowchart` turns the PD-C ticket flow into a repo-centric CLI runtime with explicit gates, interruptions, provider prompts, and a read-only progress UI.

The key product decision is:

- `current-note.md` frontmatter is the canonical runtime state.
- `current-ticket.md` is the durable ticket record.
- `.pdh-flowchart/` is transient local evidence and is never the source of truth.

This replaces the earlier dual-state model where a separate runtime store tried to mirror note/ticket state.

## 2. Target User

- Engineers who already understand PDH at a high level but do not remember each `PD-C-*` detail.
- Engineers who want a single command path for Codex or Claude backed work.
- Users who need the runtime to stop explicitly for human approval or interruption answers.

## 3. Core User Problem

The old model had too many places where state could diverge:

- runtime state store
- note/ticket files
- transient logs
- human interruptions or scope changes introduced mid-run

That made it easy for the runtime to say one thing while the canonical note/ticket said another.

## 4. Product Goals

1. The active ticket state is readable by opening `current-note.md`.
2. The main workflow uses repo-centric commands such as `run-next --repo .`.
3. Providers are guided by compiled step semantics plus canonical file references, not by inlined copies of note/ticket.
4. Human gates and interruptions block the flow explicitly.
5. The Web UI explains what the user should look at and which CLI command to run next.
6. Local provider logs and prompts can be deleted before close without losing durable history.
7. Runtime behavior does not depend on loading external `pdh-dev` or `tmux-director` skills.

## 5. Non-Goals

- Generic orchestration for arbitrary workflows
- Multi-repo centralized state storage
- Write-capable Web UI
- Docker-first execution in the current phase
- Project-specific context YAML beyond `current-ticket.md` and `current-note.md`

## 6. Product Principles

1. **One canonical runtime record**
   The active flow state lives in `current-note.md` frontmatter.

2. **Durable vs transient is explicit**
   Ticket intent and step history stay in markdown. Provider raw logs, prompts, and gate artifacts stay under `.pdh-flowchart/`.

3. **Human state changes are first-class**
   Approval, rejection, request-changes, and interruption answers are explicit runtime events.

4. **The user should not need to remember PD-C numbers**
   The UI and CLI should always show the label, purpose, and next action.

5. **The runtime should default to auto-progress**
   Unless a gate, interruption, guard failure, or provider failure blocks progress, `run-next` keeps moving.

## 7. Main Workflow

### Start

```sh
node src/cli.mjs run --repo . --ticket calc-cli --variant full
```

This creates or updates:

- `current-note.md` frontmatter
- transient `.pdh-flowchart/runs/<run-id>/`
- optional `ticket.sh start`

### Normal progress

```sh
node src/cli.mjs run-next --repo .
```

This continues until:

- human gate
- interruption
- guard failure
- provider failure
- completion

### Human gate

The runtime writes a summary artifact and waits for:

```sh
node src/cli.mjs show-gate --repo .
node src/cli.mjs approve --repo . --step PD-C-5 --reason ok
```

### Completion

At close:

1. durable step history is appended to `current-note.md`
2. `.pdh-flowchart/runs/<run-id>/` is removed
3. `ticket.sh close` runs when available

## 8. Functional Requirements

### 8.1 Canonical State

`current-note.md` frontmatter must support:

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

### 8.2 Durable Notes

`current-note.md` body must be able to hold:

- PD-C step sections
- AC verification table
- discoveries
- step history

### 8.3 Provider Prompting

The provider prompt must include:

- step-specific instructions
- compiled semantic rules from flow YAML
- guard requirements
- canonical file references
- a YAML output contract for step-local UI semantics

The provider prompt must not inline the full contents of `current-note.md` or `current-ticket.md`.

### 8.4 Web UI

The Web UI must remain read-only and show:

- current step
- next CLI action
- the active flow variant for the current run
- step contract from flow YAML
- provider-written `ui-output.yaml`
- runtime-written `ui-runtime.yaml`
- clickable detail rows for `mustShow` items backed by current artifacts
- logs
- gate or interruption state
- step artifacts
- git diff summary

### 8.5 Cleanup

Transient local artifacts must be removable without losing durable workflow history.

## 9. MVP Scope

In scope:

- repo-centric CLI
- note frontmatter state model
- transient `.pdh-flowchart/` artifacts
- Codex / Claude provider adapters
- explicit human gates and interruptions
- read-only Web dashboard
- fixture-based user-flow tests

Deferred:

- Docker hardening
- Epic flow support
- parallel reviewers
- centralized or multi-repo state services

## 10. Success Criteria

- A user can progress a ticket with `run-next --repo .` without supplying a run id.
- `current-note.md` alone is enough to answer “which step am I on?”
- `current-ticket.md` no longer carries runtime metadata.
- The UI clearly shows what to look at and which CLI command to run next.
- Cleanup removes transient artifacts before close while durable note history remains.
