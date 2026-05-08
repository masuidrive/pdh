---
version: 1
ticket_id: 260508-150000-cart-total
title: Add cart_total() for summing comma-separated amounts
status: in_progress
created_at: 2026-05-08T15:00:00Z
ac:
  - id: AC-1
    description: '`cart_total("100,200,300") == 600.0` (basic sum)'
    classification: functional
  - id: AC-2
    description: '`cart_total("")` raises `ValueError("empty cart")`'
    classification: behavioral
  - id: AC-3
    description: '`cart_total("100,abc,200")` raises `ValueError` (any unparseable item is invalid)'
    classification: behavioral
---

# Ticket: Add cart_total(items_csv) to calc

## Background
calc.py supports `add`/`sub`/`mul`/`divide` and a `parse_amount(s)` helper
shared with the order-processing layer. Add `cart_total(items_csv: str)`
that parses comma-separated amount strings and returns their sum.

## Constraints
- Pure Python, no external deps.
- Use the existing `parse_amount` helper for individual item parsing
  (consistency with the order-processing layer requires this — we want
  one canonical place that decides how to interpret an amount string).
- Match the existing minimal style of `add`/`sub`/`mul`/`divide`.
- All three ACs must be covered by tests.
