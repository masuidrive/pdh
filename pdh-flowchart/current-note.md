# current-note.md

<!-- pdh-flowchart:metadata:start -->
## pdh-flowchart Metadata

- Run: run-20260423084730-ws6hld
- Flow: pdh-ticket-core
- Variant: full
- Ticket: calc-cli
- Status: running
- Current Step: PD-C-2
- Updated: 2026-04-24T00:04:06.352Z
<!-- pdh-flowchart:metadata:end -->

## PD-C-2. 調査結果

- Current run state: `run-20260423084730-ws6hld` is still `running` on `PD-C-2`. The step artifacts present so far are `.pdh-flowchart/runs/run-20260423084730-ws6hld/steps/PD-C-2/prompt.md` and `.pdh-flowchart/runs/run-20260423084730-ws6hld/steps/PD-C-2/attempt-1/codex.raw.jsonl`.
- Ticket scope evidence is incomplete in the canonical records: repo-root `current-ticket.md` currently contains only the runtime metadata block, so the ticket Why/What/AC are not yet written there. The only repo-local `calc-cli` definitions I found are the smoke target in `src/smoke-calc.mjs` and the richer demo ticket in `examples/fake-pdh-dev/current-ticket.md`. No separate repo-local ticket document was found for this run.
- Current runtime execution path: `src/cli.mjs` owns `run`, `run-next`, `run-provider`, `resume`, gate commands, verification, and `smoke-calc`. `run-next` now auto-runs provider steps by default unless `--manual-provider` is set, then evaluates guards and advances until a human gate, interruption, failed guard, provider failure, or completion.
- Flow semantics for this run come from `flows/pdh-ticket-core.yaml`, `src/flow.mjs`, and `src/guards.mjs`. Provider prompts are generated from `src/prompt-templates.mjs`. Canonical note/ticket metadata syncing lives in `src/metadata.mjs`. Human gate summary generation, step commits, and `ticket.sh` hooks live in `src/actions.mjs`.
- Codex provider execution path for `PD-C-2`: `run-provider` writes the prompt artifact first, `src/codex-adapter.mjs` streams JSONL events into the raw log and stores a resume session id, and the runtime records a `note-ticket.patch` artifact only when `current-note.md` or `current-ticket.md` changed during the provider step.
- `calc-cli` surface 1 is the real-provider smoke target in `src/smoke-calc.mjs`. It seeds `/tmp/pdh-flowchart-calc-smoke`, writes a minimal ticket/note, asks Codex to build a small `uv run calc` application, and verifies only `uv run calc "1+2"` plus invalid-expression behavior. File history is short: it was introduced in the scaffold commit and later touched when provider timeout cleanup was added.
- `calc-cli` surface 2 is the fake `pdh-dev` fixture in `examples/fake-pdh-dev`. `examples/fake-pdh-dev/src/calc_demo/cli.py` currently allows only integer literals and `+`. `examples/fake-pdh-dev/scripts/test-all.sh` already expects `uv run calc "2*5+1"` to print `11` and `uv run calc "2**10"` to fail, so the fixture intentionally starts in a small failing state that maps cleanly to a PD-C implementation ticket.
- The most relevant recent design-history commits are: `e31468b` (runtime-managed metadata blocks in canonical note/ticket files), `a4b9ef1` (attempt-level `note-ticket.patch` artifacts for provider edits), `e42270d` (fake `pdh-dev` calc fixture with the intentional multiplication gap), and `6cc0706` (`run-next` auto-runs provider steps by default). These commits materially affect prompt contents, review artifacts, and the expected user path through the runtime.
- Blast radius if the ticket targets runtime behavior: `src/cli.mjs`, prompt/metadata/guard helpers, README/technical-plan/tasks, runtime scripts/tests, and any Web UI copy that mirrors next-step commands. Blast radius if the ticket targets the fake calc fixture: mostly `examples/fake-pdh-dev/src/calc_demo/cli.py`, fixture tests, fixture note/ticket docs, and README demo instructions.
- Main risks: the root `current-ticket.md` is still under-specified for later PD-C prompts and gate summaries; edits inside the runtime metadata markers will be overwritten by metadata sync; and changes to note/ticket handling have system-wide impact because those files feed prompts, guards, artifacts, and human gate summaries.
- External dependencies: Node commands require `source /home/masuidrive/.nvm/nvm.sh`; runtime state persists in `.pdh-flowchart/state.sqlite`; provider steps depend on authenticated Codex/Claude CLIs; the calc smoke/fixture paths additionally depend on `uv`, Python 3.11+, git, and `/tmp` write access.
- Real-environment verification needed later depends on the chosen scope. Runtime-only changes should at minimum use `npm run check` plus targeted CLI/user-flow checks, with `npm run test:runtime` when behavior changes. Fixture calc changes should use `uv run calc "1+2"`, `uv run calc "2*5+1"`, `uv run calc "2**10"`, and `scripts/test-all.sh`. `node src/cli.mjs smoke-calc` should remain an intentional real-Codex verification path, not a routine unit-style check.
