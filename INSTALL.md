# PDH セットアップガイド

PDH の配布セットは coding agent の engine ごとに分かれている。使う engine の `INSTALL.md` を読む。

| engine | 導入・更新手順 |
|---|---|
| Claude Code（Codex を worker に使う構成を含む） | [`claude/INSTALL.md`](claude/INSTALL.md) |
| Codex CLI | `codex/INSTALL.md`（準備中。`codex/pdh-codex-tuning` branch から移す） |

どちらの配布セットも、`docs/product-delivery-hierarchy.md`（運用ルール）と `docs/PDH-AGENTS.md`（PDH 汎用 agent ルール）を同じものとして配布する。engine で違うのは skill の文面、agent 定義、起動手順だけである。

coding agent に任せる場合は、対象プロジェクトのルートで次のように指示する。

```text
https://github.com/masuidrive/pdh の claude/INSTALL.md を読んで、このプロジェクトに PDH を導入して。
```
