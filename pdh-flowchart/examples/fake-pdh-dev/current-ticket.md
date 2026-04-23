# current-ticket.md

## Why

The demo calculator should cover a slightly more realistic arithmetic expression while staying small enough for a fast provider run.

## What

Add multiplication support to the existing `calc` CLI and keep unsupported expressions rejected.

## Product AC

- `uv run calc "1+2"` prints `3`.
- `uv run calc "2*5+1"` prints `11`.
- `uv run calc "2**10"` exits non-zero with an error.

## Implementation Notes

Use Python's `ast` module. Allow only integer literals, addition, and multiplication. Keep the CLI command named `calc`.

## Related Links

- None
