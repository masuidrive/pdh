# AGENTS.md — Codex CLI 向け設定

このファイルは Codex CLI が自動で読む。ルールの本体は CLAUDE.md と .claude/skills/ にあり、ここでは参照先を指定する。

## 必読ファイル

作業開始前に以下を読むこと:

1. **`.claude/skills/pdh-coding/SKILL.md`** — コーディングルール・テスト設計・コミット基準
2. **`CLAUDE.md`** の以下のセクション:
   - 「テスト」— テストコマンド・DB 使い分け・全スイート一括実行
   - 「開発サーバー」— 起動方法・seed データ
3. **`product-brief.md`** — プロダクト概要（全判断の基準）
4. **`current-ticket.md`** / **`current-note.md`** — 作業対象の AC と計画

## 基本方針

- **時間がかかっても技術的正しさを優先する。** 後方互換のための余計なコードやハックは入れない
- spawn プロンプトで指定されたファイル範囲外を変更しない
- product-brief.md を編集しない

## プロジェクト固有ルール

テスト・ビルド・DB 設定などプロジェクト固有の情報は **CLAUDE.md が single source of truth**。
このファイルに複製しない。CLAUDE.md を直接読むこと。
