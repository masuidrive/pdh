See [AGENTS.md](./AGENTS.md) for the canonical contributor guide.

## Core design assumptions

### Re-spawnability (steps are idempotent)

Each node in the flow is designed to survive engine death + re-spawn. The durable state is `current-ticket.md`, `current-note.md`, the source tree, git history, and `runs/<runId>/judgements/<node>__round-<N>.json`. Everything else under `.pdh-flow/runs/<run>/` (snapshot.json, gate decisions, transcripts) is bookkeeping that can be rebuilt or recovered. If the engine dies mid-step, re-spawning on the same `runId`:

- reads any frozen judgement and skips guardian re-invocation,
- restores the XState snapshot if present and `machine_hash` matches,
- otherwise starts fresh from the variant's initial node and walks forward — durable state on disk tells the engine what's already done.

Do not introduce code paths that treat a dead engine as a permanent run failure.

### Single-machine assumption

`.pdh-flow/` is gitignored and is not designed to travel. A single ticket is worked on a single machine. If a hand-off is ever needed, rely on the durable state (ticket + note + judgements + git) and re-spawn on the new machine; do not try to ship `runs/` artifacts.

### Single commit owner

The runtime is the only writer of git commits in v2. After every commit-bearing node (provider_step / guardian_step / gate_step / close_finalize), the engine stages all changes and records ONE commit with subject `[<node_id>/round-<N>] <summary>`. Providers — including reviewers, repair agents, implementers — must not run `git commit`, `git rebase`, or anything else that mutates history. They produce durable artifacts (note + ticket + source) and let the runtime record them. This keeps the audit trail aligned with what the engine knows.

### LLM is evidence, not authority

LLM output flows into `current-note.md` for audit. Transitions are decided by:

1. The `decision` enum on guardian outputs (constrained by `guardian-output.schema.json` via `--json-schema` at the LLM call site, then re-validated server-side via Ajv).
2. The `decision` enum on gate outputs.
3. Deterministic on_done / on_failure edges for provider / system steps.

Free-form `reasoning` text is audit-only and never routes the flow. Engine semantic validation (round echo, `evidence_consumed` coverage, target whitelist) catches LLMs that try to surprise the flow.

### Subscription auth via subprocess only

The engine spawns the user's already-authenticated `claude` / `codex` CLI. No SDK direct integration — Anthropic / OpenAI ToS for subscription tokens prohibits third-party use of OAuth tokens including the official SDK. See feature-spec.md D-007.

### Canonical state vs snapshot

On conflict, `current-note.md` frontmatter + `judgements/` + git history win. `runs/<runId>/snapshot.json` is bookkeeping for fast resume; if corrupt or hash-mismatched, ignored silently and the engine starts fresh from canonical state.

## No real providers in tests

`npm run test:all` (= `check` + `test:validate` + `test:fixture-shape` + `test:engine`) must replay fixtures, never spawn real claude / codex. If a test needs a behaviour no fixture covers, record a new fixture out-of-band (via `scripts/smoke-real-claude.sh` or equivalent) and capture the salient output in `meta.json` — don't hand-craft LLM transcripts.

`scripts/smoke-real-claude.sh` is intentionally manual and excluded from `test:all`. Use it when:

- validating that real claude wires end-to-end,
- recording a new fixture,
- debugging a real-mode regression.

## Macros are YAML sugar, not engine concepts

`review_loop` (and any future macro) is expanded at load time into the equivalent flat graph (parallel_group + reviewer provider_steps + aggregate guardian_step + optional repair provider_step). The engine never sees macro nodes. New macros register in `src/engine/expand-macro.ts`; engine code (`compile-machine.ts`, actors) needs no changes.

## Schema-first contract

`schemas/*.schema.json` is the primary contract layer. Modifying a schema:

1. Edit the schema file.
2. Regenerate types: `npm run gen:types`.
3. Run `npm run check`.
4. Run `npm run test:all` — validation tests will catch breakage.

The TypeScript barrel at `src/types/index.ts` re-exports primary types from each generated `.d.ts` file (cross-file `$ref` causes json-schema-to-typescript to inline duplicates; the barrel picks one canonical source per type to avoid ambiguity).
