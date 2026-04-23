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
node src/cli.mjs guards --step PD-C-3
node src/cli.mjs run-codex --repo /path/to/repo --prompt-file prompt.md --step PD-C-6
node src/cli.mjs smoke-calc
```

`smoke-calc` creates `/tmp/pdh-flowchart-calc-smoke`, uses the existing authenticated Codex CLI session, asks Codex to build a tiny `uv run calc "1+2"` CLI app, and verifies the result. It does not run `codex login`; `.env` remains available for other provider checks that need explicit API-key auth.

## Current Scope

- Full `pdh-ticket-core` flow definition is represented in `flows/pdh-ticket-core.json`.
- SQLite state is stored under `.pdh-flowchart/state.sqlite`.
- Codex JSONL output is saved as raw provider logs.
- Deterministic guard skeletons exist for note/ticket sections, commits, commands, human approval, AC verification tables, and judgement artifacts.
- Human gate and full transition execution are still skeletal; current implementation focuses on Phase 0 provider/state/guard groundwork.
