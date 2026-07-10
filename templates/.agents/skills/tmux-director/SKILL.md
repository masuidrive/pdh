---
name: tmux-director
description: "PDH tmux Director workflow. Use only when the task explicitly needs tmux window orchestration."
---

# tmux Director

This Codex skill is a wrapper for the canonical Claude Code skill in
`.claude/skills/tmux-director/`.

When this skill is selected:

1. Read `.claude/skills/tmux-director/SKILL.md`.
2. Follow it as the source of truth.
3. Translate Claude-specific interactive / Monitor / Agent tooling to the available host tools; if unavailable, state the limitation before proceeding.

Do not duplicate tmux Director rules here; update `.claude/skills/tmux-director/` instead.
