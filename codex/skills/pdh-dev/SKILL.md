---
name: pdh-dev
description: "ticket を作る・開始する・進める開発ワークフロー。『開発開始』『実装して』『このチケットやって』『start dev』『pdh dev』で使う。"
---

# PDH Dev

`AGENTS.md` と、それが読ませる `product-brief.md` / `PDH-AGENTS.md` は既に context にある。ここで開くのは ticket file / note file / progress file（`ticket.sh start`/`restore` 出力の `ticket:`/`note:` パスと、同じ dir の `progress.md`）だけ。

| ファイル | 開くとき |
|---|---|
| `docs/product-delivery-hierarchy.md` | ticket を新規に書くとき（ファイル形式・完了条件の書き方・命名・branch 戦略） |
| `_flow.md` | 各 stage の実行時 |
| `_review.md` | `PDH-review` |
| `_reference.md` | 記録先・用語・AC の判定 |
| `_execution-team.md` / `_subagent-context.md` | worker を spawn するとき |
| `_collaboration.md` | blocker 時 |

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/codex/skills/pdh-dev/SKILL.md
