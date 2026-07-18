# scripts/checks — fast-check registry

Each `*.check` file here is one declarative, deterministic invariant check run by
`scripts/fast-checks.sh` (wired into `scripts/test-all.sh` as a cheap first stage,
and typically into CI). A fast-check is a **super-lightweight, language-agnostic
lint rule**: it greps the repo for one forbidden pattern and fails if it appears.

It is **not** a general style linter (that is `tsc` / `eslint` / `ruff`, run
separately). Use a fast-check for an invariant that is:

- too repo-specific for a general linter, and
- not worth — or not expressible as — a unit test, and
- describable as "this exact string pattern must never appear here".

Typical use: pin a shipped bug so it can never recur ("client-declared MIME must
not be passed straight through"), or keep a boundary clean ("this shared skill
must not mention project-specific names").

> The npm library `fast-check` (property-based testing) is a **different thing**
> that only shares the name. This registry is a bash grep runner, not that library.

## File format

One check per file, `key=value`, `#` comments and blank lines ignored:

```
# reason is printed when the check fails (say why it is forbidden)
reason=client-declared MIME must not be passed directly as contentType
# pattern is POSIX ERE only — NO \d \s \w \b \p{...} (?...); use [[:space:]] etc.
pattern=contentType:[[:space:]]*[A-Za-z_$][A-Za-z0-9_$]*\.type
# glob: which files to scan. Only <dir>/** or <dir>/**/*.<ext>, comma-separated.
glob=src/**/*.ts,apps/**/*.mjs
# exclude (optional): same glob forms, comma-separated.
exclude=apps/generated/**
```

- `reason`, `pattern`, `glob` are required; `exclude` is optional.
- The check **id** is the filename without `.check` (e.g. `no-client-mime-trust.check` → `no-client-mime-trust`).
- **pattern is POSIX ERE**, so it runs identically under ripgrep and BSD/GNU `grep -E`.
  The runner rejects PCRE-only tokens (`\d \s \w \b \p{...} (?...)`) as a config error —
  use `[[:space:]]`, `[[:digit:]]`, `[A-Za-z0-9_]`, etc.
- **glob** only accepts `<dir>/**` (all files under a dir) or `<dir>/**/*.<ext>`
  (by extension). There is no repo-root `**`; name the source dirs explicitly.
- The scanned file set is `git ls-files --cached --others --exclude-standard`
  (tracked + untracked-not-ignored), so both ripgrep and the grep fallback see the
  same explicit list regardless of their ignore handling.

## Opting a line out

A specific line may declare an exception with a token-bounded comment:

```
someValue.type  // checks-allow: no-client-mime-trust  (approved: creation route, see ticket ...)
```

Only the exact check id is suppressed, and only on that line. Prefer fixing the
code; use the allow marker for a reviewed, intentional exception and say why.

## Adding a check (usually at ticket close)

When a shipped bug's recurrence can be caught deterministically, add one `.check`
here in the same change that fixes the bug. If it cannot be expressed as a grep,
record why in the ticket note instead. Keep patterns narrow: a fast-check that
false-positives on legitimate code trains people to ignore it.

## Example

`example-no-merge-conflict-markers.check` in this directory shows the format with a
universally useful check (leftover Git merge-conflict markers). Adjust its `glob`
to your project's source directories, or delete it and add your own.
