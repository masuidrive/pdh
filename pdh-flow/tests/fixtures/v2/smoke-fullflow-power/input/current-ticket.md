---
version: 1
ticket_id: 260508-110000-power-fn
title: Add power() with edge-case handling to calc
status: in_progress
created_at: 2026-05-08T11:00:00Z
ac:
  - id: AC-1
    description: '`power(2, 3) == 8` (positive integer exponent)'
    classification: functional
  - id: AC-2
    description: '`power(2, -1) == 0.5` and the result is a `float` (negative exponent)'
    classification: functional
  - id: AC-3
    description: '`power(0, 0) == 1` (Python convention; do not raise)'
    classification: behavioral
  - id: AC-4
    description: '`power("a", 2)` raises `TypeError` (non-numeric base must be rejected)'
    classification: behavioral
---

# Ticket: Add power(base, exp) to calc

## Background
calc.py supports `add`/`sub`/`mul`/`divide`. Add a `power(base, exp)` function
that follows the same minimalist style as the existing functions.

## Constraints
- Pure Python, no external deps.
- `power("a", 2)` MUST raise `TypeError` (validation is part of the contract).
- `power(0, 0)` MUST return `1` (Python's `0 ** 0 == 1` convention).
- Negative exponents MUST return a `float` (e.g. `power(2, -1) == 0.5`).
- Integer base + non-negative integer exponent MUST stay an `int` where possible
  (e.g. `power(2, 3) == 8`, an int — not `8.0`).
- Do NOT introduce complex-number handling. `power(-1, 0.5)` is out of scope;
  whatever Python's default behaviour is, leave it.

## Notes for the implementer
- Validate `base` first, then `exp`. Both must be `int` or `float` (booleans count as int in Python; that's acceptable).
- Use `isinstance(x, (int, float))` for validation.
- Use the `**` operator for the math (or `pow()`).
