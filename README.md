# PDH — Product Delivery Hierarchy

PDHは、coding agentが製品の利用場面を実装し、利用者と同じ入口で結果を確かめ、人がチケットを閉じてよいか判断するためのスキルと検収ツールです。

[導入・pdh-updateの手順](INSTALL.md) · [スキル本文](skills/pdh/SKILL.md) · [チケット操作](USAGE.md)

## チケットで何をするか

Product Brief と利用者に約束する完了条件を合意した版に残します。実装者は変更に合った方法を選び、試した操作・期待する結果・実際に観察した結果を記録します。通常の製品試験と、今回のチケットで必要な計測や実機確認を使えます。[実装とテストの指示](skills/pdh/references/implementation.md)・[手法の選び方](skills/pdh/references/methods.md)

提出前には、実装時の会話を引き継がない読み手が利用者の失敗例を選びます。製品の通常試験、各条件と試験の対応、対象コミット、独立検収の判定を `ready` で照合します。最後に人がその版を承認して `ticket.sh close` を実行します。

## scripts/ の中身

普段のチケット操作にはプロジェクト直下の `./ticket.sh` を使います。このリポジトリの `scripts/` には、製品のテストやチケットを閉じる前の確認に使うファイルがあります。導入すると `pdh/scripts/` に入ります。製品全体のテストはプロジェクト側の `scripts/test-all.sh` に置きます。

### テストを実行して結果を残す

| やりたいこと | 使うファイル |
| --- | --- |
| 製品全体をテストする | [pdh.py](scripts/pdh.py) の `test` が製品の `scripts/test-all.sh` を実行します。成功すると、テストが通ったコミットをチケットの `suite-pass` に記録します。 |
| 今回のチケットだけをテストする | [test-ticket-local.sh](scripts/test-ticket-local.sh) を引数なしで実行すると、作業中のチケットの `tests/test-ticket-local.sh` が動きます。 |
| 完了条件ごとに何を確かめたかを記録する | [pdh_coverage.py](scripts/pdh_coverage.py) の `collect` はテストを実行して JUnit 形式の結果を集め、`observe` は手動で確かめた結果を記録します。`bind` はそれぞれの結果を `tests/coverage.tsv` の該当する条件に結び付け、`verify` はその対応とテストした版を確かめます。 |

### 検収してチケットを閉じる

`./ticket.sh decision` を実行すると、実装時の会話を引き継がずに判定するための資料を確認できます。人が対象の版を承認して `./ticket.sh close` を実行すると、PDH はチケットを閉じる前にその版の記録を確認します。[コマンドの使い方](USAGE.md)

| PDH が呼ぶファイル | 役割 |
| --- | --- |
| [pdh-ticket-ready.sh](scripts/pdh-ticket-ready.sh) | `decision` と `close` の両方が使います。対象のチケットと、最初に完了条件に合意したコミットの SHA を調べて `pdh.py` に渡します。 |
| [pdh.py](scripts/pdh.py) | `decision` は下の `pdh_decision.py` を呼びます。`ready` は合意した条件、テスト結果、手動で確かめた記録、必要な判定が提出する版に対応しているかを確認します。 |
| [pdh_decision.py](scripts/pdh_decision.py) | 合意した条件、コードの変更内容、テストや観察の記録をまとめます。検収を依頼すると、返ってきた判定を `decision.json` に保存します。`ready` のときは保存済みの判定を照合します。 |

`pdh_judge_` で始まる3ファイルは検収の依頼先ごとに分かれています。1回の検収で使うのは選んだ依頼先の1つです。

| 依頼先 | ファイル |
| --- | --- |
| Claude Code | [pdh_judge_claude.py](scripts/pdh_judge_claude.py) |
| Codex CLI | [pdh_judge_codex.py](scripts/pdh_judge_codex.py) |
| OpenAI Responses API | [pdh_judge_api.py](scripts/pdh_judge_api.py)（3方式に共通する判定の指示と回答形式もここにあります） |

### 命名規則・設定・旧版との互換性

| ファイル | 用途 |
| --- | --- |
| [check_ticket_name.py](scripts/check_ticket_name.py) | [ticket-name.sh](checks/ticket-name.sh) が呼び出します。チケットのパスと、名前に含まれる作成日時・短い名前（slug）が命名規則に合っているかを調べます。 |
| [pdh-prose.txt](scripts/pdh-prose.txt) | `pdh.py` が読む設定です。ここに載っている文書だけを変更した場合は、同じ製品版のテスト結果を使えます。現在の対象は `docs/known-limits.md` です。 |
| [pdh-session-context.sh](scripts/pdh-session-context.sh) | 旧版から更新したプロジェクト用です。セッション開始時に旧 stage 方式の GitHub bot 用チケットを使う条件がそろっていれば、既存の `scripts/pdh-session-hook.sh` を実行します。 |

## エンジンと配布ファイル

- このリポジトリの指定コミットを、導入先の `pdh/` に通常の Git ファイルとして配置します。導入先を clone すると、同じ版の PDH も揃います。Claude Code・Codex CLIから同じ `pdh` を使えます。Claudeが進行し、作業範囲と製品の条件を渡してCodexに実装・実装中のテストを任せる構成も選べます。
- `install.py` と `migration.py` は新規導入・更新に使います。製品のルートに置く入口の原本は `integration/` にあり、両エンジンのスキルは `skills/` を参照します。実行にはGit、Bash、Python 3.11以降が必要です。Claude 単独では Claude Code、Codex 単独では Codex CLI の新しいセッションで独立検収します。どちらも Linux の bubblewrap と各 CLI のログインを使います。Responses APIを選ぶ環境はチケット手順の `--backend responses` を参照してください。
- `github-bot/` は導入済みの GitHub coding-bot の実装、`scripts/`・`checks/` はチケットの検収、`tools/`・`tests/` は配布元の開発と試験に使います。

旧チケット用のスキル・テンプレート・評価資料は [stage 版の最終コミット](https://github.com/masuidrive/pdh/tree/5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41) にあります。進行中の旧チケットは、更新前のプロジェクトの worktree で扱ってください。
