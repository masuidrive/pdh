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

## ファイルを配置する

| 配布元 | プロジェクトで使う入口 |
|---|---|
| `shared/.claude/skills/pdh/` | Claude Code の `.claude/skills/pdh` と Codex の `.agents/skills/pdh`。実装と試験のプロンプト・手法の索引を含む |
| `shared/.claude/skills/pdh-update/` | 両方のエンジンの `pdh-update` |
| `shared/ticket.sh`、`shared/.ticket-config.yaml` | `ticket.sh new/start/restore/decision/close` と新しいチケットの帳票 |
| `shared/pdh-flow.md` | プロジェクトの指示から読む新旧チケットの案内 |
| `shared/tickets/PDH.md` | チケットの操作、試験結果の記録、独立検収 |
| `shared/scripts/` | 検収・試験・チケット名の確認。共通ゲートは `scripts/pdh-checks/` |
| `install.py`、`migration.py` | 配布元で実行。プロジェクトの入口・設定・既存チケットを確認して適用 |

## 既知の移行手順

新しいチケットは `pdh` を使う。導入前から進行中のstageチケットと、導入済みのstageラベルを扱うGitHub coding-botは従来の手順で継続する。旧チケットの履歴・技能・検査、製品の開発サーバー、通常試験、Gitのブランチ設定や起動時の処理は移行先で使用する。旧stageの配布物を照合する場合は [Claude用の旧配置表](claude/INSTALL-stage.md) と [Codex用の旧配置表](codex/INSTALL-stage.md) がある。

PDHの次の更新も `pdh-update` を使う。単体の `ticket.sh selfupdate` はPDH用の検収機能を含む版を置き換えるので使用しない。独立検収を送信する前に `ticket.sh decision` のプレビューを読み、外部へ送ってよい資料か確認する。最終的なcloseは対象の版への人の承認を得てから実行する。

更新した共通ファイルの記録は `.pdh-install.lock` に置く。既存のstage方式は移行時の対象チケット名と設定を `.pdh-legacy/` に保持し、従来配布物の検査には `.pdh-lock` を引き続き使う。製品が独自に編集した共有ファイルや未コミットの設定を自動で置き換えられない場合は、表示されたパスの差分を調べてから再実行する。仕事用worktreeへ複製する認証ファイルはGitの管理外に置く。
