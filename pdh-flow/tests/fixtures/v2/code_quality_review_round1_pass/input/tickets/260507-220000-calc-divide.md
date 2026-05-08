---
version: 1
ticket_id: 260507-220000-calc-divide
title: Add division support to calc
status: in_progress
flow: pdh-c-v2
variant: full
created_at: 2026-05-07T22:00:00Z
started_at: 2026-05-07T22:05:00Z
ac:
  - id: AC-1
    description: '`uv run calc "6/2"` returns `3`'
    classification: functional
  - id: AC-2
    description: '`uv run calc "1/0"` returns non-zero exit'
    classification: behavioral
---

# Ticket: Add division support to calc

## Background
Today calc supports +, -, *. Add division.

## Implementation Notes
- Use `ast.BinOp` with `ast.Div` operator
- Return float result; exit non-zero on ZeroDivisionError
