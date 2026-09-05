# PDH Dev — Stage Flow

## 前提

`./ticket.sh help` を最初に実行する。各 stage の入口で note の Status の現在段階を示す行だけを更新し、同じ節にある経緯・証拠・合意の記録は保持する。仕様変更に合意したら、code と review を続ける前に ticket の AC と確定判断を更新する。通常は`PDH-review`と`PDH-verify`まで自動で進める。

## PDH-open

1. `./ticket.sh start`/`restore` 出力の `ticket:` と `note:` パスを確認する。無ければ `list`、新規なら `new <slug>` → 標準構造の記入 → `start <ticket-name>`
2. `What` の冒頭へ 1 文を書く — 「この ticket が終わると、〈誰〉が、いままでできなかった〈何〉をできるようになる」
3. 各 AC はこの 1 文の分割としてだけ書く
4. AC を note へ copy しない

## PDH-ticket-review

1. Why を `product-brief.md` の目的へ接続する。矛盾する要求は実装せず提起する
2. 未測定の数値目標・可否を条件にした分岐・文面のない「◯◯が入る」・対象を列挙しない件数は、調べて確定させてから AC に書く
3. [_reference.md](_reference.md)「AC に書いてよいもの / 書いてはいけないもの」を AC 全件に当てる。書き換えた行にも当て直す
4. 次を実体に当たって確定させる
   - `Open Questions` 全件。残すのは承認者にしか決められないものと、実装しないと分からないものだけ
   - 「未確認」「要確認」「見込み」「はず」「思われる」「かもしれない」の grep
   - 「変更なし」「不変の見込み」と書いた contract / data model の行
   - 影響レイヤーの grep。挙げなかったレイヤーが無関係かも確かめる
   - 断定しているフィールド名・関数名・呼び出し元の数・件数
   - 合意に使われた画像。決めている文言・色・導線・並び順を文字にも起こす
5. 達成を確かめていない AC は、確かめる手段を note の `Required Probes` へ書き、次 stage の前に実行して結果を note へ書く
6. 実装しないと分からない AC は「測って記録する＋この値を下回ったら止めて報告する」の形にする
7. AC が触る consumer surface を note へ列挙する — UI、HTTP API、SDK、CLI、Config、生成物、観測 surface
8. `What` 冒頭の 1 文と AC 全件だけを «書いていない agent» へ渡し、「終わると誰が何をできるようになるか」を復元させる（`pdh-verifying`「AC 読み手」）。復元できない AC を書き直し、書き直した分だけをもう一度渡す。指摘に応じて AC を足さない
9. 未確定判断と未完了 Dependency は、着手前にユーザへ確認する

## PDH-ticket-human-review

1. `./ticket.sh check --require "Required Probes"` を実行する。未了があれば必要な事実を先に測る。実装許可の有無は `PDH-AGENTS.md`「Stage Flow」で判断し、既存の明示依頼を同じ内容の承認待ちに置き換えない
2. 会話へ渡す材料は `pdh-decision-board`（`ticket-gate.md`）に従う。AC は承認対象の文言そのままを引用する

## PDH-implement

- 実装 worker の規則は `pdh-coding` skill にある
- 出口検品では、`scripts/test-all.sh` の command と最終合否の実出力が note へ verbatim で貼られていることを確認する

## PDH-review

review 前に `git merge-base --is-ancestor origin/<base> HEAD` を確認し、false なら `git merge origin/<base> --no-edit` してから review する（base は ticket frontmatter の `branch`、未指定なら default branch）。

- 未記載の公開 surface、破壊操作、権限変更を機械的に列挙する。見つけたら Critical として human gate へ出す
- 中間 attempt では、変更 file と import chain 上の影響 test だけを実行する
- 完了条件は、最新 SHA で採用 Critical と Major が解消し、非採用理由が note にあること

## PDH-verify

1. ticket の各 AC と note の process checklist を、1 項目ずつ確認して check する
2. AC 裏取り Agent が各 AC の実質達成を検証する。`NOT VERIFIED` は不足を補完する。権限・環境の制約で補完できない場合は、その条件を未確認のまま明示し、影響と補完方法を人間判断へ渡す。未確認を達成済みに変えない
3. この ticket の差分に因果がある範囲で technical-reference.md を更新し、置き換えた記述・検査を削除する。該当なしなら note に 1 行残す。他 ticket 由来の記述・検査は消さず、削除候補として note に記録する
4. 最終の実装に対する `scripts/test-all.sh` の実出力を note へ貼る。既存の実行結果を使えるかは `PDH-AGENTS.md`「Verification」の鮮度条件で判断する
5. 外部 surface を consumer 視点で観察する（`pdh-verifying`「Surface Observer」）。純 backend は note に 1 行残して skip する
6. AC check 済み ticket file を含めて commit する

## PDH-human-review

1. verify までの証拠が commit 済みであることを確認する
2. 会話へ渡す材料は `pdh-decision-board`（`close-gate.md`）に従う。未対応 finding は、全 attempt の `### Findings (PDH-review-N)` 表から判定が起票・記録のみ・棄却の行を抜き出す

## PDH-close

1. 承認内容と、close 時点の merge、push、deploy 状態を記録する
2. 完了報告は `pdh-decision-board`（`close-gate.md`）に次を加える
   - 各 AC のデータ出所、検証した経路と未確認の範囲。合成データかどうかではなく、主張に必要な証拠が揃っているかを確認する
   - merge 直後に失う利用者機能と、その削除が承認された目的かを確認する。意図しない機能喪失は downstream 復旧予定でも blocker とする。承認済みの廃止は影響と合意を報告する
3. 承認後に `./ticket.sh close` を実行する

## 中止フロー

- 中止理由をticketとnoteへ記録してから`./ticket.sh cancel`を実行する
- cancel済みticketは`tickets/done/`へ保存し、判断履歴として削除しない
- Product Briefの前提が崩れたら下位作業を止め、上位を先に更新する
