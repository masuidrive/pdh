# pdh-flow v2 — feature spec / decision register

Working spec for the v2 rebuild. Captures **decisions made**, **deferred features** with adoption conditions, and **open questions**. Conversational design context is in chat history; this file is the durable summary that survives session boundaries.

Last updated: 2026-05-08.

---

## Status

**Active**: v2 engine prototype proven end-to-end on `code_quality_review` (5 reviewer + aggregator + repair, multi-round). 74/74 v2 tests green (`check` + `test:validate` 36 + `test:fixture-shape` 24 + `test:engine` 14).

**Frozen**: v1 in `pdh-flow/v1/` (read-only reference, not built or tested by default).

**Architecture**: schemas (JSON Schema 2020-12) → flow YAML (macros) → flat-flow → XState v5 machine → actor invocations (provider / guardian / gate / system). 4 step types + parallel_group structural primitive. Reviewer-each-commits audit policy.

---

## Decision record

### D-001: 4 step types + parallel_group
Provider / guardian / gate / system (4 leaf types) + parallel_group (structural). No additional types accepted unless a real-world flow requires it. New "kinds of work" should compose these primitives, not extend the type set.

### D-002: macros are YAML sugar, not engine concepts
`review_loop` is a loader-time expansion. Engine sees only flat-flow + parallel_group. Same applies to any future macro (e.g. `discussion_loop`). Engine never learns about macros.

### D-003: reviewer-each-commits (option B)
Each reviewer / aggregator / repair invocation produces its own commit. Worst case `(N+1)*max_rounds + repair*(max_rounds-1)` commits per review step. Accepted for audit / restart-granularity / blame benefits.

### D-004: human-gate is a first-class node
`gate_step` is a normal flow node, not a side-channel. Audit trail and engine restart are uniform across LLM-driven and human-driven decisions.

### D-005: guardian output schema is tight; reasoning is audit-only
`decision` enum, `summary`, `reasoning`, `evidence_consumed`, optional `next_target_override`. LLM cannot route the flow via prose — only the structured `decision` field has authority. Engine performs semantic validation (round echo, evidence coverage, target whitelist).

### D-006: judgement freeze on first success
Guardian re-invocation reads `runs/<run>/judgements/<node>__round-<n>.json` if present and skips the LLM call. This is the idempotency mechanism for non-deterministic LLM judges.

### D-007: subscription-auth via subprocess only — for tool-using roles
No SDK direct integration **with subscription tokens** (Anthropic / OpenAI ToS forbids third-party use of subscription OAuth tokens). For tool-heavy roles (assist / planner / reviewer / implementer / repair) the engine spawns the user's authenticated `claude` / `codex` CLI as a child process.

**Addendum (2026-05-08, F-010)**: Judges (`guardian_step`) have an additional path that uses **API keys via @ai-sdk/{anthropic,openai}**. API keys are developer-paid credentials, not subscription tokens; they're explicitly allowed by ToS. The CLI subprocess + `--json-schema` is best-effort (observed to drop `structured_output`, emit YAML, or wrap JSON in fences in `-p` agentic mode), which breaks the engine's "decision is the routing key" contract. The API path uses `generateObject()` which leverages tool_use / response_format for hard schema enforcement. Auto-detected via `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; falls back to CLI if neither is set. Override with `PDH_JUDGE_PROVIDER` / `PDH_JUDGE_MODEL`.

### D-008: canonical state vs snapshot
`current-note.md` frontmatter + `judgements/` + git history are canonical. XState snapshot at `runs/<run>/snapshot.json` is bookkeeping for fast resume. On conflict, canonical wins; engine rebuilds machine from canonical when snapshot is missing or its `machine_hash` differs from the current compiled flow.

### D-009: dotted node ids → __ in XState state ids
Public NodeId form (e.g. `code_quality_review.devils_advocate_1`) is preserved in actor inputs / commit subjects / judgement filenames. XState internal state ids replace `.` with `__` because XState parses `.` as path navigation even in `#id` references. Mapping is internal to `compile-machine.ts`.

### D-010: in-flight tickets deleted on cutover
No migration helper. v2 starts on a clean slate; existing in-flight v1 tickets are closed or cancelled before the cutover. `tickets/done/` survives but is not migrated.

---

## Deferred features

### F-001: engineer-resume for repair — **INFRA LANDED 2026-05-08, smoke pending**
**Idea**: when `aggregate.repair_needed`, re-invoke the original `implement` node with `claude --resume <session-id>` (or `codex exec resume <id>`), passing the blocking findings as new input. The engineer keeps their reasoning context.

**J1 (provider session capture, commit `be97e63`)**: `ProviderResult.sessionId` populated for every claude / codex invocation. claude unconditionally uses `--output-format json` so the envelope's `session_id` is captured even when no schema is set; codex switches to `--json` so `thread.started.thread_id` is read off the JSONL event stream. No behavior change for callers.

