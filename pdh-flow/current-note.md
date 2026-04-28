---
pdh:
  ticket: repo-centric-runtime
  flow: pdh-ticket-core
  variant: full
  status: completed
  current_step: PD-C-10
  started_at: 2026-04-24T01:00:00.000Z
  updated_at: 2026-04-24T03:30:00.000Z
  completed_at: 2026-04-24T03:30:00.000Z
---

# current-note.md

## Status

Repo-centric runtime refactor completed. `current-note.md` frontmatter is now the canonical state model.

## PD-C-2. 調査結果

- The old runtime had two authoritative stories: note/ticket files and a separate SQLite store.
- Web UI, CLI, prompts, and tests were all keyed around `run_id` and DB queries.
- Human interruptions and gate decisions made the dual-state model fragile because ticket meaning could change mid-run.

## PD-C-3. 計画

- Introduce frontmatter parsing and writing for `current-note.md`.
- Introduce repo-centric runtime helpers for progress events, attempts, gate artifacts, and cleanup.
- Rebuild the CLI so `run-next --repo .` is the primary control surface.
- Rebuild the Web UI to read directly from note frontmatter plus local artifacts.
- Rewrite docs around canonical markdown state and transient `.pdh-flow/`.

## PD-C-6

- Added `src/note-state.mjs` and `src/runtime-state.mjs`.
- Replaced the CLI with a repo-centric implementation and removed runtime metadata writes to `current-ticket.md`.
- Reworked prompts to reference canonical files instead of inlining them.
- Reworked the Web UI to follow the provided dashboard mock while reading repo-local state directly.
- Removed the old SQLite runtime store and metadata helper from the active code path.

## PD-C-7. 品質検証結果

- `npm run check` passes.
- `npm run test:runtime` passes with repo-centric fixture tests for gates, provider success/failure, resume, interruption, and Web UI.
- Manual fixture flow was checked through `PD-C-5` approval into `PD-C-6`.

## PD-C-9. プロセスチェックリスト

- [x] README rewritten for repo-centric commands.
- [x] PRD rewritten for frontmatter-first state.
- [x] Technical plan rewritten for transient local artifacts.
- [x] Runtime tests rewritten for repo-centric flow.
- [x] Example fixture docs updated.

## AC 裏取り結果

| Item | Classification | Status | Evidence | Deferral Ticket |
| --- | --- | --- | --- | --- |
| CLI works without normal run-id arguments | product | verified | `npm run test:runtime` plus manual fixture run through `PD-C-5 -> PD-C-6` | - |
| Provider prompts reference canonical files instead of inlining them | product | verified | `node src/cli.mjs prompt --repo ...` output | - |
| Web UI reads note frontmatter and local artifacts directly | product | verified | `node src/cli.mjs web --repo ...` plus API checks in `npm run test:runtime` | - |
| SQLite is no longer the authoritative state model | product | verified | `src/db.mjs` removed from active runtime and docs rewritten | - |
| Durable step history remains after cleanup | product | verified | `Step History` section retained in this note; cleanup semantics documented and implemented | - |

## Discoveries

- Treating step history as a durable note section is simpler than maintaining a separate structured state mirror.
- Repo-centric commands make the Web UI much easier to explain because the next action is always a repo CLI command.
- Local artifacts can stay transient as long as the note keeps the durable summary.

## Step History

- 2026-04-24T01:20:00.000Z | PD-C-2 | success | - | Identified SQLite and metadata-block coupling across CLI, Web UI, and docs
- 2026-04-24T01:45:00.000Z | PD-C-3 | success | - | Planned note-frontmatter state, repo-centric CLI, and transient artifact cleanup
- 2026-04-24T02:40:00.000Z | PD-C-6 | success | - | Implemented note-state/runtime-state modules, new CLI, and new Web UI
- 2026-04-24T03:00:00.000Z | PD-C-7 | success | - | Verified runtime behavior with fixture tests, provider fakes, and Web API checks
- 2026-04-24T03:20:00.000Z | PD-C-9 | success | - | Rewrote README, PRD, technical plan, tasks, AGENTS, and fixture docs
- 2026-04-24T03:25:00.000Z | PD-C-10 | human_approved | - | Marked repo-centric runtime redesign ready to close
- 2026-04-24T03:30:00.000Z | CLEANUP | local_artifacts_removed | - | Final state model no longer depends on transient local artifacts
