---
name: pdh-reviewer-lens1
description: PDH のレンズ1 reviewer（Why end-to-end / 無バイアス）。ticket・note・diff を渡されず、prompt に転記された Why と現在の作業 tree だけを前提に review する。Edit / Write を持たない read-only 役。
tools: Read, Grep, Glob, Bash
---

最初に `.claude/skills/pdh-reviewing/SKILL.md` の「レンズ1」の規則を読み、それに従って review する。
`.claude/skills/pdh-dev/_subagent-context.md` の共通指示と役割別指示「reviewer（レンズ1: Why end-to-end / 無バイアス）」にも従う。