**J2 (provider resume invocation, commit `f450b04`)**: `ProviderInvocation.resumeSessionId`. claude appends `--resume <id>`; codex switches to the `codex exec resume <id> ...` subcommand (which inherits cwd / sandbox / output-schema from the recorded session, so we don't pass those flags).

**J3 (engine-layer persistence, commit `d7bda57`)**: `src/engine/session-store.ts` writes `runs/<runId>/sessions/<nodeId>.json` after each successful real provider invocation that surfaced a session id. Files are ephemeral — wiping `.pdh-flow/` falls back to fresh on next resume.

**J4 (macro flag + compile-machine wiring, commit `d7ec04a`)**: `review_loop.repair.via: separate_node | resume` macro field (default `separate_node`). When `resume`: `repair.resume_node` is required and the expander emits `resume_session_from: <node>` on the flat-flow `.repair` node. `run-provider.ts` reads the matching session record at runtime; on miss / provider mismatch, falls back to a fresh invocation with a stderr diagnostic.

**J5 (validation + smoke harness, commit `24de42e`)**: positive (`via=resume` parses, expander wires `resume_session_from`) and negative (`via=resume` w/o `resume_node` → SchemaViolation) tests in `test-validate.ts`. Companion artefacts:
- `flows/pdh-c-v2-resume.yaml`: variant of pdh-c-v2 where `code_quality_review.repair` uses `via: resume, resume_node: implement`.
- `scripts/smoke-real-resume.sh`: runs that flow on a chosen smoke fixture; expects `sessions/implement.json` to be written and the `.repair` commit (when reviewers escalate) to come from a resumed codex session.

**End-to-end smoke (cartbug, 2026-05-08)**: pdh-c-v2-resume completed `terminal` cleanly, ~10 commits, ~10 min wall clock. All 11 provider sessions (claude assist + 5 plan reviewers + plan_aggregator; codex investigate_plan / implement / 1 critical reviewer / code_quality_aggregator) were captured in `sessions/<nodeId>.json`. Confirmed:
- claude session_id flows through `--output-format json` envelope on every call (not just guardian).
- codex thread_id flows through `--json` JSONL `thread.started` event.
- Engine compiles `via=resume` flat nodes without error.

**Resume invocation itself remains unexercised** because cartbug's reviewers (correctly) returned `pass` on round 1, so `code_quality_review.repair` never fired. claude `--resume` and `codex exec resume` were verified manually at the CLI level (probes in scratch dirs); inside the engine we only know the read+write bookkeeping is correct.

**Caveats not closed by this smoke**:
- A fixture explicitly designed to make reviewers flag a Critical / Major issue is needed to confirm `--resume` actually fires inside the engine and the resumed codex session lands a useful patch.
- Three F-001 design concerns from the original deferral remain: re-spawnability after session loss (fallback to fresh covers it), audit ambiguity for resumed rounds (git subject still says `[node/round-N]`; resume is invisible without inspecting `sessions/`), and engine responsibility creep (now owns ephemeral session bookkeeping). All three judged acceptable, but worth tracking if they bite.

**Trigger to flip default**: a smoke against a deliberately-flawed fixture that exercises the resume invocation, plus a head-to-head comparison vs separate_node showing measurably better repair output.

### F-002: real provider invocation (drop fixture-only) — **DONE 2026-05-07**
~~Current `run-provider.ts` reads fixture meta...~~

Implemented in Phase G (Option A). Both reviewer and guardian actors are now dual-mode: when `fixtureMeta.node_outputs[nodeId][round-N]` is present, fixture replays; otherwise the actor invokes the real CLI. `src/engine/providers/{index,claude,codex}.ts` wraps `claude -p` and `codex exec`. Guardian uses `claude --json-schema --output-format json` (extracts `structured_output` from the result envelope) or `codex exec --output-schema`. Smoke verified end-to-end on `pdh-smoke-real.yaml` flow — claude produced a substantive review with real findings (AC-1 float-vs-int mismatch in calc demo), aggregator returned schema-conforming `repair_needed` with structured `blocking_findings`, engine validated and froze the judgement.

**Side discovery**: when a flow's `review_loop` macro has `repair: null`, the LLM may still legitimately decide `repair_needed`. Engine now falls back to `abort` target in that case (compile-machine.ts). Documented as fallback behavior.

**Remaining**: real fixtures should now be re-recorded against actual provider output once flows stabilize.

### F-003: full XState snapshot persist / restore — **DONE 2026-05-08**
Implemented in Phase H1. `src/engine/persist.ts` provides `saveSnapshot` / `restoreSnapshot` / `computeMachineHash`. Engine subscribes to actor.subscribe and saves on every transition; on startup, attempts restore (machine_hash must match). Atomic write via tmp+rename (single-machine assumption per CLAUDE.md). On hash mismatch / corruption, ignored gracefully and engine starts fresh (canonical state on disk is the authoritative fallback).

Test coverage: snapshot.json saved during run, validates against schema, second run on same worktree restores cleanly (`restoredFromSnapshot: true`). 17/17 engine tests pass.

`rebuildFromCanonicalState` (originally planned as the fallback) is currently a no-op — the engine just starts fresh from variant.initial when snapshot is missing. Canonical state rebuild is only needed when restoring partial progress, which fixture-replay tests don't exercise. Defer until a real long-running flow needs it.

### F-004: rest-of-flow node implementations — **DONE 2026-05-08**
Phase H2 + H5.

H2 added:
- **Role-aware provider prompts** (`buildPromptForProvider` in `actors/run-provider.ts`): `assist`, `planner`/`investigator`, `implementer`/`repair`, default reviewer. Each role gets a tailored prompt re: tool access (read-only vs. edit), output format, and guardrails (e.g. implementer is told never to `git commit`).
- **gate_step actor** (`actors/await-gate.ts`): dual-mode (fixture replays gate_decisions[nodeId]; real polls `<worktree>/.pdh-flow/runs/<runId>/gates/<nodeId>.json`).
- **close_finalize**: `system_step.action: close_ticket` writes a closed marker.

H5 validated the new role prompts with real LLMs via `scripts/smoke-real-roles.sh`:
- assist (claude) → wrote a structured `## Status` section, even flagged `/` vs `//` as a concern for the implementer
- planner (codex) → produced a detailed plan with files, test strategy, isinstance check, risks/mitigations
- implementer (codex with `--sandbox workspace-write`) → actually edited `calc.py` (added `divide`) and `test_calc.py` (added 2 tests, switched to unittest because pytest wasn't installed), ran `python -m unittest -q` and verified 5 tests passed
- 4 commits in chain, snapshot persisted at xstate value=done, full E2E ~3 min

Side fix: added `editable: boolean` to ProviderInvocation; claude gets `--permission-mode bypassPermissions` when true, codex gets `--sandbox workspace-write`. Defaults to false (read-only) for assist/planner/reviewer roles.

**Remaining (out of F-004 scope)**: a real E2E run of the FULL pdh-c-v2 (assist → investigate_plan → plan_review → plan_gate → implement → code_quality_review → final_verification → close_gate → close_finalize). H5 covered the new roles in isolation; the full chain with multi-reviewer + repair loops is exercise of existing prototype work (Phase E + G), not new role validation. Defer to a future "v2 first real ticket" milestone.

### F-010: full pdh-c-v2 real E2E + API-direct judge transport — **DONE 2026-05-08**
Phase H6: drove pdh-c-v2 (full variant) end-to-end with real claude+codex on the divide-fn ticket. 7 runs surfaced 5 separable bugs, each fixed in place:

1. **Slim CLI guardian schema didn't constrain `evidence_consumed` strings** → enum-locked to expected reviewer ids.
2. **Slim guardian schema didn't constrain `Finding.raised_by`** (engine-side full schema rejects non-NodeId strings) → enum-locked findings' raised_by.
3. **`buildGuardianPrompt` framed inputs as "reviewers"** → confused `final_verification` (whose input is an aggregate, not a reviewer) → reframed as "upstream input nodes".
4. **CLI `--json-schema` is best-effort in `-p` agentic mode** — observed claude emit YAML, code-fence-wrapped JSON, or drop `structured_output` → introduced **API-direct judge transport** via `@ai-sdk/{anthropic,openai}` `generateObject()` for hard schema enforcement (see D-007 addendum).
5. **`compile-machine.ts` ignored `node.inputs_from`** when building `expectedEvidenceNodes` → only parallel-group membership was wired → `final_verification` got `[]` → API rejected slim schema's empty `enum`. Fixed: prefer `inputs_from` when present.

**Final passing run**: 7th attempt completed `terminal` state in ~12 min. 16 commits, 3 frozen judgements (plan_review.aggregate, code_quality_review.aggregate, final_verification). API judge cost ≈ 26K tokens (sonnet-4-6) / **~$0.09 per ticket**.

**Side observation**: API judge (sonnet-4-6 reading inlined ticket+note) made noticeably better calls than the CLI judge — e.g. correctly absorbed `plan_review.critical_1`'s misapplied "Major" finding (about implementation status, not plan defects) as `pass` instead of triggering an unwarranted plan-repair loop.

**Smoke runner**: `scripts/smoke-real-fullflow.sh` (excluded from `npm run test:all` per the no-real-providers rule).
**Fixture**: `tests/fixtures/v2/smoke-fullflow-divide/`.

**Remaining gaps captured** (deferred):
- ~~Plan-repair vs code-quality-repair semantics~~ — **fixed in follow-up commit `1f77a26`**: `buildReviewerPrompt` gained a `mode="plan"` branch (forbids "X is not yet implemented" findings), and `buildImplementerPrompt` gained `mode="plan_repair"` (refine the plan in current-note.md, do not edit source). Verified by re-running the power ticket: critical_1 returned No Critical/Major and plan_repair did not fire, vs. the previous run that fired plan_repair and let it write source code.
- `--timeout-ms` CLI flag added (40 min cap) for full-flow runs; default 20 min stays for shorter flows.

**n=6 reproducibility** (Phase H7): drove pdh-c-v2 against six different tickets — divide, power, modulo, clamp, percentage, cartbug. All six completed `terminal` cleanly; `plan_review.critical_1` returned `No Critical/Major` 6/6 (the b-fix holds across ticket shapes); `code_quality_review.repair` never fired (every implementation reached pass on first review). Per-ticket judge cost was 26-31K tokens (~$0.08-0.10).

The cartbug fixture deliberately seeded an `eval()`-based `parse_amount` helper that the new `cart_total` consumes, hoping to trigger code_quality_review.repair via a security finding. Reviewers correctly recognized the RCE risk but scoped it as Minor: the eval was preexisting and the ticket explicitly required reusing `parse_amount`, so it was not a blocking finding for this commit. This is correct behavior under the engine's contract — reviewers were intelligent enough to scope-correctly, not an oversight. Triggering code_quality_review.repair will require either a genuine new defect introduced by the implementer or a ticket whose AC the implementer can plausibly miss.

Externalised actor prompts to `flows/prompts/*.j2` (nunjucks, follow-up commit `1a399aa`) — six templates: assist, planner, implementer (modes: default/plan_repair/code_quality_repair), reviewer (modes: default/plan), guardian-cli, guardian-api. Behaviour-equivalent to the inline prompts; verified by smoke-rerun.

**Smoke fixtures** (all under `tests/fixtures/v2/smoke-*` and excluded from `npm run test:all`):
`smoke-fullflow-divide`, `smoke-fullflow-power`, `smoke-fullflow-modulo`, `smoke-fullflow-clamp`, `smoke-fullflow-percentage`, `smoke-fullflow-cartbug`.

### F-005: Web UI v2 — **MVP-B DONE 2026-05-08** (Phase H8)
Step-type-driven viewer + gate approver + assist launcher. Long-term shape (deferred):
- `provider_step` → tail logs + diff + cancel
- `guardian_step` → spinner / decision + reasoning
- `gate_step` → diff + reasoning + form fields + approve/reject buttons
- `system_step` → progress bar

**MVP-B (shipped)**: minimal viewer + gate approver, zero build step. Backend `src/web/server.ts` is a `node:http` HTTP server with no dependencies; reads run state directly from `<worktree>/.pdh-flow/runs/<runId>/`. Frontend `web/index.html` + `web/app.js` is plain JS + Tailwind via CDN, polls every 2 s. Launched via `pdh-flow serve --worktree <dir> [--port 5170]`.

API surface:
- `GET /api/runs` — list runs (run-id, ticket, current state, saved_at).
- `GET /api/runs/:runId` — snapshot summary + frozen judgements + gate decisions + active-gate hint.
- `GET /api/runs/:runId/note` — current-note.md raw text.
- `POST /api/runs/:runId/gates/:nodeId` — write a gate decision (validated against `gate-output.schema.json`); engine's `await-gate` actor picks it up within ~1 s.

Frontend renders run summary, judgement table, gate decision history, and an approve / reject / cancel form when `active_gate` is non-null. `via: web_ui` field tags decisions for audit. Duplicate POST returns 409 (cannot re-decide a decided gate).

**Smoke** (manual; not in `npm run test:all`): seed a worktree from a fixture, run engine to a gate stop point, `pdh-flow serve`, then drive a real Chromium via `agent-browser` (CDP). The smoke runs through the full happy path: open homepage → click Open on the run → land on detail page with `Approval needed: close_gate` → fill approver → click Approve → engine picks up the gate file and advances → UI shows `closed` badge + `terminal` state. Verified `/api/runs`, summary, gate POST, duplicate-POST 409, static-file fallback all work.

**Phase H8 follow-up (SSE)**: the initial 2 s polling clobbered any in-flight form input on every snapshot rewrite (the entire app DOM was replaced). Replaced with SSE: backend `GET /api/runs/:runId/events` and `GET /api/runs-events` use `fs.watch` on the relevant directories with a 100 ms coalescing debounce; frontend subscribes via `EventSource`, refetches summary + note on each `change`, and replaces only those card containers whose data changed. The `gate-card` is preserved verbatim while `active_gate` is unchanged so partially-typed approvals survive engine snapshot writes. Smoke re-verified via agent-browser: input values persist across 5 s of background activity, then submit + approve flow lands on terminal.

**Deferred (post-MVP)**: diff modal, assist mode launcher, ticket index page with explicit history, multi-session support, React/Vite re-platform if visual polish becomes a constraint. The current vanilla-JS path was chosen to ship a usable Web UI quickly; nothing here blocks a later React/Vite swap that reads the same JSON API.

### F-006: AGENTS.md / CLAUDE.md refresh for v2 — **DONE 2026-05-08**
Phase H3 wrote `pdh-flow/AGENTS.md` and `pdh-flow/CLAUDE.md` for v2. Covers:
- Step type taxonomy (provider / guardian / gate / system + parallel_group)
- Re-spawnability + judgement freeze + snapshot bookkeeping
- Single commit owner + reviewer-each-commits
- LLM-is-evidence rule with the three authority sources (decision enum, gate enum, deterministic edges)
- Subscription-auth-via-subprocess constraint (D-007)
- Schema-first workflow (`gen:types` → `check` → `test:all`)
- "No real providers in tests" rule preserved from v1
- v1 reference / non-import policy

v1 docs preserved at `v1/AGENTS.md` + `v1/CLAUDE.md`.

### F-007: v2 publishable bin
`package.json` currently has no `bin`. Local invocation works via `npm run cli`. Before publishing, decide: keep TypeScript-strip path (Node 24+ only, no compile step) or restore `tsconfig.build.json` for a `lib/` build with traditional bin pointer.

**Trigger**: when ready to publish or distribute.

### F-008: lease integration into v2 engine — **DONE 2026-05-08**
Phase H4 copied v1 lease modules to `src/engine/leases/{leases,env-lease,locks}.ts` (no v2-from-v1 import; v1 stays a reference). Wired `system_step.action: acquire_lease` and `release_lease` to the copied logic. Threaded `ticketId` through engine context.

Phase H7 finished the auto-boundary case: `runEngine` now reads `pdh-flow.config.yaml` at startup; if pools are declared, it acquires the ticket's leases before `machine.start` and releases them in a `finally` block (covers success, failure, and timeout paths). Idempotent with explicit `system_step.acquire_lease` nodes — `acquireForTicket` returns the existing lease for a `ticket_id+pool` pair, so wired-in nodes still work.

Test coverage extended: `scripts/test-engine-prototype.ts` now seeds a config.yaml into a `gate_system_happy` worktree, pre-acquires a lease for an unrelated ticket, runs the engine, and asserts the ticket's lease was released, `.env.lease` was cleaned up, and the unrelated ticket's lease survives. 35/35 engine tests pass.

### F-009: assist mode (interactive provider terminal) — **v1 LANDED 2026-05-08**
v1's `src/runtime/assist/` provided an interactive terminal mode for stop-state intervention. v2 lands a thin wrapper:

```
pdh-flow assist --run-id <runId> --node-id <nodeId> [--worktree <dir>] [--dry-run]
```

Reads `runs/<runId>/sessions/<nodeId>.json` (the F-001/J3 record) and execs the matching interactive resume — `claude --resume <session_id>` or `codex resume <session_id>` — with the worktree as cwd. The user lands inside the same conversation the engine was driving. When done, they exit normally and deliver any decision back via `pdh-flow turn-respond`.

**Boundary kept intact**: assist's transcript stays in the provider CLI's own session storage; it never feeds back into the engine except via the structured `turn-answer.json`. The engine's determinism contract (replay, fixture-driven tests) is unaffected — assist is a UX layer on top of F-012's turn primitives, not a replacement for them.

**Verified**: --dry-run inspection for both claude and codex session records returns the right exec command. End-to-end interactive smoke is left to ad-hoc human use; the wrapper is small enough that adding an automated test would be testing `child_process.spawn` rather than anything we own.

**Term-webui (browser-embedded terminal, 2026-05-08, commit `1224749`)** — port of v1's TerminalModal pattern:
- backend: `src/web/assist-terminal.ts` spawns claude/codex via `@lydell/node-pty`, broadcasts I/O over a `ws` `WebSocketServer` upgraded on `/api/assist/ws`. Per-session state holds a rolling 300 KB output buffer (replayed on reconnect), a clients set (multi-tab broadcast), and 30-min retention after exit.
- backend: `POST /api/assist/open { run_id, node_id }` reads `runs/<runId>/sessions/<nodeId>.json` (the F-001/J3 record) and spawns `claude --resume <id>` or `codex resume <id>` in a PTY. Returns `{ sessionId, status, reused, title, command }`.
- assets: `/assets/xterm.js`, `/assets/xterm-addon-fit.js`, `/assets/xterm-addon-web-links.js`, `/assets/xterm.css` are served by the existing serve out of `node_modules/@xterm/...` at request time (v1 pattern; no separate build step for the vanilla Web UI).
- frontend: vanilla-JS `web/app.js` modal — xterm + addon-fit + addon-web-links lazy-loaded via script tags on first open; `<dialog id="term-modal">` reused across opens; quick-key bar (Enter/Esc/Tab/arrow keys/y/n/^C/^D) attaches control sequences as JS data; reconnect with exponential backoff; ResizeObserver fires fit() + sends `{type:"resize", cols, rows}` to backend.
- integration: turn card on the run detail page gains an "Open in terminal" button next to "Submit answer". Click → `openTerminalForNode(runId, nodeId)`. Gate card NOT wired (gate nodes don't spawn providers; opening "fresh assist for an arbitrary worktree" is a separate feature).
- real-LLM browser smoke (agent-browser, 2026-05-08): clicking the button opens the modal, xterm renders, claude shows its trust prompt + API-key prompt, the Enter quick-key sends `\r` and the LLM advances to the next prompt. Closing the modal cleanly tears down the WS but leaves the PTY for 30 min in case of reconnect. Submitting the regular answer form afterwards still resumes engine-side cleanly (the engine spawns its own short-lived `claude --resume` process; the assist PTY is parallel and doesn't block).

**`--turn` shortcut + gate card terminal (2026-05-08)**:
- `pdh-flow assist --turn` scans `<worktree>/.pdh-flow/runs/*/turns/*/turn-NNN-question.json` for the unique unanswered question and auto-targets it (no need to type `--run-id`/`--node-id`). Errors out on 0 or 2+ unanswered questions; prints the auto-detected triple to stderr.
- `POST /api/assist/open` accepts `mode: "fresh"` which spawns a plain `claude` (no `--resume`) in the worktree, bypassing the `sessions/<nodeId>.json` requirement. Used by the gate card's "Open in terminal" button — gates don't capture provider sessions, but having a worktree-scoped claude session is useful for inspecting diffs / asking the LLM "is this safe to approve?" before clicking Approve/Reject.
- Browser smoke (agent-browser CDP, 2026-05-08): stubbed a worktree at `current_state=plan_gate`, opened the run detail page, gate card rendered with Approve/Reject/Cancel run + the new "Open in terminal" button, click → modal opens with title `claude (fresh) — plan_gate`, claude shows its trust prompt in the xterm host, quick-keys bar present. Confirms backend mode switch + frontend wiring + visual rendering.

**Still possible (not built)**:
- assist sub-commands like `:answer "..."` that auto-run `turn-respond` on exit (would require parsing the transcript or wrapping the provider's stdin — fragile due to claude's own slash-command UX)
- inline "Submit answer" form inside the terminal modal (unblocks one tab from chatting + answering, but the modal-close → form-submit two-step works fine for now)

### F-011: ticket-centric data layout migration
After H8 the v2 engine still mirrored v1's storage shape: `current-ticket.md` and `current-note.md` at worktree root, audit reasoning attached to the project repo via reviewer-each-commits (D-003), `.pdh-flow/runs/<runId>/closed.json` and friends as the only structured record of gate decisions. Long-running operation showed three problems: (a) only the latest ticket's note was directly readable from the worktree (older tickets buried inside `git log -p -- current-note.md`), (b) gate approver records and frozen judgements were trapped inside the ephemeral `.pdh-flow/` tree, and (c) project git accumulated per-reviewer audit churn that no one bisects against.

**Three-layer model** (decided 2026-05-08):

```
Durable layer    tickets/<slug>.md           ← mutable contract (project git)
                 tickets/<slug>-note.md      ← append-only journal (project git)
Working layer    current-ticket.md → tickets/<slug>.md       (symlink, gitignored)
                 current-note.md   → tickets/<slug>-note.md  (symlink, gitignored)
Engine layer     .pdh-flow/runs/<runId>/                     (ephemeral, wipe-safe)
                   snapshot.json / gates/ / judgements/
```

`tickets/<slug>.md` becomes the canonical single source for the ticket-level outcome (description / AC / constraints / Out of scope / Resolution). `tickets/<slug>-note.md` is the full process journal. Both are flat in `tickets/`, paired by filename prefix; retrieval uses `find tickets/ -name '*.md' -not -name '*-note.md'`. Cross-machine resume is explicitly out of scope (D-010 reaffirmed) — `.pdh-flow/` may be wiped at terminal.

**Role split** (final):

- **ticket** is a mutable contract. `# Description` / `# Acceptance Criteria` / `# Constraints` are written by the human at open and edited in place by `assist` / `PD-C-1` to refine scope. `# Out of scope` is appended by aggregator nodes when a Minor is accepted. `# Resolution` is appended by the close handler at terminal. Editing authority is enforced per-actor (post-commit diff check against a section whitelist).
- **note** is append-only. Provider / guardian prose, gate decisions echoed by the engine (Gap B), and the terminal section all land here.

**D-003 dropped** as part of this migration. Commit boundary moves from per-reviewer to per-meaningful-step (~8 commits / clean run instead of ~16). Reviewer-level audit lives in note section headers, not git commits.

**Phasing (H10-1 .. H10-8)**:

- H10-1: layout move (`tickets/`, symlinks, `.gitignore`, fixture/try-it.sh updates)
- H10-2: `.pdh-flow/` ephemeral declaration — drop `closed.json`, status moves to note frontmatter
- H10-3: drop D-003, condense commit boundaries
- H10-4: Gap B — engine echoes gate decisions to note
- H10-5: section enforce — actor → ticket section whitelist + post-commit diff verification
- H10-6: Gap A — aggregator writes Out of scope to ticket directly
- H10-7: Gap C — close handler writes Resolution to ticket
- H10-8: Web UI switches to `/api/tickets` (list from `tickets/` + frontmatter parse); gate POST stays on `.pdh-flow/runs/.../gates/<node>.json` as the engine I/O channel

**Open sub-questions**:

- Whether to wipe `.pdh-flow/runs/<runId>/` automatically at terminal or keep it for one-run-window inspection (lean: keep, with a `--gc` flag).
- Whether `assist` and `PD-C-1` write to ticket via raw edit (current) or via a `system_step`-mediated proposal (safer but adds indirection). Decided: **raw edit** — format is not fixed enough to mediate.

### F-012: dynamic in-step user-input (request_human_input as a turn primitive) — **K1..K6 LANDED 2026-05-08, real-LLM smoke green**
Today the only way for a flow to request user judgement is a static `gate_step` declared in the flow YAML. That covers approval gates the flow author predicted, but not the case where a provider mid-task realises it needs a scoped decision from the human (e.g. "should the breaking change be silent-drop or 422?", "is reasoning_effort in scope?"). Currently the provider has to either guess and document the assumption, or fail and let the close_gate be the catch-all — both lossy.

**Progress (commit chain `9d2adae` → `354f48a`)**:
- **K1** (`9d2adae`): three new schemas — `provider-step-output` envelope (`kind: 'final' | 'ask'`), `turn-question` (persisted under `runs/<runId>/turns/<nodeId>/turn-NNN-question.json`), `turn-answer`. ProviderStepNode gains `enable_user_input: boolean` (default false) so the new behavior is opt-in per flow node.
- **K2** (`dccf5a7`): turn loop in `run-provider.ts`. When `enable_user_input` is true, the actor invokes the provider with the envelope schema + an instruction prompt; on `kind: 'ask'` it persists the question, polls for the answer, and resumes the provider session via `--resume` (claude) / `codex exec resume` (codex) using the F-001/J2 plumbing. Codex's resume can't take `--output-schema`, so the schema is enforced only on the initial call and `parseEnvelope` falls back to fenced-JSON / raw-text-as-final on resume turns. Cap `TURN_LOOP_MAX_TURNS=10`. New `turn-store.ts` module mirrors `await-gate.ts` polling shape.
- **K3-mini** (`354f48a`): replay-mode test that spawns `runProvider` with `fixtureMeta.turns: [{question, answer}]` and verifies both files land + validate + the note section is still applied.

**K4 (`a18b95e`)**: `pdh-flow turn-respond` CLI. `--list` lists pending question files; without `--turn`, auto-picks the lowest unanswered. Auto-reads round from the question file and writes a schema-validated `turn-NNN-answer.json`.

**K5 (`8828098`)**: Web UI in-step turn detection + answer form. `RunSummary.active_turn` lights up when an unanswered question file exists; the frontend renders a question card with options (radio buttons), context (collapsible), and an answer textarea. POST `/api/runs/:runId/turns/:nodeId/:turn` validates against `turn-answer.schema.json` and writes the answer. SSE watcher includes `turns/` so the card appears live.

**K5 browser smoke (2026-05-08, agent-browser CDP)**: drove the full happy path through real Chrome — ticket appears on home, click Open lands on detail page, engine runs through to question, turn card renders with 3 radio options, fill textarea + responder + click "beret" + click Submit → answer file written with `via: web_ui`, `selected_option: 2`, `responder: browser-smoke`; engine resumes via `claude --resume`; final paragraph quotes the answer ("black wool beret", "no embellishments"); UI re-renders with `terminal` state and the turn card disappears. End-to-end UI cycle verified.

**K6 (real-LLM smoke, 2026-05-08)**: `flows/pdh-turn-smoke.yaml` + `flows/prompts/turn-smoke.j2` + `scripts/smoke-real-turn-loop.sh`. End-to-end on real claude: provider emits `kind: ask` with 3 hat-type options after 12s; CLI delivers `--text "I'd like a fedora — gray felt, narrow brim"`; engine resumes via `claude --resume` (using the captured session_id); provider emits `kind: final` with a one-paragraph fedora description that explicitly used the answer text; engine reaches `terminal`. Note section captured the final paragraph + a "Turn 1 — asked / User answered" log.

**What this run validated end-to-end**:
- F-001/J1 (claude session_id capture from JSON envelope) — the question file's `session_id` matched the resume target.
- F-001/J2 (claude --resume invocation) — second turn used the captured session.
- F-012/K2 (envelope parsing + polling + resume) — `kind: ask` and `kind: final` both round-tripped, the answer text reached the LLM, and `final.details` quoted the answer back.
- F-012/K4 (CLI answer delivery) — the response file written by `pdh-flow turn-respond` was picked up by the engine within the polling interval.

The unverified F-001 path (codex `exec resume` inside `code_quality_review.repair`) uses the same provider-resume machinery K6 just exercised for claude — judged sufficient until a future deliberately-flawed fixture forces `repair_needed`.

**Idea**: extend `provider_step` and `guardian_step` so the actor can return a `request_human_input` tool call mid-execution. The engine catches it, persists the question + context, suspends the step, accepts a structured answer (web UI button, `pdh-flow gate respond`, or — eventually — an assist session), and resumes the **same step** with the answer threaded into the LLM's session.

**Framing decision**: this is **a turn within a step**, not a new round. The step's git commit boundary is unchanged (one commit per step on completion). `round` counter is untouched (it's review-loop semantics, not user-interaction semantics). Multiple Q+A turns per step are allowed.

**Architecture**:
```
src/engine/run-provider.ts
  ├─ spawn provider with tool schema including request_human_input
  ├─ on tool call → save .pdh-flow/runs/<runId>/turns/<nodeId>/turn-NNN-question.json
  ├─ wait for .pdh-flow/runs/<runId>/turns/<nodeId>/turn-NNN-answer.json
  ├─ resume provider session (claude --resume / codex equivalent) + inject answer
  └─ on final structured output → step completes, single commit, turns/ wiped
```

`turns/<nodeId>/session.json` records the provider session id (best-effort optimisation). Crash recovery: re-read turns/, attempt session resume, on resume failure fall back to fresh spawn with all Q+A replayed in the prompt context.

**Why deferred**:
1. **F-001 dependency**: needs the same provider session-id plumbing as engineer-resume. Worth landing F-001 first (or together) so the provider abstraction grows the resume API once.
2. **Tool schema design**: `request_human_input` shape (free-form question? structured options? attachments?) wants to be informed by 2-3 real provider runs that hit cases the static gate can't cover. Premature specification risks an awkward API.
3. **No current pain**: F-010's n=6 reproducibility runs all completed without a single mid-step "I don't know what you want" failure. The flow + assist + close_gate combination has been sufficient. Demand-driven, not principle-driven.
4. **Replay semantics**: fixture replay needs to record the Q+A pairs, not just the final output. Manageable but expands the fixture format.

**Relationship to existing features**:
- **F-001 (engineer-resume)**: shares the provider resume primitive. Implementing F-012 first would create the resume API; F-001 then becomes a flag flip on the repair node. Reverse order also works.
- **F-009 (assist mode)**: assist is the *optional UX layer* on top of F-012, not a replacement. The engine I/O contract is the structured answer file under `turns/`; assist's job (when launched) is to converse with the user and emit that answer. Keeps determinism boundary intact.
- **D-004 (gate as first-class node)**: `gate_step` stays for predictable approvals (plan_gate, close_gate). F-012 covers the unpredictable case. Both coexist.

**Adoption shape (when implemented)**:
- Add `request_human_input` to provider tool schemas; semantic validation (engine checks the question has a non-empty `question` and at least 0..N `options` of the declared shape).
- New ephemeral path: `.pdh-flow/runs/<runId>/turns/<nodeId>/turn-NNN-{question,answer}.json`.
- Provider abstraction grows `resumeSession(sessionId, userMessage)`; both claude and codex CLIs support resume (verified 2026-05-08).
- Web UI gains a turn-aware view (current `gate-card` generalises).
- Replay fixture format gains `node_outputs[nodeId][round-N].turns: [{question, answer}]`.

**K-phase plan (when work starts)**:

1. **K1 — output envelope schema**: define a small `provider-step-output.schema.json` with `kind: "final" | "ask"`, plus `final` / `ask` bodies. Used as the `--json-schema` for claude and `--output-schema` for codex on the *initial* call. Define `turn-question.schema.json` and `turn-answer.schema.json` for the persisted turn files.
2. **K2 — turn loop in `run-provider.ts`**: opt-in via a flow-node flag (e.g. `provider_step.enable_user_input: true`). Wrap the existing single-shot invocation in a loop that:
   1. invokes provider (initial or `resumeSessionId` from prior turn),
   2. parses output as envelope,
   3. on `kind: "final"` → break, append to note, commit (single commit per step, unchanged),
   4. on `kind: "ask"` → write `turns/<nodeId>/turn-NNN-question.json`, poll for `turn-NNN-answer.json` (reuse pattern from `await-gate.ts`), then loop with the answer text as the next user message.
   The session id captured per turn is updated under `sessions/<nodeId>.json` each time (claude returns a new session id per call; codex's stays the same — both code paths handle this by always overwriting).
3. **K3 — fixture + replay coverage**: extend `node_outputs[nodeId][round-N]` to optionally carry a `turns: [{question, answer}]` array. Replay mode walks the array, writing question/answer files in lockstep so the loop completes without real CLI calls.
4. **K4 — answer delivery CLI**: `pdh-flow turn respond <runId> <nodeId> [--text "..."]` (and JSON via stdin for structured options). Symmetric with `gate respond`.
5. **K5 — Web UI**: detect active turn question files in the run dir; render the current `gate-card` UI but with `turn`-aware fields. POST writes the answer file. Keep the SSE pattern from F-005.
6. **K6 — real-LLM smoke**: a fixture that nudges the provider into asking at least once. Initial provider role is implementer (codex) since it has the most natural decision-points; eventual coverage extends to assist / planner.

**Known constraint discovered while landing F-001 (2026-05-08)**: `codex exec resume` does not accept `--output-schema`, so a resumed turn cannot re-impose the envelope schema on codex; the LLM must remember the format from the initial system prompt. This is fragile if the answer is long / distracts the model. Two mitigations available without changing scope: (a) keep K2 claude-only initially (claude `--resume` accepts `--json-schema`); (b) post-parse codex's resume response and, on schema miss, send a sentinel "please re-emit your last response in the envelope format" follow-up turn. Both deferrable until K6 reveals which is needed.

**Trigger to start**: first real flow where a provider hits a decision it cannot reasonably make alone *and* the static gate would be wrong (too late, too coarse, or in the wrong actor's hands).

---

## Open questions

### Q-001: should `final_verification` use a separate guardian or just be the close gate's input?
Current flow has `final_verification` (guardian_step) → `close_gate` (gate_step). Slight redundancy: guardian decides "ready for close", then human reconfirms. Could collapse to just `close_gate` reading from `code_quality_review.aggregate` directly. Decide before the flow has been used in anger.

### Q-002: `inputs_from` for non-aggregate guardians
The guardian schema's `inputs_from` is a free list. Non-aggregator guardians (e.g. `final_verification`) may want to consume multiple sources (last code_quality_review, AC table from current-note.md, full ticket frontmatter). Current schema accepts list of NodeIds; not all sources are nodes. Need a more general "input source" schema if more guardian types emerge.

### Q-003: variant-keyed `max_rounds`
Currently a single integer per macro. Some flows may want `max_rounds: { full: 6, light: 2 }`. Defer until a flow needs it.

### Q-004: replay fixtures for real provider transcripts
Current v2 fixtures encode "what files the provider should write". Real provider runs produce JSONL transcripts that have value as evidence. Decide whether to also capture and replay those, or treat them as ephemeral.

---

## What's NOT planned

These aren't deferred — they're explicitly out of scope for v2:

- **Multi-machine / network coordination** (`single-machine` is a hard architectural assumption)
- **TTL-based expiration of leases / runs** (long dev sessions get miscollected; explicit release only)
- **LLM provider plurality beyond claude / codex** (others added if a user has subscription auth + CLI)
- **Web-first / cloud editor mode** (CLI is the primary surface, Web UI is a viewer)
- **Generic workflow framework** (pdh-flow is opinionated about the PD-C ticket flow, not a Temporal-style general engine)
