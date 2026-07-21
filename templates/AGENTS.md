# AGENTS.md

This repository's project-specific coding-agent instructions live in `CLAUDE.md`; shared PDH instructions live in `PDH-AGENTS.md`.

Before making changes:
1. Read and follow `CLAUDE.md`.
2. Read `PDH-AGENTS.md` for PDH common rules.
3. If `CLAUDE.local.md` exists, read it after `CLAUDE.md`; it is gitignored environment-local context.
4. If `docs-index.md` exists, use it only as a router to canonical documents.
5. Do not duplicate project rules here. Update `CLAUDE.md` for project rules and `PDH-AGENTS.md` for PDH common rules.

If an agent platform reads only `AGENTS.md`, treat this file as a pointer to `CLAUDE.md` and `PDH-AGENTS.md`, not as a separate source of truth.

For PDH / ticket-centric work, also read:

1. `docs/product-delivery-hierarchy.md`
2. `.agents/skills/pdh-dev/SKILL.md` or `.claude/skills/pdh-dev/SKILL.md` for orchestration
3. `.agents/skills/pdh-coding/SKILL.md` or `.claude/skills/pdh-coding/SKILL.md` for implementation workers
4. `current-ticket.md` and `current-note.md` when they exist

When authoring declarative fast-checks, also read `.agents/skills/pdh-check-writing/SKILL.md` or `.claude/skills/pdh-check-writing/SKILL.md`.

Do not migrate legacy files in `tickets/` unless the user explicitly asks.

## Tool Term Mapping

`CLAUDE.md` may use Claude Code terms. Other coding agents should read them by role:

| Claude Code term | Generic meaning |
|---|---|
| `CLAUDE.md` | Project-specific agent rules |
| `PDH-AGENTS.md` | Shared PDH agent rules |
| `subagent` | Delegated agent with its own context |
| `teammate` / agent team | Independent agent session coordinated by an `orchestrator` |
| `Skill` / `.claude/skills/` | Reusable task instruction package |
| `.agents/skills/` | Where Codex CLI discovers skills; symlinks to the canonical `.claude/skills/` |
| `model: opus` | Use the environment's `strong-judge` model/profile |
| `advisor` | Second-opinion judge used at decision points |
| `ultracode` / workflow | `multi-agent-coding` execution mode |
| `effort` | Reasoning budget / thinking depth / agentic persistence setting |

Model names change. Follow the role profiles in `CLAUDE.md`, not literal model names.
