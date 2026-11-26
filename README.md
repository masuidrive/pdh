# PDH — Product Delivery Hierarchy

PDHは、coding agentが製品の利用場面を実装し、利用者と同じ入口で結果を確かめ、人がチケットを閉じてよいか判断するためのスキルと検収ツールです。

[導入・pdh-updateの手順](INSTALL.md) · [スキル本文](skills/pdh/SKILL.md) · [チケット操作](USAGE.md)

## チケットで何をするか

Product Brief と利用者に約束する完了条件を合意した版に残します。実装者は変更に合った方法を選び、試した操作・期待する結果・実際に観察した結果を記録します。通常の製品試験と、今回のチケットで必要な計測や実機確認を使えます。[実装とテストの指示](skills/pdh/references/implementation.md)・[手法の選び方](skills/pdh/references/methods.md)

提出前には、実装時の会話を引き継がない読み手が利用者の失敗例を選びます。製品の通常試験、各条件と試験の対応、対象コミット、独立検収の判定を `ready` で照合します。最後に人がその版を承認して `ticket.sh close` を実行します。

## scripts/ の中身

このリポジトリの `scripts/` は、導入先では `pdh/scripts/` に置かれます。普段のチケット操作には製品ルートの `./ticket.sh` を使います。たとえば `./ticket.sh decision` は独立検収の資料を準備し、`./ticket.sh close` は人が承認した版を閉じる前に `ready` を呼びます。[チケット操作とコマンド例](USAGE.md)

| 作業で使う入口 | 何をするか |
| --- | --- |
| [pdh.py](scripts/pdh.py) | `test` は製品側の `scripts/test-all.sh` を実行し、通った版をチケットの `suite-pass` に記録します。`decision` は独立検収を扱い、`ready` は合意・試験結果・観察記録・必要な判定が提出する版に対応しているかを照合します。 |
| [test-ticket-local.sh](scripts/test-ticket-local.sh) | 今回のチケット専用の試験を実行する入口です。引数を省くと作業中のチケットを選び、その中の `tests/test-ticket-local.sh` を呼びます。 |
| [pdh_coverage.py](scripts/pdh_coverage.py) | 完了条件（AC）ごとの証拠をまとめます。`collect` は試験を実行して JUnit の結果を収集し、`observe` は手動観察を記録します。`bind` はそれらを `tests/coverage.tsv` の各行に結び付け、`verify` は対応と実行版を検査します。 |

| PDH が内部で使うファイル | 呼び出し元と役割 |
| --- | --- |
| [pdh-ticket-ready.sh](scripts/pdh-ticket-ready.sh) | `ticket.sh decision` と close 前のフックが使います。対象チケットと初回合意の SHA を特定して `pdh.py` に渡します。 |
| [pdh_decision.py](scripts/pdh_decision.py) | `pdh.py` から呼ばれ、合意・差分・証拠から送信資料を組み立てます。選んだ検収先の判定を `decision.json` に保存し、`ready` では保存済みの記録を照合します。 |
| [pdh_judge_claude.py](scripts/pdh_judge_claude.py)・[pdh_judge_codex.py](scripts/pdh_judge_codex.py)・[pdh_judge_api.py](scripts/pdh_judge_api.py) | 独立検収で選べる3つの送信先（Claude Code、Codex CLI、OpenAI Responses API）に対応します。1回の送信で使うのは指定した1方式です。API 用ファイルには3方式に共通する判定指示と応答形式もあります。 |
| [check_ticket_name.py](scripts/check_ticket_name.py) | [ticket-name.sh](checks/ticket-name.sh) が呼ぶ名前検査です。チケットのパスと、名前に含まれる作成日時・slug を確認します。 |
| [pdh-prose.txt](scripts/pdh-prose.txt) | `pdh.py` が読む設定ファイルです。説明文だけを変更したときに同じ製品版の試験結果を使える文書を列挙します。現在の対象は `docs/known-limits.md` です。 |
| [pdh-session-context.sh](scripts/pdh-session-context.sh) | 旧版から移行したプロジェクトに残るセッション開始フックの入口です。旧 stage 方式の GitHub bot 用チケットを扱う条件がそろうと、既存の `pdh-session-hook.sh` に処理を渡します。 |

## エンジンと配布ファイル

- このリポジトリの指定コミットを、導入先の `pdh/` に通常の Git ファイルとして配置します。導入先を clone すると、同じ版の PDH も揃います。Claude Code・Codex CLIから同じ `pdh` を使えます。Claudeが進行し、作業範囲と製品の条件を渡してCodexに実装・実装中のテストを任せる構成も選べます。
- `install.py` と `migration.py` は新規導入・更新に使います。製品のルートに置く入口の原本は `integration/` にあり、両エンジンのスキルは `skills/` を参照します。実行にはGit、Bash、Python 3.11以降が必要です。Claude 単独では Claude Code、Codex 単独では Codex CLI の新しいセッションで独立検収します。どちらも Linux の bubblewrap と各 CLI のログインを使います。Responses APIを選ぶ環境はチケット手順の `--backend responses` を参照してください。
- `github-bot/` は導入済みの GitHub coding-bot の実装、`scripts/`・`checks/` はチケットの検収、`tools/`・`tests/` は配布元の開発と試験に使います。

旧チケット用のスキル・テンプレート・評価資料は [stage 版の最終コミット](https://github.com/masuidrive/pdh/tree/5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41) にあります。進行中の旧チケットは、更新前のプロジェクトの worktree で扱ってください。
