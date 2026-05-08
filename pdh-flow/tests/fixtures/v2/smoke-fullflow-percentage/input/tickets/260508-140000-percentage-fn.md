---
version: 1
ticket_id: 260508-140000-percentage-fn
title: Add percentage() with strict input validation
status: in_progress
created_at: 2026-05-08T14:00:00Z
ac:
  - id: AC-1
    description: '`percentage(50, 100) == 50.0` (basic case)'
    classification: functional
  - id: AC-2
    description: '`percentage(0, 100) == 0.0` (zero numerator OK)'
    classification: functional
  - id: AC-3
    description: '`percentage(50, 0)` raises `ValueError` with a clear message. MUST NOT propagate `ZeroDivisionError`.'
    classification: behavioral
  - id: AC-4
    description: '`percentage(-5, 100)` raises `ValueError("part must be >= 0")`. Negative numerators are not allowed.'
    classification: behavioral
  - id: AC-5
    description: '`percentage(50, -100)` raises `ValueError("total must be > 0")`. Negative totals are not allowed.'
    classification: behavioral
---

# Ticket: Add percentage(part, total) to calc

## Background
calc.py supports `add`/`sub`/`mul`/`divide`. Add a `percentage(part, total)`
function that returns `(part / total) * 100` as a float, with strict
validation on both arguments.

## Constraints
- Pure Python, no external deps.
- Match the existing minimal style of `add`/`sub`/`mul`/`divide`.
- All five ACs must be covered by tests.
