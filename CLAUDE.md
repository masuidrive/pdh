# プロジェクト概要

@product-brief.md を参照すること

このリポジトリは **PDH の配布元** であり、PDH を適用される側でもある。

- PDH 汎用 agent ルールは **`templates/PDH-AGENTS.md`** を正として読む。配布先プロジェクトのように root へコピーしない（この repo が原本であり、コピーすると原本が 2 つになる）
- Claude Code skill の実体は **`skills/`**。配布先の `.claude/skills/` に相当する
- `templates/.agents/skills/` は Codex 用 wrapper。ワークフローを複製せず、実体を読ませるだけに保つ

**設計意図の探し方:** `git blame <file>` でコミットを特定 → コミットメッセージの ticket 名 → `product-brief.md`

## ディレクトリ構造

```
product-brief.md                     # プロダクト概要・方針【変更にはユーザーの明示的な承認が必要】
CLAUDE.md                            # このファイル（PDH repo 固有ルール）
README.md                            # 導入・更新手順。配布物の一覧はここが正
docs/
  product-delivery-hierarchy.md      # PDH 運用ルール（配布物）
skills/                              # Claude Code skill の実体（配布物）
  pdh-dev/  pdh-coding/  pdh-update/  tmux-director/
templates/                           # 配布テンプレート
  PDH-AGENTS.md                      # PDH 汎用 agent ルール（この repo でもこれを正として読む）
  CLAUDE.md                          # 配布先 project 固有ルールの雛形
  AGENTS.md                          # 他 agent platform 向け thin pointer
  .agents/skills/                    # Codex 用 skill wrapper
  checks/  *.sh                      # 配布 script 群
scripts/
  hookbus.js                         # tmux worker hook event bus（配布物）
  test-all.sh                        # この repo 自身の検査（配布物ではない）
  fast-checks.sh                     # 宣言的 grep 不変条件ランナー（配布物ではない）
  check-distribution.sh              # 配布セットの一貫性検査（配布物ではない）
  checks/*.check                     # この repo 用 fast-check レジストリ
```

`scripts/` 直下のうち `hookbus.js` だけが配布物。他は PDH repo 自身の検査であり、配布先へコピーしない（`templates/` 側に配布用の同名テンプレートがある）。

# 基本方針

- **時間がかかっても技術的正しさを優先する。** 後方互換のための余計なコードやハックは入れない
- **⚠ 文末が「？？」（?2回）の質問には、質問にだけ答えること。** 作業の実行・ファイル変更・コマンド実行など一切進めない。回答のみ
- **この repo は ticket 運用をしない**（`product-brief.md` の決定事項）。main へ直接 commit してよい。配布物の変更は `./scripts/test-all.sh` が通ることで担保する

# この repo 固有の実装ルール

このリポジトリに製品コードはない。成果物は **配布されるテキスト** である。したがって品質ルールもテキストに対して適用する。

## 配布物の一貫性

- **配布ファイルを追加・改名・削除したら、README の配置表（§2 のコピー元/コピー先テーブル）とディレクトリ構造図を同じ commit で更新する。** README が配布物一覧の正
- **配布ファイル末尾の `Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/<path>` 行を壊さない。** `XXXXXXX` はプレースホルダのまま commit する（導入時に HEAD commit へ置換される）。path 部分は自身の配布先パスと一致させる
- **`pdh-update` skill の更新手順が、追加した配布物をカバーしているか確認する**

## 重複の禁止

- **同じルールを 2 箇所に書かない**（`product-brief.md` の `AI-1`）。PDH 汎用は `templates/PDH-AGENTS.md`、project 固有の書き方例は `templates/CLAUDE.md`、導入手順は README、運用ルールは `docs/product-delivery-hierarchy.md`
- **配布テンプレートに「このテンプレートの使い方」を書かない**（`AI-3`）。コピー先で読み手のいない説明文になる
- 文言を移動したら、移動元に残骸がないか `rg '<特徴的な一文>'` で sweep する

## engine 中立性

- **フローの記述に特定 engine を前提としない**（`AI-5`）。engine 固有の起動手順を書く場合は、セクション見出しかリード文で前提を明示して閉じ込める
- **具体的なモデル名は「上書き例」としてのみ書く。** 役割プロファイル（`strong-judge` 等）を正とする
- Claude Code 側に何かを追加したら、**Codex 側（`templates/AGENTS.md` / `templates/.agents/skills/`）に対応が要るか必ず確認する**

# テスト・検証

## 自動検査

`./scripts/test-all.sh` を実行する。中身は 3 つ:

- `scripts/fast-checks.sh` — `scripts/checks/*.check` の宣言的 grep 不変条件（`Based on` 行の commit id 置換禁止、Codex wrapper へのワークフロー複製検出、merge-conflict marker）
- `scripts/check-distribution.sh` — grep で書けない「存在」と「2 つのリストの一致」の検査（`Based on` 行の存在とパス一致、README §2 配置表 ↔ 実ファイルの双方向一致）
- 配布 `*.sh` の構文検査

**配布物を追加・改名・削除したら `./scripts/test-all.sh` が通ることを確認する。** README への追記漏れはここで落ちる。

新しい不変条件を追加するときは、まず `.check`（1 パターンの grep で書けるか）を検討し、書けない場合だけ `check-distribution.sh` に足す。**追加した検査は、わざと違反を作って実際に落ちることを確認する。** 落ちない検査は無いのと同じ。

## 自動化できない確認

- **script を変更したら実際に実行する。** `bash -n` の構文チェックだけで完了としない
- **配布テンプレートを変更したら、実プロジェクトへの導入経路で確認する。** 最低でも、変更したファイルを実際にコピーして agent に読ませ、指示が破綻していないことを確認する
- **README の手順を変更したら、その手順どおりにコマンドを実行して確認する**
- **「ドキュメントを直した」だけで「正常に動作しています」と報告しない**

## 頻出の漏れ

| # | カテゴリ | よくある漏れ | 対策 |
|---|---|---|---|
| 1 | README 未同期 | 配布物を追加したが README の配置表に載せ忘れ | `./scripts/test-all.sh`（check-distribution が検出） |
| 2 | 文言の二重化 | 移動したはずの説明が移動元にも残る | `rg '<移動した一文>'` で全文 sweep |
| 3 | Codex 側の取り残し | Claude 側 skill だけ更新し wrapper / AGENTS.md が古いまま | `templates/.agents/skills/` と `templates/AGENTS.md` を確認 |
| 4 | `Based on` 行 | 置換対象ファイルの行が無い / path が誤り / commit id が固定されている | `./scripts/test-all.sh`（fast-checks + check-distribution が検出） |

# PDH (Ticket) 運用

- **`product-brief.md` が全判断の基準**
- PDH 汎用ルールは `templates/PDH-AGENTS.md`、フローの詳細は `skills/pdh-dev/SKILL.md` が正。ここには PDH repo 固有の差分だけを書く
- **Acceptance Criteria の変更（追加・削除・修正）は必ずユーザの承認を得ること**

## 影響範囲の明示（必須）

チケット作成・実装計画・検証計画では、影響するレイヤーを必ず列挙する。

`docs` · `skills` · `templates` · `templates/.agents` · `scripts` · `README` · `product-brief.md`
