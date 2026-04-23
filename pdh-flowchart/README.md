# pdh-flowchart

`pdh-flowchart` is an experimental runtime for executing `pdh-dev` flow semantics as resumable steps with explicit gates, provider logs, and guard evidence.

## Local Setup

This machine has Node and Codex under nvm. Source nvm before running the CLI:

```sh
source /home/masuidrive/.nvm/nvm.sh
```

Provider smoke checks load `.env` from the repo root. `.env` is ignored by git and should contain `OPENAI_API_KEY`.

## Commands

```sh
node src/cli.mjs flow --variant full
node src/cli.mjs init
node src/cli.mjs run --ticket ticket-id --variant full
node src/cli.mjs run --ticket ticket-id --variant full --start-step PD-C-5
node src/cli.mjs guards --step PD-C-3
node src/cli.mjs gate-summary <run-id> --step PD-C-5
node src/cli.mjs approve <run-id> --step PD-C-5 --reason ok
node src/cli.mjs advance <run-id> --step PD-C-5
node src/cli.mjs commit-step --step PD-C-6 --message Implementation
node src/cli.mjs ticket-start --ticket ticket-id
node src/cli.mjs ticket-close
node src/cli.mjs run-codex --repo /path/to/repo --prompt-file prompt.md --step PD-C-6
node src/cli.mjs smoke-calc
```

`smoke-calc` creates `/tmp/pdh-flowchart-calc-smoke`, uses the existing authenticated Codex CLI session, asks Codex to build a tiny `uv run calc "1+2"` CLI app, and verifies the result. It does not run `codex login`; `.env` remains available for other provider checks that need explicit API-key auth.

## Current Scope

- Full `pdh-ticket-core` flow definition is represented in `flows/pdh-ticket-core.json`.
- SQLite state is stored under `.pdh-flowchart/state.sqlite`.
- Codex JSONL output is saved as raw provider logs.
- Deterministic guard skeletons exist for note/ticket sections, commits, commands, human approval, AC verification tables, and judgement artifacts.
- Human gate commands can create a summary artifact and record approve/reject/request-changes/cancel decisions.
- `advance` evaluates deterministic guards and only then moves the run to the next step.
- Runtime commands refuse to operate on a non-current step unless `--force` is provided.
- `commit-step`, `ticket-start`, and `ticket-close` provide the first direct runtime action hooks.
- Full transition execution is partial; current implementation focuses on Phase 0 provider/state/guard/action groundwork.
