---
name: pdh-dev
description: "Ticket-centric 開発ワークフロー。1 ticket = 1 work unit、実装前に ticket-human-review で AC 承認を取り、実装後に review / verify / human-review を行う。『開発開始』『実装して』『このチケットやって』『start dev』『pdh dev』『ticket dev』『チケット開発』で使う。新規チケット作成や既存チケット開始にも使う。"
---

# PDH Dev — Ticket-centric 開発ワークフロー

`Product Brief → Ticket → ticket-human-review → 実装 → review → verify → human-review → close` の順で、1 ticket を1 work unitとして処理する。

実行モデルはteam前提とし、PMが各phaseをworkerへ委譲する。
**spawnできない環境で単独実行をteamと同等に扱わない。** 制限を説明し、確信度やgateの意味に影響するならユーザへ確認する（`PDH-AGENTS.md`「Execution Model」）。headless botもCLI subprocessでworkerをspawnする。

## この skill の読み方

`product-brief.md`、`docs/product-delivery-hierarchy.md`、`PDH-AGENTS.md`、`CLAUDE.md`（と存在すれば`CLAUDE.local.md`）を先に読む順序は`PDH-AGENTS.md`「Read Order」が正。

そのうえで、この skill の分冊を必要に応じて開く。

| ファイル | 内容 | 主に読むとき |
|---|---|---|
| `_principles.md` | 最重要原則と設計選択 | 判断に迷ったとき |
| `_reference.md` | 用語、stage遷移、ticket/note構造、責務境界 | 記録先や用語を確認するとき |
| `_flow.md` | 8つの`PDH-*` stageとchecklist | 各stageの実行時（中心的な分冊） |
| `_review.md` | review、網羅探索、収束診断、裏取り | `PDH-review` |
| `_collaboration.md` | ユーザ相談と中止 | 判断不能・blocker時 |
| `_execution-team.md` | teamの役割、engine割当、spawn機構 | worker を spawn するとき |
| `_subagent-context.md` | 全workerに渡す共通promptと役割別指示 | 同上 |

gate の意味と判定基準（stage flow、severity、scope、証拠要件）は`PDH-AGENTS.md`が正。この skill には手順を置く。
