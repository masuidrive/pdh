---
version: 1
ticket_id: 260508-130500-clamp-fn
title: Add clamp(value, lo, hi) with bound validation
status: in_progress
created_at: 2026-05-08T13:05:00Z
ac:
  - id: AC-1
    description: '`clamp(5, 0, 10) == 5` (value already inside the range)'
    classification: functional
  - id: AC-2
    description: '`clamp(-3, 0, 10) == 0` (clamped to lower bound)'
    classification: functional
  - id: AC-3
    description: '`clamp(20, 0, 10) == 10` (clamped to upper bound)'
    classification: functional
  - id: AC-4
    description: '`clamp(5, 10, 0)` raises `ValueError` (caller passed lo > hi)'
    classification: behavioral
---

# Ticket: Add clamp(value, lo, hi) to calc

## Background
calc.py supports `add`/`sub`/`mul`/`divide`. Add a `clamp(value, lo, hi)`
function for the upcoming numeric guardrails feature.

## Constraints
- Pure Python, no external deps.
- `clamp(value, lo, hi)` returns `value` when `lo <= value <= hi`,
  `lo` when `value < lo`, `hi` when `value > hi`.
- When `lo > hi`, raise `ValueError` (the inputs themselves are invalid).
- Equality at the bounds should NOT raise (e.g. `clamp(5, 5, 10) == 5`).
- Do NOT validate the type of `value` / `lo` / `hi` — assume they're already numeric.

## Notes for the implementer
- Validate `lo <= hi` first; if violated, raise `ValueError` with a
  clear message identifying the violated invariant.
- Match the existing minimal style of `add`/`sub`/`mul`/`divide`.
