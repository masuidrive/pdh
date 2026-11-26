# PDH — Product Delivery Hierarchy

PDHは、coding agentが製品の利用場面を実装し、利用者と同じ入口で結果を確かめ、人がチケットを閉じてよいか判断するためのスキルと検収ツールです。

[導入・pdh-updateの手順](INSTALL.md) · [スキル本文](shared/.claude/skills/pdh/SKILL.md) · [チケット操作](shared/tickets/PDH.md)

## チケットで何をするか

Product Brief と利用者に約束する完了条件を合意した版に残します。実装者は変更に合った方法を選び、試した操作・期待する結果・実際に観察した結果を記録します。通常の製品試験と、今回のチケットで必要な計測や実機確認を使えます。[実装とテストの指示](shared/.claude/skills/pdh/references/implementation.md)・[手法の選び方](shared/.claude/skills/pdh/references/methods.md)

提出前には、実装時の会話を引き継がない読み手が利用者の失敗例を選びます。製品の通常試験、各条件と試験の対応、対象コミット、独立検収の判定を `ready` で照合します。最後に人がその版を承認して `ticket.sh close` を実行します。

## エンジンと配布ファイル

- `shared/` が現行の共通配布物です。Claude Code・Codex CLIから同じ `pdh` を使えます。Claudeが進行し、作業範囲と製品の条件を渡してCodexに実装・実装中のテストを任せる構成も選べます。
- `install.py` と `migration.py` は新規導入・更新の入口です。実行にはGit、Bash、Python 3.11以降が必要です。既定の独立検収はLinuxのbubblewrapとサインイン済みのCodex CLIを使います。Responses APIを選ぶ環境はチケット手順の `--backend responses` を参照してください。
- `github-bot/` は導入済みの GitHub coding-bot の実装、`scripts/`・`tests/` は配布元の試験です。

旧チケット用のスキル・テンプレート・評価資料は [stage 版の最終コミット](https://github.com/masuidrive/pdh/tree/5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41) にあります。進行中の旧チケットは、更新前のプロジェクトの worktree で扱ってください。
