# scripts/checks — fast-check registry

Each `*.check` file here is one declarative, deterministic invariant check run by
`scripts/fast-checks.sh` (wired into `scripts/test-all.sh` as a cheap first stage,
and typically into CI). A fast-check is a **super-lightweight, language-agnostic
lint rule**: it either greps the repo for one forbidden pattern or rejects files
that exceed a declared line-count ceiling, or delegates the selected files to a
project-provided linter command.

The registry does not define general style policy itself. A `linter_command`
check can invoke `eslint`, `ruff`, or another project linter, while the project
still owns that linter's dependency, configuration, and rules. Use a fast-check
for an invariant that is:

- too repo-specific for a general linter, and
- not worth — or not expressible as — a unit test, and
- describable as either "this exact string pattern must never appear here" or
  "files in this narrow scope must stay below this line ceiling", or
  "this existing linter must accept the selected files".

Typical use: pin a shipped bug so it can never recur ("client-declared MIME must
not be passed straight through"), or keep a boundary clean ("this shared skill
must not mention project-specific names").

> The npm library `fast-check` (property-based testing) is a **different thing**
> that only shares the name. This registry is a bash grep runner, not that library.

## File format

One check per file, `key=value`, `#` comments and blank lines ignored.
Pattern check:

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

Line-count check:

```
reason=source file exceeds 1500 lines; split it into cohesive modules
max_lines=1500
glob=**/*.ts,**/*.mjs
exclude=test/**,**/*.test.ts,**/*.test.mjs,**/*-data.mjs,**/dist/**
# allow is optional and contains exact repo-relative file paths, never globs.
allow=src/legacy-large-file.ts
```

Linter-command check:

```
reason=project linter rejected the selected source files
# Fixed arguments are split on whitespace. The placeholder must be one standalone token.
linter_command=project-lint --strict -- {{filenames}}
glob=src/**/*.ts
exclude=src/generated/**
# allow is optional and contains exact repo-relative file paths, never globs.
allow=src/legacy-generated.ts
```

- `reason` and `glob` are always required. Exactly one of `pattern`, `max_lines`,
  or `linter_command` is required; the three types are mutually exclusive.
  `exclude` is optional for every type.
- `max_lines` is a positive decimal integer. It uses `wc -l` semantics, including
  blank and comment lines. A file passes at the limit and fails above it.
- `allow` is optional and valid only with `max_lines` or `linter_command`. It is a
  comma-separated list of exact repo-relative file paths; absolute paths, parent
  traversal, and glob metacharacters are configuration errors.
- `linter_command` is split only on whitespace; shell quoting and escaping are not
  interpreted. Fixed arguments and the command path therefore cannot contain
  whitespace. Put such setup in a PATH-visible wrapper command instead.
- A linter template contains exactly one standalone `{{filename}}` or
  `{{filenames}}` token. `{{filename}}` runs once per selected file and reports all
  failures. `{{filenames}}` passes all selected files as individual arguments in
  one invocation; it is intentionally not ARG_MAX-batched.
- The runner never evaluates a linter template with `eval`, `bash -c`, or another
  shell parse. It builds a Bash argument array and directly runs `"${argv[@]}"`,
  so spaces and shell metacharacters in a filename remain one literal argument.
  Root paths beginning with `-` are passed as `./<path>` to prevent option
  injection. A standalone `--` before the placeholder is still recommended for
  linters that support it.
- The command named by the first token must resolve even when zero files match;
  otherwise the check fails with `linter not found`. Exit 0 passes. Any other exit
  code fails and reports the check id, exit code, reason, target scope, and the
  linter's combined stdout/stderr. Successful linter output is suppressed.
- A `.check` file is trusted, reviewed repository code and may deliberately name
  any command available to the process. The runner does not sandbox that command;
  its safety guarantee is that selected filenames cannot add shell commands or
  arguments through reparsing.
- The check **id** is the filename without `.check` (e.g. `no-client-mime-trust.check` → `no-client-mime-trust`).
- **pattern is POSIX ERE**, so it runs identically under ripgrep and BSD/GNU `grep -E`.
  The runner rejects PCRE-only tokens (`\d \s \w \b \p{...} (?...)`) as a config error —
  use `[[:space:]]`, `[[:digit:]]`, `[A-Za-z0-9_]`, etc.
- **glob** only accepts `<dir>/**` (all files under a dir) or `<dir>/**/*.<ext>`
  (by extension), plus two narrowly constrained repo-wide forms:
  `**/*<literal-suffix>` (for example `**/*.test.ts` or `**/*-data.mjs`) and
  `**/<literal-dir>/**` (for example `**/dist/**`). Suffixes must begin with `.`
  or `-`; suffixes and directory names are literals without glob metacharacters.
- The scanned file set is `git ls-files --cached --others --exclude-standard`
  (tracked + untracked-not-ignored), so both ripgrep and the grep fallback see the
  same explicit list regardless of their ignore handling.

## Opting a pattern-match line out

A specific line may declare an exception with a token-bounded comment:

```
someValue.type  // checks-allow: no-client-mime-trust  (approved: creation route, see ticket ...)
```

Only the exact check id is suppressed, and only on that line. Prefer fixing the
code; use the allow marker for a reviewed, intentional exception and say why.
This line-local marker is unrelated to the exact-path `allow=` key used by
`max_lines` and `linter_command` checks.

## Adding a check (usually at ticket close)

When a shipped bug's recurrence can be caught deterministically, add one `.check`
here in the same change that fixes the bug. If it cannot be expressed as a grep,
record why in the ticket note instead. Keep patterns narrow: a fast-check that
false-positives on legitimate code trains people to ignore it.

## Examples

The registry ships three examples. Adjust their globs and excludes for the
project, or delete examples that do not fit:

- `example-no-merge-conflict-markers.check`: rejects leftover conflict markers.
- `example-max-source-lines.check`: starts source files at a 1500-line ceiling.
- `example-max-test-lines.check`: starts test files at a 2500-line ceiling.
