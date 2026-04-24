# repo-centric-runtime

## Why

The runtime should not have a second canonical state source separate from `current-note.md` and `current-ticket.md`.

## What

- Make `current-note.md` frontmatter the canonical runtime state.
- Keep `current-ticket.md` free of runtime metadata.
- Rework the CLI around repo-centric commands such as `run-next --repo .`.
- Rework the Web UI to read from note frontmatter plus transient local artifacts.
- Keep `.pdh-flowchart/` transient and remove local run artifacts before close.

## Product AC

- A user can start and advance a ticket without passing a run id to normal CLI commands.
- Provider prompts reference canonical files instead of inlining their contents.
- The Web UI explains the current step, what to look at, and which CLI command to run next.
- The runtime no longer depends on SQLite or metadata blocks as the authoritative state model.
- Durable step history remains in `current-note.md` even after local artifacts are deleted.

## Implementation Notes

- `current-note.md` frontmatter holds `ticket`, `flow`, `variant`, `status`, `current_step`, `run_id`, timestamps.
- `.pdh-flowchart/runs/<run-id>/` stores prompts, raw logs, gate summaries, interruptions, judgements, and patch proposals.
- `run-next` auto-runs providers by default and stops only at gates, interruptions, guard failures, provider failures, or completion.
- Close cleanup appends step-history lines to `current-note.md` before deleting local artifacts.

## Related Links

- `product-brief.md`
- `technical-plan.md`
- `flows/pdh-ticket-core.yaml`
- `README.md`
