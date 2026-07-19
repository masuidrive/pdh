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
8. The ticket and note files at the paths shown by `ticket.sh start`/`restore` output (`ticket:`/`note:`; compat symlinks: `current-ticket.md`/`current-note.md`) when they exist

`CLAUDE.md` may override project-specific commands, file layout, and operational constraints, but it should not restate the generic PDH process.

## Stage Flow

PDH stage labels are stable checklist keys, not heavyweight process numbers:

`PDH-open` -> `PDH-ticket-review` -> `PDH-ticket-human-review` -> `PDH-implement` -> `PDH-review` -> `PDH-verify` -> `PDH-human-review` -> `PDH-close`

`PDH-ticket-review` and `PDH-ticket-human-review` are separate stages. The former is the agent-side ticket contract check. The latter is the pre-implementation human gate; the material to present is defined in Human Gate Materials below. Do not start implementation without explicit AC approval in `PDH-ticket-human-review`. Any later change to the Acceptance Criteria — adding, removing, or rewording — needs explicit user approval as well.

`PDH-human-review` is the close-before-human gate. Its purpose is for the user to compare what the coding agent did and achieved against the user's expectation. Do not advance to `PDH-close` or describe the ticket as complete without explicit user approval.

## Execution Model

Use a stage-by-stage worker model when available. Coding Engineer, QA, reviewer, AC verification, and Surface Observer should be separate workers where practical. The Director / main agent must treat worker PASS as input, not approval. Before moving stages, verify the canonical docs, ticket, diff, real command output, and note evidence.

Reviewer findings are hypotheses, not implementation orders. The Director decides whether each finding is adopted, deferred, or rejected by tying it to the AC, the current diff, the changed user journey, or the same root cause of an actually shipped defect. A severity label alone does not authorize scope expansion. A real Critical/Major finding unrelated to the current ticket must stop automatic progress and be brought to the user instead of being silently deferred. After a fix, re-review only the original finding and its fix delta; do not repeatedly run broad discovery reviews. If a fix adds persistent state or public surface, compare it with a delete/reject/constrain alternative before implementation and escalate when the simpler design cannot be chosen confidently.

The Director must not change its own engine, model, profile, or reasoning effort. Only an explicit user instruction for the current work can authorize that change. Worker model assignment remains separate and follows project policy.

If subagents/workers cannot be started, do not silently treat solo execution as equivalent. Explain the limitation and ask the user when it affects confidence or gate semantics.

Do not `git push` unless the user explicitly requested it, an approved close
flow performs it (for example ticket.sh `auto_push` on close), or `CLAUDE.md`
explicitly authorizes it.

## Worker Instructions

Workers/subagents do not inherit the Director's full conversation state. Every worker prompt should include:

- The task goal and background
- Target file paths or ownership boundaries
- The ticket's Why, AC, Architectural Invariants check, fixed decisions, and out-of-scope items
- The worker's exact responsibility and collision boundaries
- For implementation workers, an instruction to read `.agents/skills/pdh-coding/SKILL.md` or `.claude/skills/pdh-coding/SKILL.md`

