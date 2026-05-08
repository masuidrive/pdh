---
version: 1
ticket_id: 260508-130000-modulo-fn
title: Add modulo() with Python-conventional negative behaviour
status: in_progress
created_at: 2026-05-08T13:00:00Z
ac:
  - id: AC-1
    description: '`modulo(7, 3) == 1` (positive integer remainder)'
    classification: functional
  - id: AC-2
    description: '`modulo(7, 0)` raises `ZeroDivisionError` (do not catch)'
    classification: behavioral
  - id: AC-3
    description: '`modulo(-7, 3) == 2` (Python convention — sign follows divisor, not dividend)'
    classification: behavioral
---

# Ticket: Add modulo(a, b) to calc

## Background
calc.py supports `add`/`sub`/`mul`/`divide`. Add a `modulo(a, b)` function.

## Constraints
- Pure Python, no external deps.
- Use Python's native `%` operator (do NOT reimplement modular arithmetic).
- The behaviour for negative dividend MUST follow Python's convention
  (sign of result matches divisor), not C's. `(-7) % 3 == 2`, not `-1`.
- `modulo(7, 0)` MUST propagate `ZeroDivisionError`.

## Notes for the implementer
- The ticket explicitly accepts `%`'s native behaviour. Do not write
  defensive code for negative dividends.
- Match the existing minimal style of `add`/`sub`/`mul`/`divide`.
