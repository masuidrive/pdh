# sample1

`pdh-flow` の最小サンプル兼 runtime テストフィクスチャ。実プロジェクトに触らずに PD-C サイクルを 1 周回せる。

## 同梱されているもの

- `ticket.sh` (`masuidrive/ticket.sh` の generated build) と `.ticket-config.yaml`
- `tickets/calc-multiply.md` を始点 ticket とした calc 評価器の課題セット
- `current-ticket.md` と `current-note.md` (frontmatter は runtime canonical state)
- 実装ターゲット: `src/calc_demo/` の Python 評価器、`scripts/test-all.sh`
- `product-brief.md` と `docs/product-delivery-hierarchy.md` (PDH 運用ドキュメント)

`uv run calc "1+2"` は通るが、乗算 `2*5+1` は未実装で AC が落ちる状態が初期。

## Repo-Centric Walkthrough

```sh
FLOW_ROOT=/home/masuidrive/Develop/pdh/pdh-flow
TARGET=/tmp/pdh-flow-sample1

rm -rf "$TARGET"
cp -R "$FLOW_ROOT/examples/sample1" "$TARGET"
if [ -f "$FLOW_ROOT/.env" ]; then cp "$FLOW_ROOT/.env" "$TARGET/.env"; fi
cd "$TARGET"
git init
git add .
git commit -m "Seed sample1 fixture"

source /home/masuidrive/.nvm/nvm.sh

node "$FLOW_ROOT/src/cli.mjs" doctor --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" run --repo "$PWD" --ticket calc-multiply --variant light --start-step PD-C-5
node "$FLOW_ROOT/src/cli.mjs" run-next --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" show-gate --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" approve --repo "$PWD" --step PD-C-5 --reason ok
node "$FLOW_ROOT/src/cli.mjs" run-next --repo "$PWD" --stop-after-step
node "$FLOW_ROOT/src/cli.mjs" status --repo "$PWD"
```

この時点で run は `PD-C-6` で停止する。

通常パス:

```sh
node "$FLOW_ROOT/src/cli.mjs" run-next --repo "$PWD"
```

デバッグパス:

```sh
node "$FLOW_ROOT/src/cli.mjs" prompt --repo "$PWD"
node "$FLOW_ROOT/src/cli.mjs" run-provider --repo "$PWD"
```

ローカル確認:

```sh
uv run calc "1+2"
uv run calc "2*5+1"
uv run calc "2**10"
scripts/test-all.sh
./ticket.sh list
```
