# AGENTS.md

## Project

`pdh-flowchart` turns `pdh-dev` ticket flow semantics into a resumable CLI runtime with explicit guards, provider logs, and human gates.

## Read First

- `product-brief.md`: product requirements.
- `technical-plan.md`: architecture, decisions, risks, and implementation notes.
- `tasks.md`: active checklist.
- `flows/pdh-ticket-core.json`: machine-readable Full/Light PD-C flow.
- `README.md`: local commands and current scope.
- `../skills/pdh-dev/SKILL.md` and `../skills/tmux-director/SKILL.md`: source semantics for PD-C steps and gates.

## Local Commands

Source nvm before Node/Codex commands:

```sh
source /home/masuidrive/.nvm/nvm.sh
npm run check
node src/cli.mjs status <run-id>
node src/cli.mjs smoke-calc
```

Do not run provider smoke checks as part of normal unit-style verification. Use `smoke-calc` only when intentionally checking real Codex behavior. It uses the existing authenticated Codex CLI session.

## Runtime Rules

- Full flow is the MVP baseline. Light flow remains a variant.
- Runtime commands must not operate on non-current steps unless `--force` is explicitly used.
- Human gates require a gate summary before approval.
- LLM output is evidence, not authority. Guards decide transitions.
- `.env`, `.codex`, `.pdh-flowchart/`, generated smoke repos, and provider logs must not be committed.

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
