# AGENTS.md

This repository's coding-agent instructions live in `CLAUDE.md`.

Before making changes:
1. Read and follow `CLAUDE.md`.
2. If `docs-index.md` exists, use it only as a router to canonical documents.
3. Do not duplicate project rules here. Update `CLAUDE.md` when rules change.

If an agent platform reads only `AGENTS.md`, treat this file as a pointer to `CLAUDE.md`, not as a separate source of truth.

For PDH / ticket-centric work, also read:

1. `docs/product-delivery-hierarchy.md`
2. `.claude/skills/pdh-dev/SKILL.md` for orchestration
3. `.claude/skills/pdh-coding/SKILL.md` for implementation workers
4. `current-ticket.md` and `current-note.md` when they exist

Do not migrate legacy files in `tickets/` unless the user explicitly asks.

## Tool Term Mapping

`CLAUDE.md` may use Claude Code terms. Other coding agents should read them by role:

| Claude Code term | Generic meaning |
|---|---|
| `CLAUDE.md` | Primary repository instruction file |
| `subagent` | Delegated agent with its own context |
| `teammate` / agent team | Independent agent session coordinated by an `orchestrator` |
| `Skill` / `.claude/skills/` | Reusable task instruction package |
| `model: opus` | Use the environment's `strong-judge` model/profile |
| `advisor` | Second-opinion judge used at decision points |
| `ultracode` / workflow | `multi-agent-coding` execution mode |
| `effort` | Reasoning budget / thinking depth / agentic persistence setting |

Model names change. Follow the role profiles in `CLAUDE.md`, not literal model names.
