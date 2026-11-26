# PDHを導入・更新する

Claude Code と Codex CLI に共通の `pdh` と `pdh-update` を配布する。初回も旧stage方式からの更新も、対象のプロジェクトのGitルートで次を実行する。既存の `pdh-update` からこの手順を開いた場合も同じである。

```bash
project=$(git rev-parse --show-toplevel)
distribution=$(mktemp -d)
git clone --single-branch --branch main https://github.com/masuidrive/pdh.git "$distribution/pdh"
git -C "$distribution/pdh" rev-parse HEAD
python3 "$distribution/pdh/install.py" --target "$project" --check
python3 "$distribution/pdh/install.py" --target "$project"
python3 "$distribution/pdh/install.py" --target "$project" --check
git -C "$project" status --short
```

旧テンプレートの由来をGit履歴で照合するため、配布元は履歴を含めて取得する。適用前に表示された対象を読み、適用後の再検査で変更予定が空であることを確かめる。配布元の版と導入差分をプロジェクトのGitに記録する。製品の目的と完了条件は `product-brief.md`、製品の通常試験は `scripts/test-all.sh` に用意する。必要な開発環境やテスト用の接続先は各製品の手順に従う。

## 導入後の配置

配布元の指定コミットで追跡するファイルを、同じ相対パス・内容・実行権限で製品の `pdh/` に配置する。導入先の Git がこれらを通常のファイルとして管理する。製品を clone した人は、同じコミットの製品と PDH をそのまま使える。

| 導入先 | 用途 |
|---|---|
| `pdh/skills/pdh/`、`pdh/skills/pdh-update/` | 両エンジンが使うスキルの原本 |
| `.claude/skills/`、`.agents/skills/` | それぞれの `pdh` と `pdh-update` が原本を指す相対シンボリックリンク |
| `pdh/scripts/`、`pdh/checks/` | チケットの実行・検収と共通チェック |
| `pdh/AGENTS.md`、`pdh/CLAUDE.md` | 管理範囲と配布元に修正を反映する手順 |
| `ticket.sh`、`.ticket-config.yaml`、`pdh-flow.md` | 製品ルートから使う入口。原本は配布元の `integration/` |
| `.pdh-install.lock` | 配布元の版と導入ファイルの記録 |
| `product-brief.md`、`tickets/`、`scripts/test-all.sh` | 製品側で管理する目的・チケット・通常試験 |

配布元の開発用テストや GitHub coding-bot の原本も `pdh/` に含まれる。製品で bot を有効化する手順は [bot の導入ガイド](github-bot/INSTALL.md) にある。

## 既知の移行手順

新しいチケットは `pdh` を使う。進行中の旧チケットは更新前のプロジェクトの worktree で完了する。当時の配置表・手順・試験は [固定した stage 版](https://github.com/masuidrive/pdh/tree/5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41) にある。GitHub coding-bot を導入済みのプロジェクトでは、その bot が新たに作る Issue チケットにプロジェクト内の設定を使う。[bot の手順](github-bot/INSTALL.md)

PDHの次の更新も `pdh-update` を使う。単体の `ticket.sh selfupdate` はPDH用の検収機能を含む版を置き換えるので使用しない。独立検収を送信する前に `ticket.sh decision` のプレビューを読み、外部へ送ってよい資料か確認する。最終的なcloseは対象の版への人の承認を得てから実行する。

更新した共通ファイルの記録は `.pdh-install.lock` に置く。導入済みの bot が使う設定は導入先に保持する。以前の配布ファイルを検査する導入先では `.pdh-lock` を引き続き使う。製品が独自に編集した共有ファイルや未コミットの設定を自動で置き換えられない場合は、表示されたパスの差分を調べてから再実行する。仕事用worktreeへ複製する認証ファイルはGitの管理外に置く。
