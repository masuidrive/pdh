# Project Overview

Read `product-brief.md` and `PDH-AGENTS.md`. If `AGENTS.local.md` exists, also read its environment-specific context.

## Directory Structure

<!-- Adapt this structure to the project. -->

```text
product-brief.md                 # Product purpose and direction
technical-reference.md           # Current implementation: how it works
docs/
  product-delivery-hierarchy.md  # Ticket workflow
tickets/                         # Managed by ticket.sh
  done/
```

## Project Principles

<!-- Write project-specific decisions here. Do not repeat shared PDH rules. -->

- Prioritize technical correctness over speed.
- If a user message ends with two question marks (`??` or `？？`), answer the question only; do not edit files or execute commands.

## Implementation Quality

<!-- Record recurring project-specific failures here. General implementation rules belong in pdh-coding. -->

## Development Environment

### Starting Servers

<!-- Describe the actual startup, seed, and dummy-login commands. -->

### Tests

<!-- Describe project-specific test commands and their scope. -->

Run the full suite through `scripts/test-all.sh`. Use `--parallel` for parallel execution.

Follow `PDH-AGENTS.md` for completion-report and surface evidence requirements. Test design and ticket-local-test rules are in `.agents/skills/pdh-coding/SKILL.md`.

## PDH Ticket Workflow

Shared PDH rules are in `PDH-AGENTS.md`; stage execution and review structure are in `.agents/skills/pdh-dev/SKILL.md`. Keep only project-specific differences here.

### Affected Layers

List the affected project layers when creating a ticket or planning implementation and tests.

<!-- Example: backend · frontend · sdk · cli · e2e-test · docs -->

### Recurring Review Findings

<!-- Adapt these examples to the project. -->

| Category | Common omission | Check |
|---|---|---|
| Rename | Old names remain in imports, mocks, or documentation | Search for the old name with `rg` |
| DB migration | Schema changes have no migration | Plan the schema change and migration together |

## Codex Workers

Configure the model and reasoning-effort override examples in `.codex/agents/pdh-*.toml` for the project's roles. Keep project-specific constraints here.

| Role | Project-specific constraints and focus |
|---|---|
| Coding Engineer | <!-- Required skills, write scope, etc. --> |
| QA Engineer | <!-- Test commands, fixtures, E2E, etc. --> |
| Reviewer | <!-- Security, performance, compatibility, etc. --> |
| AC Verifier | <!-- Canonical documents and required evidence. --> |
| Surface Observer | <!-- UI, HTTP API, SDK, CLI, etc. --> |

Escalate to an evaluator when the normal worker repeatedly fails on the same issue or an irreversible design decision needs stronger reasoning. For an evaluation using a different model, launch a separate worker with that model and the same role rules and task context, instead of a custom agent definition that fixes the normal model.

Use a gitignored `AGENTS.local.md` for environment-specific instructions that cannot be committed. Describe how to obtain secrets or where they are stored; do not include their values.

# Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/codex/templates/AGENTS.md
