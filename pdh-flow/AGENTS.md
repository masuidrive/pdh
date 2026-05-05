# AGENTS.md

## Project

`pdh-flow` turns the PD-C ticket flow into a repo-centric CLI runtime with explicit guards, provider logs, and human gates.

## Read First

- `product-brief.md`: product requirements.
- `technical-plan.md`: architecture, decisions, risks, and implementation notes.
- `tasks.md`: active checklist.
- `flows/pdh-ticket-core.yaml`: machine-readable Full/Light PD-C flow.
- `README.md`: local commands and current scope.

## Local Commands

Source nvm before Node/Codex commands:

```sh
source /home/masuidrive/.nvm/nvm.sh
npm run check
node src/cli.ts status --repo .
node src/cli.ts run-next --repo .
node src/cli.ts smoke-calc
```

Do not run provider smoke checks as part of normal unit-style verification. Use `smoke-calc` only when intentionally checking real Codex behavior. It uses the existing authenticated Codex CLI session.

## Runtime Rules

- Steps are designed to be re-invokable (≈ idempotent). The durable state is `current-ticket.md`, `current-note.md`, the source tree, git history, and `judgements/` + `step_finished` artifacts; everything else under `.pdh-flow/runs/<run>/` is bookkeeping that can be rebuilt. If the supervisor or an attempt dies mid-step, the right move is to re-spawn the agent on the same step — it reads the durable state and either notices "already done" or continues. Do not introduce code that treats a dead supervisor as a permanent run failure.
- Full flow is the MVP baseline. Light flow remains a variant.
- Flow steps must keep stable `PD-C-*` ids and may add YAML `label`, `summary`, and `userAction` metadata for display.
- `current-note.md` frontmatter is the canonical runtime state.
- `current-ticket.md` keeps durable ticket intent only; runtime metadata does not belong there.
- `.pdh-flow/` is transient local evidence only and must not become a second source of truth.
- Runtime commands must not operate on non-current steps unless `--force` is explicitly used.
- Human gates require a gate summary before approval.
- Provider and runtime steps directly update `current-note.md` and `current-ticket.md`; review those changes with `git diff` and run artifacts.
- The runtime is the single owner of commits. After every completed step it stages all changes and writes one commit with the canonical subject `[PD-C-N] <step name>`. Providers (edit, review, repair) must not run `git commit` / `git rebase` / etc.; they leave durable changes in the working tree and let the runtime record them. Provider self-commits trigger a `provider_commit_detected` event for cleanup.
- Close preflight: finalize runs `ticket.sh close --dry-run --keep-worktree` before the real close. On dry-run failure (e.g. stale `tickets/done/<name>.md` on `default_branch`, dirty main repo, merge conflict) the runtime emits `close_preflight_failed` with the dry-run stderr, marks the run `needs_human`, and stops without mutating. The same check is exposed as `pdh-flow close-preflight` for on-demand use by agents or operators.
- Open interruptions block the current step until `answer` resolves them; resolved interruption context is included in the next provider prompt.
- The Web UI is viewer-first. It may display progress, logs, gates, interruptions, artifacts, and diffs, and it may launch a stop-state assist terminal, but runtime execution and decisions still stay in CLI commands or assist signals.
- Before close, append durable step-history entries to `current-note.md` and remove transient `.pdh-flow/runs/<run-id>/` artifacts.
- LLM output is evidence, not authority. Guards decide transitions.
- `.env`, `.codex`, `.pdh-flow/`, generated smoke repos, and provider logs must not be committed.

## Test Rules

- Do not hand-craft fake provider outputs (no JSON heredocs, no synthesized `ui-output.json` / `review.json` / `repair.json` / raw event streams in test scripts). The temptation is to "write what the provider should produce" — don't.
- Instead, capture real provider output once into a fixture (raw JSONL stdout + any artifacts the provider wrote into the step dir), then have a generic replay script `cat`/`cp` it back during tests.
- Record by running the real claude/codex against a tmp repo with a frozen prompt, save stdout to `tests/fixtures/<scenario>/raw.jsonl` and artifacts to `tests/fixtures/<scenario>/artifacts/`. Re-record only when the provider contract or prompt schema actually changes.
- Tests verify runtime behavior (state machine, guards, transitions, runtime UI) — not provider creativity. Replay gives deterministic provider behavior without lying about it.
- This rule applies to `scripts/test-runtime.sh` and any future test infra. If a test needs a provider behavior that no fixture covers, record a new one — don't invent the bytes.

## Commit Rules

Commit in small checkpoints after a verified behavior change. Use multi-paragraph commit messages with:

```text
Subject

Why: ...

What: ...

Verification: ...

Note: ...
```

The `Verification` paragraph must list the actual commands or user-flow checks performed. If a real provider was used, say so explicitly. Do not claim unit/e2e coverage when only syntax checks were run.
