---
name: pdh-dev
description: "Ticket-centric 開発ワークフロー (1 user + AI 体制 single flow)。1 ticket = 1 work unit、1 agent が investigate + implement + tests を 1 session で完遂、review は実装後。Epic 概念は持たない。『開発開始』『実装して』『このチケットやって』『start dev』『pdh dev』『ticket dev』『チケット開発』で使う。新規チケット作成や既存チケット開始にも使う。"
---

# PDH Dev — Ticket-centric 開発ワークフロー

`Product Brief → Ticket → 実装 → クローズ` の workflow を回す。1 user + AI 体制に最適化した single flow。

**この skill の実行モデルは team (multi-agent CLI)** — PM が Coding Engineer / QA / reviewer を spawn して各フェーズを委譲する。

## 読み込み順序

以下を順に Read してフローを把握すること:

| ファイル | 内容 |
|---|---|
| `_principles.md` | 最重要原則・核となる設計選択。すべての判断の哲学的基盤 |
| `_reference.md` | 用語・ステップ遷移・進捗報告・step 完了ルール・ticket/note 構造・AC ルール・責務境界・Self-check |
| `_flow.md` | PD-C-1/6/7/9/10 の手順本体。各 step の前提条件・gate・意図・成果物 |
| `_review.md` | レビューパターン・網羅探索チェックリスト・ループ収束診断・裏取りルール・既存問題の扱い・品質ルール |
| `_collaboration.md` | ユーザ相談ルール・中止フロー |
| `_execution-team.md` | **team 実行モデル（唯一）**: 役割定義・PM 責務・spawn 機構（claude/codex 両方の起動コマンド・`&` 並行起動）・各 step の team 実行手順 |
| `_subagent-context.md` | **worker 共通プロンプト**: spawn する全 worker に渡す土台（PDH 前提・読む原則ファイル・チケット位置・不可侵・出力先 + 役割別追加） |

> 実行モデルは team のみ。**spawn は必須**で、できない場合は単独続行せず中止・報告する（solo フォールバックは持たない）。bot（headless CI）も同じく worker を CLI subprocess で spawn する。

> **gate の Task 化**: PM は着手時に PD-C の各 gate（特に **PD-C-6 / PD-C-9 の `scripts/test-all.sh` 全スイート確認**）を TaskCreate で積み、各 gate の**証拠が揃うまで completed にしない**。全テストは `scripts/test-all.sh` に固定（代替不可、README §6）。検証完了の主張には実コマンドと `Passed: N / N` の実出力を note に貼ること（証拠バインディングの詳細は `_reference.md`「必須ルール」、gate 本体は `_flow.md` PD-C-6/9）。
