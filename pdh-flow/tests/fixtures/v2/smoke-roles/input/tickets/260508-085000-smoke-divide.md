---
version: 1
ticket_id: 260508-085000-smoke-divide
title: Add division support to calc
status: in_progress
created_at: 2026-05-08T08:50:00Z
ac:
  - id: AC-1
    description: '`divide(6, 2)` returns `3.0`'
    classification: functional
  - id: AC-2
    description: '`divide(1, 0)` raises ZeroDivisionError'
    classification: behavioral
---

# Ticket: Add division to calc

## Background
calc.py supports add/sub/mul. Add a `divide(a, b)` function.

## Constraints
- Pure Python, no external deps
- ZeroDivisionError must propagate
