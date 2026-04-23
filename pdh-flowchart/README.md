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
node src/cli.mjs run-next <run-id>
node src/cli.mjs guards --step PD-C-3
node src/cli.mjs logs <run-id> --follow
node src/cli.mjs gate-summary <run-id> --step PD-C-5
node src/cli.mjs show-gate <run-id>
node src/cli.mjs doctor
node src/cli.mjs approve <run-id> --step PD-C-5 --reason ok
node src/cli.mjs advance <run-id> --step PD-C-5
node src/cli.mjs commit-step --step PD-C-6 --message Implementation
node src/cli.mjs ticket-start --ticket ticket-id
node src/cli.mjs ticket-close
node src/cli.mjs prompt <run-id>
node src/cli.mjs metadata <run-id>
node src/cli.mjs judgement <run-id> --status "No Critical/Major" --summary ok
node src/cli.mjs verify <run-id> --command "scripts/test-all.sh"
node src/cli.mjs run-provider <run-id> --timeout-ms 3600000 --max-attempts 2
node src/cli.mjs resume <run-id>
node src/cli.mjs run-provider <run-id> --prompt-file prompt.md
node src/cli.mjs run-codex <run-id> --prompt-file prompt.md
node src/cli.mjs run-codex --repo /path/to/repo --prompt-file prompt.md --step PD-C-6
node src/cli.mjs run-claude <run-id> --prompt-file prompt.md
node src/cli.mjs run-claude --repo /path/to/repo --prompt-file prompt.md --step PD-C-4
node src/cli.mjs smoke-calc
npm run test:runtime
```

## Example Fixture

`examples/fake-pdh-dev` is a tiny throwaway target repo with a `uv run calc` CLI, `current-ticket.md`, `current-note.md`, `ticket.sh`, and a failing multiplication AC. Copy it to `/tmp`, initialize git, and follow its README to exercise `doctor`, `run`, `run-next`, `show-gate`, `approve`, and optional `run-provider` from a user perspective.

`smoke-calc` creates `/tmp/pdh-flowchart-calc-smoke`, uses the existing authenticated Codex CLI session, asks Codex to build a tiny `uv run calc "1+2"` CLI app, and verifies the result. It does not run `codex login`; `.env` remains available for other provider checks that need explicit API-key auth.

## Current Scope

- Full `pdh-ticket-core` flow definition is represented in `flows/pdh-ticket-core.json`.
- SQLite state is stored under `.pdh-flowchart/state.sqlite`.
- State schema changes are tracked in the `schema_migrations` table; current schema version is `1`.
- Codex JSONL output is saved as raw provider logs.
- Claude Code `stream-json` output is saved as raw provider logs and normalized into progress events.
- Deterministic guard skeletons exist for note/ticket sections, commits, commands, human approval, AC verification tables, and judgement artifacts.
- Human gate commands can create a summary artifact and record approve/reject/request-changes/cancel decisions.
- `advance` evaluates deterministic guards and only then moves the run to the next step.
- `run-next` executes runtime-owned current-step work, advances through passing guards, and stops at human gates or provider steps that still need execution.
- Runtime commands refuse to operate on a non-current step unless `--force` is provided.
- PD-C provider prompt templates are generated from `pdh-dev` semantics and saved under the run step artifacts.
- `run-provider <run-id>` selects Codex or Claude from the run's current flow step and generates the step prompt when `--prompt-file` is omitted.
- Runtime-managed metadata blocks in `current-note.md` and `current-ticket.md` track run id, flow, status, and current step.
- Provider changes to `current-note.md` and `current-ticket.md` are captured as `note-ticket.patch` step artifacts.
- Structured judgement artifacts back PD-C-4 plan review, PD-C-7 quality review, and PD-C-8 purpose validation guards.
- AC verification guards parse the `AC 裏取り結果` markdown table and validate `verified` / `deferred` / `unverified` rows.
- `verify <run-id>` runs PD-C-9 final verification, writes `final-verification.json`, and updates the PD-C-9 process checklist.
- `logs <run-id> --follow` streams normalized progress events, and `show-gate <run-id>` prints the current gate summary.
- `doctor` checks local Node, Codex, Claude Code, uv, git, provider auth, `.env`, and git repository readiness without printing secrets.
- `examples/fake-pdh-dev` provides a tiny fake target repository for user-perspective flow checks.
- Blocked `advance` / `run-next` output is concise by default; pass `--json` for full guard payloads.
- Mutating run commands use a per-run lock under `.pdh-flowchart/locks`; set `PDH_FLOWCHART_LOCK_WAIT_MS` or pass `--lock-wait-ms` to wait instead of failing immediately.
- Provider commands use flow `timeoutMinutes` by default, can be overridden with `--timeout-ms`, and terminate the provider process group on timeout.
- Provider failures retry up to flow `maxAttempts` by default with exponential backoff; use `--max-attempts` and `--retry-backoff-ms` to override.
- Provider raw logs and human gate summaries redact common API key/token patterns and exact secret values loaded from `.env`.
- `npm run test:runtime` exercises blocked, failed, and resumed run paths with fake providers.
- `resume <run-id>` resumes the current provider step from the latest saved Codex/Claude session id.
- `run --ticket <id>` invokes `./ticket.sh start <id>` when `ticket.sh` exists, and records a skip event otherwise.
- After PD-C-10 approval, runtime invokes `./ticket.sh close` once other close guards pass and records `ticket-close.json`.
- `run-codex <run-id>` executes the run's current step and refuses provider/step mismatches unless `--force` is provided.
- `commit-step`, `ticket-start`, and `ticket-close` provide the first direct runtime action hooks.
- Full transition execution is partial; current implementation focuses on Phase 0 provider/state/guard/action groundwork.
