---
name: pdh-update
description: "Update this repository's PDH files from upstream masuidrive/pdh. Use only when the user explicitly says pdh-update."
---

# PDH Update

This Codex skill is a wrapper for the canonical Claude Code skill in
`.claude/skills/pdh-update/`.

When this skill is selected:

1. Read `.claude/skills/pdh-update/SKILL.md`.
2. Follow it as the source of truth.
3. If those instructions mention Claude-specific Agent tooling, translate it to the available Codex subagent/delegation mechanism; if unavailable, state the limitation before proceeding.

Do not duplicate update rules here; update `.claude/skills/pdh-update/` instead.
