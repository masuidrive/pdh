See [AGENTS.md](./AGENTS.md) for the canonical agent / contributor guide.

## Core design assumption

Steps are designed to be re-invokable (≈ idempotent). The durable state is `current-ticket.md`, `current-note.md`, the source tree, git history, and `judgements/` + `step_finished` artifacts; everything else under `.pdh-flow/runs/<run>/` is bookkeeping that can be rebuilt. If the supervisor or an attempt dies mid-step, the right move is to re-spawn the agent on the same step — it reads the durable state and either notices "already done" or continues. Do not introduce code that treats a dead supervisor as a permanent run failure.

## Single-machine assumption

`.pdh-flow/` is gitignored and is not designed to travel between machines. A single ticket is worked on a single machine. If a hand-off is ever needed, rely on the durable state (ticket + note + git) and let the next machine re-spawn agents on the current step; do not try to ship `runs/` artifacts.

## Single commit owner

The runtime is the single owner of commits in the PD-C flow. After every completed step, the runtime stages all changes and records one commit with a canonical subject (`[PD-C-N] <step name>`). Providers — including reviewers, repair agents, and edit-mode workers — must not run `git commit`, `git rebase`, or anything else that mutates history. They produce durable artifacts (note/ticket/source) and let the runtime commit them. This keeps `step-commit.json`, the gate diff baseline, and `git log` aligned.

## No real providers in tests

`scripts/test-runtime.sh` and any future test infra must not spawn real `claude` / `codex`. Use replay (fake-* scripts feeding pre-recorded JSONL) or static `loadRuntime` / `resolveStepAgent` checks. Real provider runs are reserved for intentionally recording a new fixture, and that should be done out-of-band, not as part of the test loop.

## Close preflight

Before running `ticket.sh close` for real, the runtime invokes `ticket.sh close --dry-run --keep-worktree` as a preflight. The dry-run validates everything that can fail mid-close (destination collision in `tickets/done/`, dirty main repo, squash merge conflict) without mutating anything. If preflight fails, finalize aborts before any mutation, the run is marked `needs_human`, and a `close_preflight_failed` progress event surfaces the dry-run stderr. Resolve the obstruction (e.g. remove a stale `tickets/done/<name>.md` from `default_branch`) and re-run `pdh-flow run-next` to retry. Agents and humans can probe the same check on demand with `pdh-flow close-preflight`.
