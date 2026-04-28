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
node src/cli.mjs status --repo .
node src/cli.mjs run-next --repo .
node src/cli.mjs smoke-calc
```

Do not run provider smoke checks as part of normal unit-style verification. Use `smoke-calc` only when intentionally checking real Codex behavior. It uses the existing authenticated Codex CLI session.

## Runtime Rules

- Full flow is the MVP baseline. Light flow remains a variant.
- Flow steps must keep stable `PD-C-*` ids and may add YAML `label`, `summary`, and `userAction` metadata for display.
- `current-note.md` frontmatter is the canonical runtime state.
- `current-ticket.md` keeps durable ticket intent only; runtime metadata does not belong there.
- `.pdh-flow/` is transient local evidence only and must not become a second source of truth.
- Runtime commands must not operate on non-current steps unless `--force` is explicitly used.
- Human gates require a gate summary before approval.
- Provider and runtime steps directly update `current-note.md` and `current-ticket.md`; review those changes with `git diff` and run artifacts.
- Open interruptions block the current step until `answer` resolves them; resolved interruption context is included in the next provider prompt.
- The Web UI is viewer-first. It may display progress, logs, gates, interruptions, artifacts, and diffs, and it may launch a stop-state assist terminal, but runtime execution and decisions still stay in CLI commands or assist signals.
- Before close, append durable step-history entries to `current-note.md` and remove transient `.pdh-flow/runs/<run-id>/` artifacts.
- LLM output is evidence, not authority. Guards decide transitions.
- `.env`, `.codex`, `.pdh-flow/`, generated smoke repos, and provider logs must not be committed.

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
