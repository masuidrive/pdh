# PDH — Product Delivery Hierarchy

PDHは、coding agentが製品の利用場面を実装し、利用者と同じ入口で結果を確かめ、人がチケットを閉じてよいか判断するためのスキルと検収ツールです。

[導入・pdh-updateの手順](INSTALL.md) · [スキル本文](skills/pdh/SKILL.md) · [チケット操作](USAGE.md)

## チケットで何をするか

Product Brief と利用者に約束する完了条件を合意した版に残します。実装者は変更に合った方法を選び、試した操作・期待する結果・実際に観察した結果を記録します。通常の製品試験と、今回のチケットで必要な計測や実機確認を使えます。[実装とテストの指示](skills/pdh/references/implementation.md)・[手法の選び方](skills/pdh/references/methods.md)

提出前には、実装時の会話を引き継がない読み手が利用者の失敗例を選びます。製品の通常試験、各条件と試験の対応、対象コミット、独立検収の判定を `ready` で照合します。最後に人がその版を承認して `ticket.sh close` を実行します。

## ディレクトリ構成

| ディレクトリ | 何があるか |
| --- | --- |
| [skills/](skills/) | 開発を進める `pdh` と、導入済みの PDH を更新する `pdh-update` の指示書。 |
| [integration/](integration/) | 導入先のプロジェクト直下に置く `ticket.sh`、チケットの設定、PDH の進め方を案内する文書の原本。 |
| [scripts/](scripts/README.md) | 製品のテストを実行し、結果をチケットに記録して、完了条件を満たしたか確認するスクリプト。 |
| [checks/](checks/) | チケット名やチェックリスト、完了条件とテスト結果の対応など、各チケットに共通する検査。 |
| [claude/](claude/INSTALL.md) | Claude Code を使う人向けの導入・更新手順への案内。 |
| [codex/](codex/INSTALL.md) | Codex CLI を使う人向けの導入・更新手順への案内。 |
| [github-bot/](github-bot/) | GitHub Issue のコメントからエージェントを動かす、任意の coding-bot の実装と運用手順。 |
| [tests/](tests/) | PDH 自体の導入・更新、チケットの検収、coding-bot の動作を確かめるテスト。 |
| [tools/](tools/) | PDH の開発に使うコマンド。全テストの実行や文書のリンク切れの確認に使います。 |
| [.github/](.github/) | このリポジトリへの push とプルリクエストで PDH のテストを実行する GitHub Actions の設定。 |

## エンジンと配布ファイル

- このリポジトリの指定コミットを、導入先の `pdh/` に通常の Git ファイルとして配置します。導入先を clone すると、同じ版の PDH も揃います。Claude Code・Codex CLIから同じ `pdh` を使えます。Claudeが進行し、作業範囲と製品の条件を渡してCodexに実装・実装中のテストを任せる構成も選べます。
- `install.py` と `migration.py` は新規導入・更新に使います。製品のルートに置く入口の原本は `integration/` にあり、両エンジンのスキルは `skills/` を参照します。実行にはGit、Bash、Python 3.11以降が必要です。Claude 単独では Claude Code、Codex 単独では Codex CLI の新しいセッションで独立検収します。どちらも Linux の bubblewrap と各 CLI のログインを使います。Responses APIを選ぶ環境はチケット手順の `--backend responses` を参照してください。

旧チケット用のスキル・テンプレート・評価資料は [stage 版の最終コミット](https://github.com/masuidrive/pdh/tree/5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41) にあります。進行中の旧チケットは、更新前のプロジェクトの worktree で扱ってください。
