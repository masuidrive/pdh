---
name: pdh-dev
description: "Ticket-centric 開発ワークフロー。1 ticket = 1 work unit、実装前に ticket-human-review で AC 承認を取り、実装後に review / verify / human-review を行う。『開発開始』『実装して』『このチケットやって』『start dev』『pdh dev』『ticket dev』『チケット開発』で使う。新規チケット作成や既存チケット開始にも使う。"
---

# PDH Dev — Ticket-centric 開発ワークフロー

`Product Brief → Ticket → ticket-human-review → 実装 → review → verify → human-review → close` の順で、1 ticket を1 work unitとして処理する。

実行モデルはteam前提とし、PMが各phaseをworkerへ委譲する。**spawnできない環境で単独実行をteamと同等に扱わない。** 制限を説明し、確信度やgateの意味に影響するならユーザへ確認する（`PDH-AGENTS.md`「Execution Model」）。headless botもCLI subprocessでworkerをspawnする。

## この skill の読み方

`product-brief.md` → `docs/product-delivery-hierarchy.md` → `PDH-AGENTS.md` → `CLAUDE.md`（と存在すれば`CLAUDE.local.md`）→ ticket file / note file（`ticket.sh start`/`restore`出力の`ticket:`/`note:`パス。互換symlink: `current-ticket.md`/`current-note.md`）の順で先に読む。engineが自動でcontextへ載せるもの（`CLAUDE.md`と、そこからimportされるファイル）は読み直さなくてよい。

そのうえで、この skill の分冊を必要に応じて開く。

| ファイル | 内容 | 主に読むとき |
|---|---|---|
| `_principles.md` | 最重要原則と設計選択 | 判断に迷ったとき |
| `_reference.md` | 用語、stage遷移、ticket/note構造、責務境界 | 記録先や用語を確認するとき |
| `_flow.md` | 8つの`PDH-*` stageとchecklist | 各stageの実行時（中心的な分冊） |
| `_review.md` | reviewの巡回と裁定、収束診断、裏取り（reviewer自身の規則は`pdh-reviewing` skill） | `PDH-review` |
| `_collaboration.md` | ユーザ相談と中止 | 判断不能・blocker時 |
| `_execution-team.md` | teamの役割、engine割当、spawn機構 | worker を spawn するとき |
| `_subagent-context.md` | 全workerに渡す共通prompt土台と役割別の参照（検証workerの規則本体は`pdh-verifying` skill） | 同上 |

**ticket の Why と AC は承認される契約そのものである。**主語と目的語が落ちた文や、指す先の決まらない指示語を残さない。承認者が前を読み返さないと意味が決まらない AC は、承認された約束と出荷されるものが食い違う。

gate の意味と判定基準（stage flow、severity、scope、証拠要件）は`PDH-AGENTS.md`に従う。この skill には手順を置く。

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-dev/SKILL.md
