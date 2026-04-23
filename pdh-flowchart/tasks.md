# pdh-flowchart Tasks

## Phase 0: Runtime Foundation

- [x] Product brief and technical plan are in repo.
- [x] Full and Light `pdh-ticket-core` flow definitions exist.
- [x] CLI skeleton supports `init`, `run`, `status`, `guards`, and `advance`.
- [x] SQLite state store persists runs, progress events, provider sessions, and human gates.
- [x] Deterministic guard skeletons cover note/ticket sections, commands, commits, human approval, AC verification tables, and judgement artifacts.
- [x] Codex JSONL adapter saves raw provider logs and normalized progress events.
- [x] Codex calculator smoke creates a tiny `uv run calc "1+2"` app and verifies it.
- [x] Human gate commands create summaries and record approve/reject/request-changes/cancel decisions.
- [x] Runtime action hooks exist for `commit-step`, `ticket-start`, and `ticket-close`.
- [x] User-facing commands refuse non-current step operations unless `--force` is used.

## Phase 1: Full Flow MVP

- [x] Implement a single `run-next` loop that executes the current step, evaluates guards, and advances until blocked.
- [x] Add Claude adapter with `stream-json` normalization and raw log capture.
- [x] Add provider selection from `flows/pdh-ticket-core.yaml` instead of command-specific provider calls.
- [x] Generate PD-C prompt templates from `pdh-dev` semantics.
- [x] Implement runtime-controlled note/ticket metadata writes.
- [x] Capture provider note/ticket direct-update diffs as artifacts.
- [x] Implement `ticket.sh start` integration from `run --ticket`.
- [x] Implement `ticket.sh close` integration after PD-C-10 approval.
- [x] Add structured judgement artifacts for PD-C-4, PD-C-7, and PD-C-8.
- [x] Add AC verification table parser with real `verified` / `deferred` / `unverified` rows.
- [x] Add `PD-C-9` final verification runner for test commands and AC evidence.
- [x] Add resume behavior for interrupted provider steps.

## Phase 1: User Experience

- [x] `status` shows current step, provider, mode, guards, human gate state, and recent events.
- [x] Add `logs --follow` for normalized progress events.
- [x] Add `show-gate` to print the current gate summary.
- [x] Make blocked guard output concise by default, with `--json` for full detail.
- [x] Add `doctor` to check Node, Codex, Claude, uv, git, and auth status.
- [x] Add example fixtures for a tiny fake `pdh-dev` repository.
- [x] Add interruption and answer commands for step-level clarification.

## Phase 2: Reliability

- [x] Add file locking so two runtimes cannot mutate the same run.
- [x] Add provider timeout and orphan process cleanup.
- [x] Add retry/backoff policy per step.
- [x] Add secret redaction for raw logs and summaries.
- [x] Add state schema migrations.
- [x] Add tests around failed/blocked/resumed runs.

## Next: Local Runtime Hardening

- [ ] Decide whether `.pdh-flowchart/state.sqlite` remains repo-local or moves to a shared volume.
- [ ] Strengthen direct `current-note.md` / `current-ticket.md` update summaries using `git diff` and artifacts.
- [x] Add failed-step artifact summaries for user-facing recovery.
- [ ] Refine structured review report schema.
- [ ] Evaluate optional Codex SDK / Claude Agent SDK adapters.

## Deferred: Docker Operations

- [ ] Build a reproducible Docker runtime image for permission-bypass provider execution.
- [ ] Enforce Docker egress policy for provider APIs, package registries, and git remotes.
- [ ] Pin exact Codex CLI, Claude Code, Node.js, and uv versions in the Docker image.

## Phase 3: UI and Flow Expansion

- [x] Add simple read-only web status UI for progress, logs, gates, interruptions, and git diff.
- [ ] Add flow graph export.
- [ ] Add Epic flow support.
- [ ] Add parallel reviewer support.

## Open Decisions

- [ ] Decide whether `.pdh-flowchart/state.sqlite` remains repo-local or moves to a separate volume for multi-repo use.
