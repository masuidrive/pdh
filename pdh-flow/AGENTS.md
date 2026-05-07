# AGENTS.md (v2)

## Project

`pdh-flow` v2 is a schema-first ticket flow runtime: declarative flow YAML compiles to an XState v5 state machine, LLMs (claude / codex via subprocess) drive provider / guardian / repair steps, and the runtime owns durable state + commits.

The legacy v1 implementation is preserved read-only at `pdh-flow/v1/`.

## Read first

- `feature-spec.md` — design decisions, deferred features, open questions.
- `flows/pdh-c-v2.yaml` — the canonical ticket flow (11 nodes, full + light variants).
- `schemas/*.schema.json` — JSON Schema contracts (the primary contract layer).
- `src/engine/` — engine source (loader, macro expander, machine compiler, actors, persist).
- `src/cli/` — v2 CLI entrypoints (`check-flow`, `compile-flow`, `run-engine`).

## Local commands

Source nvm before Node commands:

```sh
source /home/masuidrive/.nvm/nvm.sh
npm run check                                       # tsc type-check
npm run gen:types                                   # regenerate src/types/generated/
npm run cli                                         # show CLI help
npm run cli -- check-flow --flow pdh-c-v2           # validate flow YAML
npm run cli -- compile-flow --flow pdh-c-v2         # print expanded flat-flow JSON
npm run test:all                                    # check + validate (36) + fixture-shape (32) + engine (21)
bash scripts/smoke-real-claude.sh                   # MANUAL: real claude smoke (NOT in test:all)
```

## Step type taxonomy

Four leaf node types + one structural primitive:

- **provider_step** — LLM (claude / codex) does narrative / code work. Engine appends LLM text to `current-note.md` as a section keyed by `node_id`, then commits. For implementer / repair roles the LLM also edits source via tool use.
- **guardian_step** — LLM-as-judge produces structured output (decision + reasoning + findings) constrained by the guardian-output schema. Engine validates (Ajv + semantic checks: round echo, evidence_consumed coverage) and freezes the judgement to disk for idempotency.
- **gate_step** — human (or other principal) decision. Engine waits for a gate-decision file under `.pdh-flow/runs/<runId>/gates/<nodeId>.json`. Fixture mode auto-replays from `meta.gate_decisions`.
- **system_step** — deterministic runtime work (close_ticket, release_lease, barrier, noop). No LLM.
- **parallel_group** (structural) — emerges from `review_loop` macro expansion. N reviewer regions in `xstate type:'parallel'`; barrier fires `onDone` when all reach final.

The `review_loop` macro is YAML sugar that expands at load time to the equivalent flat graph (parallel_group + N reviewer provider_steps + aggregate guardian_step + optional repair provider_step). The engine never sees macros.

## Runtime rules

- **Re-spawnability**: each node is idempotent. The durable state is `current-ticket.md`, `current-note.md`, source tree, git history, and `runs/<runId>/judgements/`; `runs/<runId>/snapshot.json` is bookkeeping for fast resume. If the engine dies mid-step, re-spawn on the same `runId` — judgement freeze short-circuits guardian re-evaluation; XState snapshot restores walking state when present (machine_hash must match the current compiled flow).
- **Single commit owner**: the runtime is the only writer of git commits. After each commit-bearing node (provider / guardian / gate / close_finalize) it stages and records ONE commit with subject `[<node_id>/round-<N>] <summary>`. Providers must not run `git commit` / `git rebase`; their durable changes live in the working tree until the runtime records them.
- **Reviewer-each-commits**: for `review_loop` macros every reviewer + aggregator + repair invocation produces its own commit. Worst-case (max_rounds × (N+1+1)) commits per review; accepted for audit / restart-granularity.
- **LLM output is evidence, not authority**: provider/guardian narrative goes to `current-note.md` for audit. The `decision` enum on guardian output (and only that field) routes transitions; `reasoning` is audit-only. Engine semantic validation (`evidence_consumed` coverage, `round` echo, `next_target_override` allowlist) catches out-of-band LLM behaviour.
- **Subscription auth via subprocess only**: the engine spawns the user's already-authenticated `claude` / `codex` CLI. No SDK direct integration (Anthropic / OpenAI ToS for subscription tokens). See feature-spec D-007.
- **Canonical state vs snapshot**: on conflict, `current-note.md` frontmatter + `judgements/` + git history win. Snapshot is fast resume only; corrupt or hash-mismatched snapshot is silently ignored.
- **`current-note.md` frontmatter is canonical runtime state** — what the engine reads to figure out where it is when no snapshot exists.
- **`current-ticket.md` is durable ticket intent** — never holds runtime metadata.
- **`.pdh-flow/` is gitignored, single-machine bookkeeping** — runs/, judgements/, snapshots, gate decisions. Do not commit it; do not assume it travels between machines.
- **Lease auto-acquire on start** (when `pdh-flow.config.yaml` exists): pool values written to `${worktree}/.env.lease` for dev tooling. Released on close. v1 leases.ts ships standalone; v2 engine integration is feature F-008 (in progress / deferred).

## Test rules

- **No real providers in tests** (`npm run test:all` must run fixture-replay only). `scripts/smoke-real-claude.sh` is manual and intentionally excluded — invoke it when validating wiring or recording a fixture, not on every check-in. Same applies to any future `smoke-*` script.
- **Fixture format**: `tests/fixtures/v2/<scenario>/{input/, meta.json}`. `input/` is the worktree snapshot at start; `meta.json` (validated against `tests/fixture-meta.schema.json`) declares per-node `note_section` / `summary` / `guardian_output` / `gate_decisions` / `files`. The engine reads `meta` and replays — no JSONL transcripts required.
- **Recording new fixtures**: when adding a scenario, run a real provider once via the smoke path, then craft a `meta.json` capturing the salient output. Don't hand-craft long LLM transcripts; capture only what the engine consumes.

## Commit rules

Commit in small checkpoints after a verified behaviour change. Use multi-paragraph commit messages with:

```text
Subject

Why: ...

What: ...

Verification: ...

Note: ...
```

`Verification` must list the actual commands run. If a real provider was used, say so explicitly. Don't claim unit/e2e coverage when only `npm run check` was run.

## What's gitignored

- `.env`, `.codex`, `.pdh-flow/`, `node_modules/`, `dist/`, `*.log`, `tmp/`, `coverage/`, `lib/`, generated smoke repos, provider transcripts.

## v1 reference

`pdh-flow/v1/` holds the legacy v1 codebase (src/, flows/, examples/, web/, lib/, tests/fixtures/old, scripts/test-runtime.sh, etc.) frozen as reference. New v2 code does NOT import from v1; if a v1 module is needed, copy specific functionality into the v2 tree rather than importing across the boundary. The v1 inner `.git` is preserved for restoring v1 deps if revival is ever needed.
