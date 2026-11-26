# テストと検収のスクリプト

普段のチケット操作にはプロジェクト直下の `./ticket.sh` を使います。このリポジトリの `scripts/` には、製品のテストやチケットを閉じる前の確認に使うファイルがあります。導入すると `pdh/scripts/` に入ります。製品全体のテストはプロジェクト側の `scripts/test-all.sh` に置きます。

## テストを実行して結果を残す

| やりたいこと | 使うファイル |
| --- | --- |
| 製品全体をテストする | [pdh.py](pdh.py) の `test` が製品の `scripts/test-all.sh` を実行します。成功すると、テストが通ったコミットをチケットの `suite-pass` に記録します。 |
| 今回のチケットだけをテストする | [test-ticket-local.sh](test-ticket-local.sh) を引数なしで実行すると、作業中のチケットの `tests/test-ticket-local.sh` が動きます。 |
| 完了条件ごとに何を確かめたかを記録する | [pdh_coverage.py](pdh_coverage.py) の `collect` はテストを実行して JUnit 形式の結果を集め、`observe` は手動で確かめた結果を記録します。`bind` はそれぞれの結果を `tests/coverage.tsv` の該当する条件に結び付け、`verify` はその対応とテストした版を確かめます。 |

## 検収してチケットを閉じる

`./ticket.sh decision` を実行すると、実装時の会話を引き継がずに判定するための資料を確認できます。人が対象の版を承認して `./ticket.sh close` を実行すると、PDH はチケットを閉じる前にその版の記録を確認します。[コマンドの使い方](../USAGE.md)

| PDH が呼ぶファイル | 役割 |
| --- | --- |
| [pdh-ticket-ready.sh](pdh-ticket-ready.sh) | `decision` と `close` の両方が使います。対象のチケットと、最初に完了条件に合意したコミットの SHA を調べて `pdh.py` に渡します。 |
| [pdh.py](pdh.py) | `decision` は下の `pdh_decision.py` を呼びます。`ready` は合意した条件、テスト結果、手動で確かめた記録、必要な判定が提出する版に対応しているかを確認します。 |
| [pdh_decision.py](pdh_decision.py) | 合意した条件、コードの変更内容、テストや観察の記録をまとめます。検収を依頼すると、返ってきた判定を `decision.json` に保存します。`ready` のときは保存済みの判定を照合します。 |

`pdh_judge_` で始まる3ファイルは検収の依頼先ごとに分かれています。1回の検収で使うのは選んだ依頼先の1つです。

| 依頼先 | ファイル |
| --- | --- |
| Claude Code | [pdh_judge_claude.py](pdh_judge_claude.py) |
| Codex CLI | [pdh_judge_codex.py](pdh_judge_codex.py) |
| OpenAI Responses API | [pdh_judge_api.py](pdh_judge_api.py)（3方式に共通する判定の指示と回答形式もここにあります） |

## 命名規則・設定・旧版との互換性

| ファイル | 用途 |
| --- | --- |
| [check_ticket_name.py](check_ticket_name.py) | [ticket-name.sh](../checks/ticket-name.sh) が呼び出します。チケットのパスと、名前に含まれる作成日時・短い名前（slug）が命名規則に合っているかを調べます。 |
| [pdh-prose.txt](pdh-prose.txt) | `pdh.py` が読む設定です。ここに載っている文書だけを変更した場合は、同じ製品版のテスト結果を使えます。現在の対象は `docs/known-limits.md` です。 |
| [pdh-session-context.sh](pdh-session-context.sh) | 旧版から更新したプロジェクト用です。セッション開始時に旧 stage 方式の GitHub bot 用チケットを使う条件がそろっていれば、既存の `scripts/pdh-session-hook.sh` を実行します。 |
