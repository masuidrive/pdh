# PDH Dev — ユーザ相談ルールと中止フロー

## ユーザ相談ルール

次の場合はユーザに確認する。

1. scope、仕様、ACなど、判断に迷うか取り消しコストが高い場合
2. 同種findingが2 attemptで再発し、reviewが収束しない場合
3. `_review.md`の分類基準では同一ticketと説明できず、新機能、API契約変更、AC追加相当をcurrent ticketへ含める必要がある場合
4. 重大なsecurity問題を発見した場合
5. テスト、review、外部依存、環境制約により、同一session内に`PDH-human-review`へ到達する見込みを説明できない場合

相談の提示形式は`PDH-AGENTS.md`「Reporting」に従い、各選択肢にtradeoffを1行添える。
同一ticketと説明できない実在問題は、current ticketへ含める必要がある場合を除きfollow-upにする。

通常は`PDH-review`と`PDH-verify`まで自動で進める。
上の条件に該当したらhuman review gateを待たず、noteに加えて会話で状況、判断、選択肢を示す。

承認には`OK`、`yes`、`進めて`、`閉じて`などの明示応答が必要である（規範は`PDH-AGENTS.md`「Verification」Human authority）。

## 中止フロー

- 中止理由をticketとnoteへ記録してから`./ticket.sh cancel`を実行する
- cancel済みticketは`tickets/done/`へ保存し、判断履歴として削除しない
- Product Briefの前提が崩れたら下位作業を止め、上位を先に更新する
