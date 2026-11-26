# PDH 配布元での作業

製品の目的は [Product Brief](product-brief.md)、利用者が行う導入・更新は [INSTALL.md](INSTALL.md) を参照する。

- Claude Code・Codex CLI に配るスキル、チケット操作、検収ゲートの原本は `shared/`。コーディングとテストの判断を変えるときは [実装の指示](shared/.claude/skills/pdh/references/implementation.md) と [手法の選び方](shared/.claude/skills/pdh/references/methods.md) を編集する。
- `install.py` と `migration.py` は導入先の設定・製品独自の指示・既存データを保って現行版を配置する。導入先にすでにある `pdh-update` が読む `claude/INSTALL.md` と `codex/INSTALL.md` は、共通の導入手順への案内。
- [GitHub coding-bot](github-bot/INSTALL.md) は独立した配布物。変更時は導入済みプロジェクトの Issue 操作と人による承認の動作も確認する。
- 配布元で `bash scripts/test-all.sh` を実行する。更新の変更は使い捨ての Git プロジェクトで確認する。製品固有の指示・フックを持つ導入先は、更新を適用して再度 `--check` したときに差分が空になることも確かめる。

旧チケットの手順と保守資料は [stage 版の固定コミット](https://github.com/masuidrive/pdh/tree/5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41) を参照する。
