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
- [ ] Add Claude adapter with `stream-json` normalization and raw log capture.
- [ ] Add provider selection from `flows/pdh-ticket-core.json` instead of command-specific provider calls.
- [ ] Generate PD-C prompt templates from `pdh-dev` semantics.
- [ ] Implement runtime-controlled note/ticket metadata writes.
- [ ] Implement provider patch proposal artifacts for note/ticket updates.
- [ ] Implement `ticket.sh start` integration from `run --ticket`.
- [ ] Implement `ticket.sh close` integration after PD-C-10 approval.
- [ ] Add structured judgement artifacts for PD-C-4, PD-C-7, and PD-C-8.
- [ ] Add AC verification table parser with real `verified` / `deferred` / `unverified` rows.
- [ ] Add `PD-C-9` final verification runner for test commands and AC evidence.
- [ ] Add resume behavior for interrupted provider steps.

## Phase 1: User Experience

- [x] `status` shows current step, provider, mode, guards, human gate state, and recent events.
- [ ] Add `logs --follow` for normalized progress events.
- [ ] Add `show-gate` to print the current gate summary.
- [ ] Make blocked guard output concise by default, with `--json` for full detail.
- [ ] Add `doctor` to check Node, Codex, Claude, uv, git, and auth status.
- [ ] Add example fixtures for a tiny fake `pdh-dev` repository.

## Phase 2: Reliability

- [ ] Add file locking so two runtimes cannot mutate the same run.
- [ ] Add provider timeout and orphan process cleanup.
- [ ] Add retry/backoff policy per step.
- [ ] Add secret redaction for raw logs and summaries.
- [ ] Add state schema migrations.
- [ ] Add tests around failed/blocked/resumed runs.

## Open Decisions

- [ ] Decide Docker egress policy for permission-bypass profile.
- [ ] Decide exact Codex CLI and Claude Code version pinning for Docker image.
- [ ] Decide whether `.pdh-flowchart/state.sqlite` remains repo-local or moves to a separate volume for multi-repo use.
