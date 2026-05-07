# pdh-flow v2 — feature spec / decision register

Working spec for the v2 rebuild. Captures **decisions made**, **deferred features** with adoption conditions, and **open questions**. Conversational design context is in chat history; this file is the durable summary that survives session boundaries.

Last updated: 2026-05-07.

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

### D-007: subscription-auth via subprocess only
No SDK direct integration (Anthropic / OpenAI ToS for subscription tokens). The engine spawns the user's authenticated `claude` / `codex` CLI as a child process. No alternative path is acceptable for subscription users.

### D-008: canonical state vs snapshot
`current-note.md` frontmatter + `judgements/` + git history are canonical. XState snapshot at `runs/<run>/snapshot.json` is bookkeeping for fast resume. On conflict, canonical wins; engine rebuilds machine from canonical when snapshot is missing or its `machine_hash` differs from the current compiled flow.

### D-009: dotted node ids → __ in XState state ids
Public NodeId form (e.g. `code_quality_review.devils_advocate_1`) is preserved in actor inputs / commit subjects / judgement filenames. XState internal state ids replace `.` with `__` because XState parses `.` as path navigation even in `#id` references. Mapping is internal to `compile-machine.ts`.

### D-010: in-flight tickets deleted on cutover
No migration helper. v2 starts on a clean slate; existing in-flight v1 tickets are closed or cancelled before the cutover. `tickets/done/` survives but is not migrated.

---

## Deferred features

### F-001: engineer-resume for repair (instead of separate repair node)
**Idea**: when `aggregate.repair_needed`, re-invoke the original `implement` node with `claude --resume <session-id>` (or codex equivalent), passing the blocking findings as new input. The engineer keeps their reasoning context.

**Worth doing**: yes — quality improvement, not just efficiency (subscription users don't pay per token, but fixes are sharper when the LLM remembers its own reasoning).

**Why deferred**: violates 3 design principles unless guarded:
1. **Re-spawnability**: session state is transient (timeout / machine restart); re-spawn after session loss can't resume.
2. **Audit**: repair-as-continuation makes round 2 commits indistinguishable from round 1 in git ancestry.
3. **Engine purity**: engine becomes responsible for tracking session ids per node × round, expanding its responsibility beyond pure orchestration.

**Adoption shape (when implemented)**: opt-in flag on the `review_loop` macro:
```yaml
- macro: review_loop
  repair:
    via: resume_implement       # default 'separate_node'
    fallback_to_fresh: true     # session lost → fresh invocation
```
- `via: separate_node` (current behavior) stays the default.
- Engine persists session id with the implement node's output. Repair node compiler swaps target back to `implement` and threads `--resume <id>` if available.
- Fallback to fresh invocation on session loss preserves robustness.

**Trigger to revisit**: after baseline v2 stabilizes and we have measurable quality data on multi-round repair scenarios with the current pure design.

### F-002: real provider invocation (drop fixture-only) — **DONE 2026-05-07**
~~Current `run-provider.ts` reads fixture meta...~~

Implemented in Phase G (Option A). Both reviewer and guardian actors are now dual-mode: when `fixtureMeta.node_outputs[nodeId][round-N]` is present, fixture replays; otherwise the actor invokes the real CLI. `src/engine/providers/{index,claude,codex}.ts` wraps `claude -p` and `codex exec`. Guardian uses `claude --json-schema --output-format json` (extracts `structured_output` from the result envelope) or `codex exec --output-schema`. Smoke verified end-to-end on `pdh-smoke-real.yaml` flow — claude produced a substantive review with real findings (AC-1 float-vs-int mismatch in calc demo), aggregator returned schema-conforming `repair_needed` with structured `blocking_findings`, engine validated and froze the judgement.

**Side discovery**: when a flow's `review_loop` macro has `repair: null`, the LLM may still legitimately decide `repair_needed`. Engine now falls back to `abort` target in that case (compile-machine.ts). Documented as fallback behavior.

**Remaining**: real fixtures should now be re-recorded against actual provider output once flows stabilize.

### F-003: full XState snapshot persist / restore
Current prototype tracks idempotency via judgement-freeze only. The full plan was to also persist the XState actor snapshot (`actor.getPersistedSnapshot()`) at every transition under `withRunLock`, with `machine_hash` validation on restore.

**Adoption shape**: `src/engine/persist.ts` — `saveSnapshot`, `restoreSnapshot`, `rebuildFromCanonicalState` (fallback when snapshot missing / hash-mismatch). Schema already defined at `schemas/snapshot.schema.json`.

**Trigger**: before running real flows of non-trivial duration. Prototype tests don't need it because they complete in <1s.

### F-004: rest-of-flow node implementations
Currently exercised E2E: only `code_quality_review`. Other nodes (`assist`, `investigate_plan`, `plan_review`, `plan_gate`, `implement`, `final_verification`, `close_gate`, `close_finalize`, `human_intervention`) are wired in YAML but not exercised. The most interesting one is `close_finalize` (system_step calling existing close logic).

**Trigger**: after F-002 (real provider) so each node gets a real exercise.

### F-005: Web UI v2
Step-type-driven viewer + gate approver + assist launcher. Renders 4 type-specific affordances:
- `provider_step` → tail logs + diff + cancel
- `guardian_step` → spinner / decision + reasoning
- `gate_step` → diff + reasoning + form fields + approve/reject buttons
- `system_step` → progress bar

**Trigger**: after engine surface stabilizes (F-002 + F-003). Before then, CLI is enough.

### F-006: AGENTS.md / CLAUDE.md refresh for v2
Current top-level docs are in `v1/`. New top-level docs need to be written for v2's vocabulary (provider_step / guardian_step / gate_step, parallel_group, judgement freeze, etc.). Should preserve v1's "single commit owner" + "LLM is evidence not authority" rules in updated form.

**Trigger**: after F-002 lands and the surface is stable.

### F-007: v2 publishable bin
`package.json` currently has no `bin`. Local invocation works via `npm run cli`. Before publishing, decide: keep TypeScript-strip path (Node 24+ only, no compile step) or restore `tsconfig.build.json` for a `lib/` build with traditional bin pointer.

**Trigger**: when ready to publish or distribute.

### F-008: lease integration into v2 engine
Existing `v1/src/runtime/leases.ts` works standalone (acquire/release CLI). v2 engine doesn't auto-acquire / auto-release leases yet. Integration: actor for `system_step` action `acquire_lease` and `release_lease`, plus engine startup hook that auto-acquires per `pdh-flow.config.yaml`.

**Trigger**: when v2 reaches first real-flow run on a multi-worktree setup.

### F-009: assist mode (interactive provider terminal)
v1's `src/runtime/assist/` provided an interactive terminal mode for stop-state intervention. v2 needs equivalent: a way to attach the user's terminal to a paused engine state and let them drive the provider manually.

**Trigger**: when human-gate workflow needs a human-driven repair loop (e.g. fixing what the LLM keeps getting wrong).

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