Exception: the unbiased Why-end-to-end review lens deliberately omits the
ticket file, the AC, and the implementor's conclusions; its prompt carries only
the Why (see the pdh-dev skill's review lens rules).

Do not assign overlapping write ownership to multiple workers. Reading/review tasks may run in parallel; writing tasks should have clear ownership.

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
- **Independent review triggers**: the following diffs must not skip independent
  review — authentication, authorization, session/token/scope/ACL/group checks;
  destructive or irreversible operations and the paths that reach them; database
  migrations or schema changes; secrets; data deletion; billing; deploy
  procedures; external API contracts; and newly exposed surface (new endpoint,
  MCP tool, CLI subcommand). Reviewers on these diffs look for fail-open and
  misuse before the happy path.
- **Cross-model review**: for those same triggers, at least one of the reviews
  must come from a model different from the generator. If one review wing cannot
  complete, substitute a different-model independent reviewer plus the
  Director's direct code read, and record why.
- **Rewind discipline**: before rewinding implementation or review work, pin
  every detected Critical/Major as an executable `ticket-local-test` under the
  ticket's tests directory (see the `ticket-local-test` location rule below);
  afterward compare the independent first review with those checks
  and record the rewind reason.

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
- Executable `ticket-local-test` scripts live at `<ticket_dir>/tests/`, derived by convention from the `ticket_dir:` path in `ticket.sh start`/`restore` output (per-ticket layout: `tickets/<name>/tests/`; compat: legacy flat layout keeps them at `tests/tickets/<ticket-id>/test-ticket-local.sh`). ticket.sh neither prints nor creates a tests path, so `mkdir -p` it when writing the first test.
- Run them through `./scripts/test-ticket-local.sh [ticket-id]`.
- Record seed, `tmp_dir` helpers, `agent-browser`, `curl`, and command evidence in the note file (the `note:` path from the same output; compat symlink: `current-note.md`).

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

HTTP-level tools (`curl`, API test scripts) verify server behavior only. They
are never acceptable evidence for a browser surface: client-side logic (drag &
drop, FormData construction, rendering, form submission) is exercised only by
a real browser driving the composed page. If browser verification is
impossible in the current environment, do not substitute `curl` and report the
surface as verified; state the constraint and ask the user.

If auth is required, explain the auth method before human review. For non-localhost exposure, protect the surface with Basic Auth, a temporary token, Access, or another project-appropriate method. Do not paste secret values into the conversation; describe where the user can get or run them.

## Reporting

When asking the user for a decision, explain:

- What was done
- What was achieved
- Verification evidence
- Judgment points
- Options, with the recommended option first

This is the baseline for any decision request. At the two human gates, the
full material list in Human Gate Materials supersedes it.

Never report something as working without having run the relevant tests in
this session. A missing command, missing dependency, or environment error
counts as a test failure, not a skip; a single failing, unknown-skipped, or
unrunnable test means the work is not done.

If there is doubt, a blocker, a missing decision, or no credible path to `PDH-human-review`, ask the user immediately instead of waiting for a later gate.

## Human Gate Materials

A human gate is only as good as the material the user receives. The user is not
expected to reconstruct the agent's reasoning, re-read the diff, or ask for what
is missing. Deliver the following in the conversation itself — recording it in
the note file instead of presenting it does not satisfy the gate.

At `PDH-ticket-human-review`, before implementation:

- What this ticket will make possible, in one user-journey line
- The Why, and how it connects to the brief
- Every Acceptance Criterion, in the exact wording being approved
- What changed during `PDH-ticket-review`, and why
- What is explicitly out of scope
- Open decision points, with options and a recommendation first
- Known risks or dependencies that could invalidate the plan

At `PDH-human-review`, before close:

- What was achieved, in one user-journey line
- Each AC with its evidence, and any AC met only indirectly
- The diff summary and the main changed files
- Test and verification output, verbatim enough to see pass/fail counts
- **Every review finding that was not fixed** — the follow-up and rejected rows
  of the note's `### Findings` table, with counts and one-line reasons. State
  zero explicitly when there are none. What was deliberately left unfixed is
  decision material of the same weight as what was fixed; the scope judgment is
  verifiable nowhere else.
- Concrete steps for the user to check the result themselves. These
  instructions are for the user, not the agent: browser URL and concrete
  click/visual checks for UI, `curl` and expected status/body for API, the auth
  method when needed. A helper script under the ticket's tmp directory (the
  `tmp_dir:` path from `ticket.sh start`/`restore`; per-ticket layout:
  `tickets/<name>/tmp/`) is acceptable only when manual auth/cookie/setup is
  too awkward. Never present an `agent-browser` command list as the user's
  review procedure.
- Remaining known issues

If a required item cannot be produced, say so and say why, rather than
presenting the gate as complete.

## Where A Rule Belongs

When adding a rule, decide its location with three questions. If any answer
points to a skill, put it in the skill.

1. **Project-specific, or PDH-common?** Project-specific goes to `CLAUDE.md`;
   common goes to a skill or `PDH-AGENTS.md`.
2. **Always needed, or only in a specific situation?** `CLAUDE.md` and
   `PDH-AGENTS.md` are always in context; a skill loads only when invoked. Only
   a rule that causes an accident when absent earns a place in the always-loaded
   files.
3. **Who reads it?** If the role is identifiable — implementer only, PM only —
   it belongs to that role's skill.

Do not write the same rule in two places. When you move wording, sweep the
origin for leftovers.
