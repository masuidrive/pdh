---
name: pdh-update
description: "PDH アップデート: 上流 PDH リポジトリの最新版を取り込み、プロジェクト固有設定を保持して配布物を更新する。「pdh-update」と明示された時だけ起動する。"
---

# PDH Update

次を最後まで実行する。

1. 上流の `INSTALL.md` を取得して「既存プロジェクトのアップデート」と「Claude 併用版からの移行」を読む。
2. 更新前に `INSTALL.md` の手順で timestamp 付き backup を作る。backup path を記録する。
3. `.agents/skills/pdh-*` と `.codex/agents/pdh-*` は上流定義で置き換える。列挙された PDH path だけを対象にし、user が追加した skill / agent は触らない。
4. `PDH-AGENTS.md` と `docs/product-delivery-hierarchy.md` を更新する。
5. `AGENTS.md`、`product-brief.md`、`technical-reference.md`、`.ticket-config.yaml`、`scripts/` の project 固有ファイルは上書きしない。template との差分を読み、必要な上流変更だけをマージする。
6. `INSTALL.md` の配置表に追加された `.check` を取り込み、project 固有の `.check` を残す。`required-pdh-files.check` は現行の skill / agent 定義一式に合わせる。
7. `bash ./ticket.sh selfupdate` で ticket.sh を更新する。
8. `Based on` の commit ID を上流 HEAD に更新し、`INSTALL.md` の導入結果検査と project の `scripts/test-all.sh` を実行する。
9. 同じ更新をもう一度実行し、PDH 配布物に 2 回目の差分が出ないことを確認する。

旧 `.claude/skills/`、`.claude/agents/`、`CLAUDE.md` がある場合は、`INSTALL.md` の migration に従う。先に内容を backup し、project 固有ルールを `AGENTS.md` へ統合する。`.claude/` 全体や user のファイルをまとめて削除しない。

完了報告には、上流 commit、backup path、更新した配布物、マージした project 固有ファイル、適用した migration、テスト結果、2 回目の冪等性確認を含める。

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-update/SKILL.md
