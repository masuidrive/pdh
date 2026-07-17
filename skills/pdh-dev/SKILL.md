---
name: pdh-dev
description: "Ticket-centric 開発ワークフロー (1 user + AI 体制 single flow)。1 ticket = 1 work unit、実装前に ticket-human-review で AC 承認を取り、実装後に review / verify / human-review を行う。Epic 概念は持たない。『開発開始』『実装して』『このチケットやって』『start dev』『pdh dev』『ticket dev』『チケット開発』で使う。新規チケット作成や既存チケット開始にも使う。"
---

# PDH Dev — Ticket-centric 開発ワークフロー

`Product Brief → Ticket → ticket-human-review → 実装 → review → verify → human-review → close` の順で、1 ticket を1 work unitとして処理する。

実行モデルはteamのみとし、PMが各phaseをworkerへ委譲する。

## 読み込み順序

次の順で読む。

| ファイル | 内容 |
|---|---|
| `PDH-AGENTS.md`（存在すれば） | PDH汎用のstage、gate、worker、verifyルール |
| `CLAUDE.md` | project固有ルール、テストコマンド、approval policy、tool/model上書き |
| `CLAUDE.local.md`（存在すれば） | gitignore済みの環境固有メモ。secret値は置かない |
| `_principles.md` | 最重要原則と設計選択 |
| `_reference.md` | 用語、stage遷移、ticket/note、AC、責務境界、self-check |
| `_flow.md` | 8つの`PDH-*` stageとchecklist |
| `_review.md` | review、網羅探索、収束診断、裏取り、品質ルール |
| `_collaboration.md` | ユーザ相談と中止 |
| `_execution-team.md` | teamの役割、spawn、stage実行手順 |
| `_subagent-context.md` | 全workerに渡す共通promptと役割別指示 |

**spawnは必須。利用不能時は単独続行せず中止して報告する。**
headless botもCLI subprocessでworkerをspawnする。

Coding Engineer、QA、reviewer、AC裏取り、Surface Observerはstage別workerに分ける。
PMはworkerのPASSを承認扱いせず、正典、ticket、diff、実コマンド出力、note証跡を照合し、不足があれば差し戻す。

PMは着手時に`PDH-*` checklistをnoteへ置き、証拠が揃うまで完了扱いにしない。
全スイートの固定コマンドは`scripts/test-all.sh`とし、サブセットや影響なし判断で代替しない。
検証完了は対象SHA、実行コマンド、`Passed: N / N`等の実出力をnoteへ貼ってから主張する。

通常は`PDH-review`と`PDH-verify`まで自動で進め、`PDH-human-review`で人間レビューを依頼する。
依頼はnoteだけで済ませず、会話でやったこと、判断ポイント、おすすめを先頭にした次の選択肢を説明する。
**ユーザの明示承認なしに`PDH-close`へ進まず、ticket全体を完了と報告しない。**
疑問、判断不能、blocker、完了見込みなしが出た場合は、その時点でユーザに確認する。
