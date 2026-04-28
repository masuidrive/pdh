# fake-pdh-dev Fixture

This is a tiny throwaway target repo for trying `pdh-flow` without touching a real project.

The fixture starts with:

- a working `uv run calc "1+2"` path
- a failing multiplication AC
- canonical `current-ticket.md` and `current-note.md`

## Repo-Centric Walkthrough

```sh
FLOW_ROOT=/home/masuidrive/Develop/pdh/pdh-flow
TARGET=/tmp/pdh-flow-fake-pdh-dev

rm -rf "$TARGET"
cp -R "$FLOW_ROOT/examples/fake-pdh-dev" "$TARGET"
if [ -f "$FLOW_ROOT/.env" ]; then cp "$FLOW_ROOT/.env" "$TARGET/.env"; fi
cd "$TARGET"
git init
git add .
git commit -m "Seed fake pdh-dev fixture"

source /home/masuidrive/.nvm/nvm.sh

node "$FLOW_ROOT/src/cli.mjs" doctor --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" run --repo "$PWD" --ticket calc-multiply --variant light --start-step PD-C-5
node "$FLOW_ROOT/src/cli.mjs" run-next --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" show-gate --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" approve --repo "$PWD" --step PD-C-5 --reason ok
node "$FLOW_ROOT/src/cli.mjs" run-next --repo "$PWD" --stop-after-step
node "$FLOW_ROOT/src/cli.mjs" status --repo "$PWD"
```

At that point the run is on `PD-C-6`.

Normal path:

```sh
node "$FLOW_ROOT/src/cli.mjs" run-next --repo "$PWD"
```

Debug path:

```sh
node "$FLOW_ROOT/src/cli.mjs" prompt --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" run-provider --repo "$PWD"
```

Useful local checks:

```sh
uv run calc "1+2"
uv run calc "2*5+1"
uv run calc "2**10"
scripts/test-all.sh
```
