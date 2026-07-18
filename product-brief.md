# Product Brief: PDH — Product Delivery Hierarchy

## Background

coding agent を使った開発では、「なぜ作るか」と「いま何をやるか」が会話の中に散らばり、context が切れるたびに失われる。人間側も agent 側も、判断の根拠を毎回作り直すことになる。

PDH は、その 2 つを Git 管理された Markdown として構造化する仕組み。当初は Product Brief / Epic / Ticket の 3 層 + Light/Full の 2 段階 flow だったが、1 user + AI 体制では Epic の同期 / coordination 価値より overhead cost が上回ると実証され、Product Brief / Ticket の 2 層 + PDH stage flow (1 ticket = 1 work unit) に統一した。

## Who

- **PDH を自分のプロジェクトへ導入する開発者**: 既存リポジトリで coding agent を使い始め、ticket 運用の型が欲しい場面。README を agent に読ませて導入する。
- **PDH 導入済プロジェクトで日々開発する開発者 + その coding agent**: ticket を開き、実装し、review / verify を通して閉じる場面。読むのは配布先にコピーされた `PDH-AGENTS.md` / `CLAUDE.md` / skills であって、この repo ではない。
- **PDH 自体をメンテナンスする人**: 実プロジェクトで得た知見を templates / skills に還流させる場面。読み手は上の 2 者。

## Problem

- coding agent は context が切れると判断根拠を失い、同じ議論を繰り返す。Acceptance Criteria の暗黙変更や、「動作確認しました」の水増しが起きる。
- 型を持たないと、agent の review は「指摘の量」に流れ、ticket の scope が際限なく膨らむ。
- 各プロジェクトで似たルールを毎回書き直すことになり、改善が他プロジェクトへ伝播しない。

## Solution

配布物として次を提供する。特別なツールやサービスは持たず、Markdown + bash + Git だけで完結させる。

- **2 層構造**: Product Brief (why) → Ticket (what + how)
- **PDH stage flow**: `PDH-open` → `PDH-ticket-review` → `PDH-ticket-human-review` → `PDH-implement` → `PDH-review` → `PDH-verify` → `PDH-human-review` → `PDH-close`。実装前と close 前に人間の gate を置く
- **配布テンプレート**: `templates/`（`PDH-AGENTS.md` = PDH 汎用ルール、`CLAUDE.md` = project 固有ルールの雛形、各種 script）
- **skills**: `skills/` に skill の実体を置く。配布先では `.claude/skills/` が実体、`.agents/skills/` はそこへの symlink（Codex CLI 用）
- **導入・更新経路**: `INSTALL.md` を coding agent に読ませて導入。更新は `pdh-update` skill（内部で `INSTALL.md` を辿る）

主要フロー:
1. 開発者が自プロジェクトで agent に「PDH の INSTALL.md を読んで導入して」と指示 → ticket.sh 導入 + ファイル配置 + Product Brief 雛形作成まで完了する
2. 実プロジェクトで得た改善を PDH repo に還流 → 各プロジェクトが `pdh-update` で取り込む

## Appetite

小さく保つ。PDH 自身がツールやランタイムを持ち始めたら行き過ぎ。配布物はコピーして読めるテキストであり続ける。大工事になる解決策は提案止まりにする。

## Constraints

- 配布物は Markdown と bash script のみ。ランタイム依存を増やさない（例外: tmux Director の `scripts/hookbus.js` が Node 18+ を要求する。これ以上増やさない）
- **engine 中立**: Claude Code / Codex CLI のどちらが main でも動くこと。特定 engine をフローにハードコードしない
- 配布ファイル末尾の `Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/...` 行は導入時に HEAD commit へ置換される。この行の形式を壊さない
- ticket のライフサイクルは [ticket.sh](https://github.com/masuidrive/ticket.sh) に委ねる。PDH 側で再実装しない
- モデル名は時間で古びる。ドキュメントでは役割プロファイル（`strong-judge` 等）を正とし、具体的なモデル名は上書き例として扱う
- 本文は日本語、`AGENTS.md` など他 agent platform が読む入口は英語

## Architectural Invariants

- `AI-1` PDH 汎用ルールは `templates/PDH-AGENTS.md`、project 固有ルールは `templates/CLAUDE.md`。両者の内容を重複させない
- `AI-2` skill の実体は 1 つだけ置く（`skills/`、配布先 `.claude/skills/`）。他 engine 向けの入口は symlink とし、内容を複製した wrapper を作らない
- `AI-3` 配布テンプレートには、テンプレート自身の使い方説明を書かない。導入・更新手順は `INSTALL.md`、運用ルールは `docs/product-delivery-hierarchy.md` が正
- `AI-4` 配布物の実行依存は Markdown / bash / git / ticket.sh に限る（`hookbus.js` の Node 18+ のみ既存例外）
- `AI-5` フローは engine 中立に記述する。特定 engine 固有の起動手順は、その前提を明示したセクションに閉じ込める

## Done

- 新規プロジェクトで `INSTALL.md` を agent に読ませるだけで導入が完了する
- Claude Code / Codex CLI のどちらを main にしても stage flow が回る
- 実プロジェクトで得た改善が `pdh-update` で他プロジェクトへ伝播する
- PDH repo 自身が PDH で運用されている（2026-07-18 着手: root `product-brief.md` / `CLAUDE.md` を追加）

## Non-goals

- Web UI / SaaS / ダッシュボードを持つこと。Git + Markdown で完結させる
- ticket のライフサイクル管理を自前実装すること（ticket.sh に委ねる）
- Claude Code 専用にすること。engine 中立を保つ
- 3 層構造 (Epic) への回帰。overhead が価値を上回ると実証済み

## Open Questions

（現時点で未解決の問いはない）

決定済み:

- **ticket 運用はしない**（2026-07-18）。PDH repo 自身への適用は `product-brief.md` / `CLAUDE.md` / 自動検査までとし、`ticket.sh` は導入しない
- **自動検査は持つ**（2026-07-18）。`scripts/test-all.sh` = fast-checks + check-distribution + shell 構文
- **配布物間の重複検出も自動化する**（2026-07-18）。当初は「grep で表現できない」として見送ったが、行単位の完全一致に限れば検出可能だった。`check-distribution.sh` に実装（80 バイト以上の同一行が複数の配布物に現れたら失敗、意図的な重複は理由付きで allowlist）。導入時点で 2 件の実在する重複を検出し、うち 1 件は既に内容が食い違っていた

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/templates/product-brief.md
