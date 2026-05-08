# Try pdh-flow v2 yourself

Drive the v2 engine end-to-end on a small ticket — claude/codex actually do
work, the API judge actually decides, you approve gates from the Web UI.

## Prereqs

- Node 24+ (for native TS execution).
- `claude` CLI authenticated (subscription).
- `codex` CLI authenticated (subscription).
- An `ANTHROPIC_API_KEY` in `.env` at `pdh-flow/` root (the engine prefers
  the API path for guardian / aggregator nodes — schema-strict, ~$0.09 / run).

```bash
cp .env.example .env  # if not already
# add ANTHROPIC_API_KEY=sk-ant-...
```

## One-shot launcher

```bash
bash scripts/try-it.sh                              # default: smoke-fullflow-divide
bash scripts/try-it.sh smoke-fullflow-power         # power() ticket
bash scripts/try-it.sh smoke-fullflow-clamp         # clamp() ticket
PORT=5180 bash scripts/try-it.sh                    # different port
```

This:

1. Seeds a temp worktree from `tests/fixtures/v2/<fixture>/input/`.
2. Starts the engine in the background (logs at `/tmp/pdh-tryit.engine.log`).
3. Starts the Web UI in the foreground at `http://localhost:5170`.
4. **Does not pre-approve gates** — you approve them via the UI.
5. On Ctrl+C: kills the engine, leaves the worktree for inspection.

Then in your browser:

1. Click `Open` on the run.
2. Wait for `plan_review` to finish (~3-5 min). The State card shows the
   current node; the Active gate panel turns yellow when `plan_gate` is
   waiting.
3. Fill an approver name → click **Approve**. The engine picks up the
   decision within ~1 s and resumes.
4. Wait for `implement` + `code_quality_review` + `final_verification`
   (~5-7 min).
5. Approve `close_gate` when it appears.
6. The run flips to `terminal` / `closed`.

Total wall-clock time per ticket: ~12 minutes.

## Available fixtures

All under `tests/fixtures/v2/`. They share a tiny `calc.py` repo with
`add` / `sub` / `mul` / `divide` already implemented; each ticket asks for
one new function.

| Fixture                       | Ticket                               | Notes                                                      |
|-------------------------------|--------------------------------------|------------------------------------------------------------|
| `smoke-fullflow-divide`       | Add `divide(a, b)`                   | Smallest. AC: `divide(6,2) == 3.0`, `divide(1,0)` raises.  |
| `smoke-fullflow-power`        | Add `power(base, exp)` with edge cases | 4 ACs incl. `0**0 == 1`, `power("a", 2)` raises TypeError. |
| `smoke-fullflow-modulo`       | Add `modulo(a, b)`                   | Tests Python's negative-modulo convention (`(-7)%3 == 2`). |
| `smoke-fullflow-clamp`        | Add `clamp(value, lo, hi)`           | 4 ACs incl. ValueError on `lo > hi`.                       |
| `smoke-fullflow-percentage`   | Add `percentage(part, total)`        | 5 ACs, strict input validation contract.                   |
| `smoke-fullflow-cartbug`      | Add `cart_total(items_csv)`          | Seeds an `eval()`-using helper. Reviewers spot the RCE,    |
|                               |                                      | scope-classify it as Minor (preexisting), still pass.      |

## Running the pieces by hand

If you want to see exactly what `try-it.sh` does (or split engine + Web UI
across two terminals):

```bash
# 1. seed
WORKTREE=$(mktemp -d -t pdh-tryit-XXXXXX)
cp -r tests/fixtures/v2/smoke-fullflow-divide/input/. "$WORKTREE/"
cd "$WORKTREE"
git init -q && git -c user.email=t@t -c user.name=t add -A
git -c user.email=t@t -c user.name=t commit -q -m setup
cd -

# 2. engine (terminal A)
node src/cli/index.ts run-engine \
  --ticket 260508-093000-divide-fn \
  --flow pdh-c-v2 \
  --variant full \
  --worktree "$WORKTREE" \
  --run-id manual-1 \
  --timeout-ms 1800000

# 3. Web UI (terminal B)
node src/cli/index.ts serve --worktree "$WORKTREE" --port 5170
# open http://localhost:5170/
```

The engine and UI talk through the filesystem only:

- engine writes `<worktree>/.pdh-flow/runs/<runId>/snapshot.json` after every
  transition.
- engine writes frozen judgements to `judgements/`.
- engine polls `gates/<nodeId>.json` while at a gate node.
- the Web UI POST to `/api/runs/:runId/gates/:nodeId` writes that file.

If the engine crashes you can re-spawn against the same worktree + run-id —
it'll restore from the snapshot and skip already-frozen judgements (see
`pdh-flow/CLAUDE.md` § Re-spawnability).

## Cost

| Ticket          | Judge tokens (sonnet-4-6) | Approx cost |
|-----------------|---------------------------|-------------|
| divide          | ~26 K                     | ~$0.08      |
| power / modulo / clamp / percentage / cartbug | ~28-31 K | ~$0.09–0.10 |

Reviewer / implementer / repair calls run via the `claude` / `codex` CLIs
on your subscription, no per-call cost (subject to subscription limits).

## What to watch for

- **Plan review's `critical_1` reviewer** (codex) used to flag "function not
  yet implemented" as Major and trigger a spurious plan_repair loop. The
  reviewer prompt now scopes plan_review to "the plan artifact, not source
  state" — so critical_1 returns `No Critical/Major` even when the source
  TODO is still in place. Read the `## plan_review.critical_1 (round N)`
  section in `current-note.md` to see this in action.
- **API judge's reasoning** sits in `judgements/<node>__round-<N>.json` —
  inspect to see why each guardian decision was made.
- **Single commit owner** means every reviewer / aggregator / repair gets
  exactly one git commit. `git log --oneline` after the run shows ~16 commits
  for a clean pass, more if any repair loops fired.
