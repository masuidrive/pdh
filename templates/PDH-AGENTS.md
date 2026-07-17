# PDH-AGENTS.md — PDH common agent rules

This file contains PDH rules that should be shared across projects.
Project-specific rules belong in `CLAUDE.md`. Environment-local notes belong in
gitignored `CLAUDE.local.md`.

## Read Order

For PDH / ticket-centric work, read:

1. `product-brief.md`
2. `docs/product-delivery-hierarchy.md`
3. `PDH-AGENTS.md`
4. `CLAUDE.md`
5. `CLAUDE.local.md` if it exists
6. `.agents/skills/pdh-dev/SKILL.md` or `.claude/skills/pdh-dev/SKILL.md`
7. `.agents/skills/pdh-coding/SKILL.md` or `.claude/skills/pdh-coding/SKILL.md`
8. `current-ticket.md` and `current-note.md` when they exist

`CLAUDE.md` may override project-specific commands, file layout, and operational constraints, but it should not restate the generic PDH process.

## Stage Flow

PDH stage labels are stable checklist keys, not heavyweight process numbers:

`PDH-open` -> `PDH-ticket-review` -> `PDH-ticket-human-review` -> `PDH-implement` -> `PDH-review` -> `PDH-verify` -> `PDH-human-review` -> `PDH-close`

`PDH-ticket-review` and `PDH-ticket-human-review` are separate stages. The former is the agent-side ticket contract check. The latter is the pre-implementation human gate where the user reviews the ticket summary, what changed during ticket review, what will be achieved, AC, out-of-scope, and decision points. Do not start implementation without explicit AC approval in `PDH-ticket-human-review`.

`PDH-human-review` is the close-before-human gate. Its purpose is for the user to compare what the coding agent did and achieved against the user's expectation. Do not advance to `PDH-close` or describe the ticket as complete without explicit user approval.

## Execution Model

Use a stage-by-stage worker model when available. Coding Engineer, QA, reviewer, AC verification, and Surface Observer should be separate workers where practical. The Director / main agent must treat worker PASS as input, not approval. Before moving stages, verify the canonical docs, ticket, diff, real command output, and note evidence.

Reviewer findings are hypotheses, not implementation orders. The Director decides whether each finding is adopted, deferred, or rejected by tying it to the AC, the current diff, the changed user journey, or the same root cause of an actually shipped defect. A severity label alone does not authorize scope expansion. A real Critical/Major finding unrelated to the current ticket must stop automatic progress and be brought to the user instead of being silently deferred. After a fix, re-review only the original finding and its fix delta; do not repeatedly run broad discovery reviews. If a fix adds persistent state or public surface, compare it with a delete/reject/constrain alternative before implementation and escalate when the simpler design cannot be chosen confidently.

The Director must not change its own engine, model, profile, or reasoning effort. Only an explicit user instruction for the current work can authorize that change. Worker model assignment remains separate and follows project policy.

If subagents/workers cannot be started, do not silently treat solo execution as equivalent. Explain the limitation and ask the user when it affects confidence or gate semantics.

## Worker Instructions

Workers/subagents do not inherit the Director's full conversation state. Every worker prompt should include:

- The task goal and background
- Target file paths or ownership boundaries
- The ticket's Why, AC, Architectural Invariants check, fixed decisions, and out-of-scope items
- The worker's exact responsibility and collision boundaries
- For implementation workers, an instruction to read `.agents/skills/pdh-coding/SKILL.md` or `.claude/skills/pdh-coding/SKILL.md`

Do not assign overlapping write ownership to multiple workers. Reading/review tasks may run in parallel; writing tasks should have clear ownership. Worker PASS is not approval; the Director must inspect the result.

## Context Management

When context is compacted or work resumes, preserve the current ticket id, current PDH stage, unresolved concerns, user decisions, and explicit approvals. Reset context between unrelated tasks. Delegate broad research or noisy log inspection when possible so the Director retains enough context for judgment and user communication.

## Verification

The review and verification rules are:

- **Severity**: Critical means the ticket cannot ship unfixed because an AC
  is unmet, security is violated, or data can be lost; Major degrades this
  ticket's user journey. Everything else defaults to follow-up.
- **AC trace and over-implementation**: check forward that every AC has named
  implementation evidence and reverse-map every substantive change to the brief/AC,
  security, or stability. Report unmapped code, dead code documented as active,
  governance mixing, and reactive-fix growth as defects. The Director retains
  code only for one of those three reasons and records a one-line rejection reason.
