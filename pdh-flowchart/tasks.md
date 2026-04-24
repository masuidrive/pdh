# pdh-flowchart Tasks

## Phase 1: Repo-Centric Runtime

- [x] Replace runtime metadata blocks with `current-note.md` frontmatter.
- [x] Keep `current-ticket.md` free of runtime state.
- [x] Remove SQLite as the canonical state model.
- [x] Keep `.pdh-flowchart/` as transient local artifacts only.
- [x] Add repo-centric runtime helpers for run state, progress events, attempts, gates, and cleanup.
- [x] Keep prompt generation based on compiled flow semantics.
- [x] Stop inlining canonical file contents into provider prompts.

## Phase 2: CLI Redesign

- [x] Make `run`, `run-next`, `status`, `run-provider`, and `resume` repo-centric.
- [x] Keep `run-next` as the default auto-progress command.
- [x] Preserve explicit human gates and interruption answers.
- [x] Keep debug commands for prompt, judgement, verify, and gate summary.
- [x] Add cleanup behavior for transient run artifacts.
- [x] Keep `smoke-calc` as an intentional real-provider check only.

## Phase 3: Web UI Redesign

- [x] Replace DB-backed run list UI with a single active repo dashboard.
- [x] Keep the Web UI read-only.
- [x] Show current step, next CLI action, flow progress, logs, artifacts, and git summary.
- [x] Use the provided dashboard visual direction as the base styling.

## Phase 4: Verification

- [x] Rewrite fixture runtime tests for repo-centric commands.
- [x] Verify gate open -> approve -> stop-after-step user flow.
- [x] Verify provider success, failure, resume, and interruption handling.
- [x] Verify Web UI API and read-only behavior.
- [x] Run `npm run check`.
- [x] Run `npm run test:runtime`.

## Phase 5: Documentation

- [x] Rewrite `product-brief.md` for the frontmatter-first state model.
- [x] Rewrite `technical-plan.md` for repo-centric CLI and transient artifacts.
- [x] Rewrite `README.md` for the new user flow.
- [ ] Update example fixture docs and sample canonical files.
- [ ] Refresh `current-ticket.md` and `current-note.md` in this repo to match the new model.

## Deferred

- [ ] Dockerized execution and hardening.
- [ ] Epic flow support.
- [ ] Parallel reviewer support.
- [ ] Richer review result schemas.
- [ ] Optional SDK adapters after the CLI path is stable.
