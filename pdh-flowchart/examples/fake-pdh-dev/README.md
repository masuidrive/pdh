# fake-pdh-dev Fixture

This is a tiny throwaway target repository for trying `pdh-flowchart` without touching a real `pdh-dev` project.

The fixture starts with a working `uv run calc "1+2"` command and a failing multiplication AC. The intended demo is:

```sh
FLOW_ROOT=/home/masuidrive/Develop/pdh/pdh-flowchart
TARGET=/tmp/pdh-flowchart-fake-pdh-dev

rm -rf "$TARGET"
cp -R "$FLOW_ROOT/examples/fake-pdh-dev" "$TARGET"
if [ -f "$FLOW_ROOT/.env" ]; then cp "$FLOW_ROOT/.env" "$TARGET/.env"; fi
cd "$TARGET"
git init
git add .
git commit -m "Seed fake pdh-dev fixture"

source /home/masuidrive/.nvm/nvm.sh
node "$FLOW_ROOT/src/cli.mjs" doctor --repo "$PWD"

RUN_ID="$(node "$FLOW_ROOT/src/cli.mjs" run --repo "$PWD" --ticket calc-multiply --variant light --start-step PD-C-5 | sed -n '1p')"
node "$FLOW_ROOT/src/cli.mjs" run-next "$RUN_ID" --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" show-gate "$RUN_ID" --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" approve "$RUN_ID" --repo "$PWD" --step PD-C-5 --reason ok
node "$FLOW_ROOT/src/cli.mjs" run-next "$RUN_ID" --repo "$PWD"
```

At that point the run is on `PD-C-6` and `run-next` will print the provider command. To let Codex implement the failing AC:

```sh
node "$FLOW_ROOT/src/cli.mjs" run-provider "$RUN_ID" --repo "$PWD"
```

Useful local checks:

```sh
uv run calc "1+2"
scripts/test-all.sh
```