- **Cross-model review**: changes to authentication, authorization, database
  schema, secrets, data deletion, or billing require at least one independent
  review by a model different from the generator. If one review wing cannot
  complete, substitute a different-model independent reviewer plus the
  Director's direct code read, and record why.
- **Rewind discipline**: before rewinding implementation or review work, pin
  every detected Critical/Major in `ticket-local-test`; afterward compare the
  independent first review with those checks and record the rewind reason.

- **Evidence freshness**: bind review, AC, test, and Surface evidence to the
  exact commit SHA. A later change invalidates the evidence it can affect.
  Browser verification must use the real runtime composition (dev server,
  shared shell/styles, auth, and seed), not an isolated renderer substitute.
- **Scope boundary**: keep a finding in the current ticket only when leaving it
  unfixed would mean AC is unmet, the current diff caused a regression, the
  same root cause can recreate an actually shipped defect, or a Critical/Major
  finding makes this ticket's changed/required user journey unsafe to review.
  Otherwise record it as a follow-up. An exception
  requires one note line connecting the fix directly to the AC or current diff.
- **Human authority**: a human gate or product decision requires an explicit
  user response. A highlighted/default form option, silence, or worker output
  is not approval. Environment-specific constraints must not be solved by
  changing shared repository configuration or the base branch without explicit
  approval; use local configuration or a temporary command instead.

Permanent tests and `ticket-local-test` are different:

- Permanent tests in `scripts/test-all.sh`, CI, or `test/` should cover product contracts, Architectural Invariants, and generalized regressions. If the repository commits generated artifacts (bundled workers, compiled assets, generated SDK models), the permanent suite must rebuild them and fail when the rebuilt output differs from the committed files, so stale artifacts are caught deterministically instead of by reviewer attention.
- Ticket-specific temporary checks, such as confirming an old route is now 404 or a specific fixture is hidden, are `ticket-local-test`.
- Executable `ticket-local-test` scripts live at the `tests_dir` path shown by `ticket.sh start`/`restore` output (compat: legacy flat layout keeps them at `tests/tickets/<ticket-id>/test-ticket-local.sh`).
- Run them through `./scripts/test-ticket-local.sh [ticket-id]`.
- Record seed, `tmp/` helpers, `agent-browser`, `curl`, and command evidence in `current-note.md`.

When deciding whether to promote a ticket-local test into permanent coverage, ask: can this behavior be described as an ongoing product contract without naming the ticket or temporary fixture?

## Dev Server And Seed

For UI / API verification and human review, use `./scripts/dev-server.sh`.

- `--seed` resets local state and runs `scripts/seed-pdh-verify.sh`.
- `--port <port>` uses a fixed port.
- With no `--port`, the script should choose an available port.
- `--no-localhost` exposes a non-localhost review URL using the project's safe method.

If UI / API verification needs reproducible local data, implement `scripts/seed-pdh-verify.sh`. If no seed is needed, the hook should be a no-op success. Do not use production or remote data from this hook unless the user explicitly approved it for the current verification.

If the dev-server or seed behavior needed for a ticket differs from the script, update the script rather than hiding the change in one-off commands.

## Browser And Surface Checks

If a UI/browser surface exists, run a real user-case check after seed setup and before `PDH-human-review`. `agent-browser` is an acceptable browser automation CLI. Its CLI changes by version and environment, so run `agent-browser --help` immediately before using it and follow the help output from the current environment.

The check must exercise the same composed page the user receives, including
the shared page shell and CSS. Record the tested commit SHA. For visual UI,
cover light and dark color schemes when the application supports them.

Human-review instructions are for the user, not the agent. Provide browser URLs and concrete click/visual checks for UI, `curl` commands and expected status/body for API, and a `tmp/` helper only when manual auth/cookie/setup is too awkward. Do not present an `agent-browser` command list as the user's review procedure.

If auth is required, explain the auth method before human review. For non-localhost exposure, protect the surface with Basic Auth, a temporary token, Access, or another project-appropriate method. Do not paste secret values into the conversation; describe where the user can get or run them.

## Reporting

When asking the user for a decision, explain:

- What was done
- What was achieved
- Verification evidence
- Judgment points
- Options, with the recommended option first

If there is doubt, a blocker, a missing decision, or no credible path to `PDH-human-review`, ask the user immediately instead of waiting for a later gate.
