---
name: pdh-dev
description: "Ticket-centric 開発ワークフロー (1 user + AI 体制 single flow)。1 ticket = 1 work unit、実装前に ticket-human-review で AC 承認を取り、実装後に review / verify / human-review を行う。Epic 概念は持たない。『開発開始』『実装して』『このチケットやって』『start dev』『pdh dev』『ticket dev』『チケット開発』で使う。新規チケット作成や既存チケット開始にも使う。"
---

# PDH Dev — Ticket-centric 開発ワークフロー

`Product Brief → Ticket → ticket-human-review → 実装 → review → verify → human-review → close` の workflow を回す。1 user + AI 体制に最適化した single flow。

**この skill の実行モデルは team (multi-agent CLI)** — PM が Coding Engineer / QA / reviewer を spawn して各フェーズを委譲する。

## 読み込み順序

以下を順に Read してフローを把握すること:

| ファイル | 内容 |
|---|---|
| `_principles.md` | 最重要原則・核となる設計選択。すべての判断の哲学的基盤 |
| `_reference.md` | 用語・stage 遷移・進捗報告・stage 完了ルール・ticket/note 構造・AC ルール・責務境界・Self-check |
| `_flow.md` | `PDH-open` / `PDH-ticket-review` / `PDH-ticket-human-review` / `PDH-implement` / `PDH-review` / `PDH-verify` / `PDH-human-review` / `PDH-close` の stage と checklist |
| `_review.md` | レビューパターン・網羅探索チェックリスト・ループ収束診断・裏取りルール・既存問題の扱い・品質ルール |
| `_collaboration.md` | ユーザ相談ルール・中止フロー |
| `_execution-team.md` | **team 実行モデル（唯一）**: 役割定義・PM 責務・spawn 機構（claude/codex 両方の起動コマンド・`&` 並行起動）・各 step の team 実行手順 |
| `_subagent-context.md` | **worker 共通プロンプト**: spawn する全 worker に渡す土台（PDH 前提・読む原則ファイル・チケット位置・不可侵・出力先 + 役割別追加） |

> 実行モデルは team のみ。**spawn は必須**で、できない場合は単独続行せず中止・報告する（solo フォールバックは持たない）。bot（headless CI）も同じく worker を CLI subprocess で spawn する。

> **step ごとの subagent + Director 検品**: Coding Engineer / QA / reviewer / AC 裏取り / Surface Observer は stage ごとの worker として分ける。PM (Director) は worker の PASS を承認扱いにせず、正典・diff・実コマンド出力・note の証跡を照合し、矛盾や不足があれば差し戻してから次 stage へ進む。

> **gate の checklist 化**: PM は着手時に `PDH-*` の checklist を note に持ち、証拠が揃うまで完了扱いにしない。全テストは `scripts/test-all.sh` に固定（現状は `npm run check`。詳細は `CLAUDE.md`「テスト / 検証コマンド」）。検証完了の主張には実コマンドと `Passed: N / N` の実出力を note に貼ること（証拠バインディングの詳細は `_reference.md`「必須ルール」）。

> **PDH-human-review gate**: PM は `PDH-review` と `PDH-verify` まで自動で進め、`PDH-human-review` で人間レビューを依頼する。note に書くだけで済ませず、会話上で「やったこと」「判断ポイント」「次の選択肢」を説明する。判断が必要な選択肢は一番上におすすめを置く。ユーザの明示承認なしに `PDH-close` へ進まず、チケット全体を「完了」と報告しない。途中で疑問・判断不能・blocker・完了見込みなしが出た場合は、その時点でユーザに確認する。
