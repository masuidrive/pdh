# PDH Dev — リファレンス

## 判断の優先順位

判断ではuser journey動作をengineering aestheticsより優先する。

## stage label

`PDH-open`、`PDH-ticket-review`、`PDH-ticket-human-review`、`PDH-implement`、`PDH-review`、`PDH-verify`、`PDH-human-review`、`PDH-close` の 8 つだけを checklist key として使う。review attempt は `PDH-review-1`、`PDH-review-2` のように `PDH-review` 配下の log として番号を振る。

## 報告

stage 遷移と差し戻しは、毎回 `[前 stage] -> [次 stage] — 理由` の 1 行で宣言する。暗黙の遷移をしない。進捗を求められたら次の形で返す。

```text
Current Stage:
Stage Status: 未着手 / 進行中 / 完了
Gate Remaining:
Evidence:
Next Stage:
```

`Gate Remaining` が空でなければ stage は未完了である。

## ticket / note / progress の役割分担

実パスは `./ticket.sh start` または `./ticket.sh restore` 出力の `ticket:`/`note:` 行が示す（互換 symlink: `current-ticket.md`/`current-note.md`）。

| file | 役割 | 残す情報 |
|---|---|---|
| ticket file (`ticket:`) | ゴール。後世への記録 | Why、AC、Invariants check、Design Decisions、Out-of-scope、任意の Implementation Notes |
| note file (`note:`) | 現在値。session 間の引継ぎ | Status、Checklist、Required Probes、process check、Technical reference 更新、Open Questions、Resume Point |
| progress file（同じ dir の `progress.md`） | 経緯。close 後に工程を追える唯一の記録 | stage 遷移、実装ログ、`### Findings (PDH-review-N)` 表、人から返った答え（gate・相談とも。ticket を変えるものは ticket 本体も直す）、Discoveries、検証の実 command と実 output |

節構成は `.ticket-config.yaml` の `default_content` / `note_content` が決める。`./ticket.sh new` が出した節と記入ガイドに従い、そこに無い section を前提にしない。次を守る。

- ticket の長さの目安を、節の数と矛盾する数字で置かない。長さは `.ticket-config.yaml` の `default_content` が declare した節が決める — **節を全部埋めて収まらない行数を目安に書くと、全 ticket がその目安を破り、誰も気づかない**
- 1 ticket per work。cross-cuttingな全layerを1 ticket、1作業文脈で整合させる
- Implementation Notes は、ユーザが明示または会話で言及した関数名 / module 名 level の事項だけを書く。自主的に書かない
- Status行を冒頭に維持し、timestampを必須とする
- 空 section には skip 理由を 1 行書く
- gate 未達のまま次 stage 名へ Status を進めない
- progress は追記のみ。1 出来事 1 見出しで `## <UTC 日時> [<stage>] <題>` の形にし、書いた後は編集しない（消す・書き換えると `ticket.sh close` が `append_only_files` で拒否する）。書くのは diff を生まない出来事だけ（diff を生む変更は commit が持つ）
- attempt 2 以降は progress に `### Findings (PDH-review-2)` のように見出しを自分で追加する
- session 終了時に作業途中なら、現在状態と次 action を note へ残す
- 検証checkは対象SHA、実command、実outputをprogressへ貼ってからnoteのcheckboxをcheckする

## AC に書いてよいもの / 書いてはいけないもの

AC には観察可能な product 動作を書く。review 結果や test pass 等の process 要件は書かず、note の checklist へ置く。

**AC の読み手は ticket を承認する人である。**読める AC とは、承認者がその 1 行だけを読んで「満たされた場面」を頭の中で再生できる AC をいう。要るのは 3 つ — 登場人物、その人がする操作、その人が見る結果。

判定は 1 問で行う。**「承認者がこれを自分で確かめるとしたら、何をするか。」**答えが書けないなら、実装の言葉で決めた中身を `Design Decisions` へ移し、AC には場面を残す。約束の中身を減らさない。読み手だけを変える。

- **内部識別子は禁止語ではない。**約束の本体が承認者の言葉で書かれていれば、実装上の識別子を括弧で添えてよい
- **平易な言葉への言い換えではない。**読み手は上級エンジニアである。避けるのは技術的な内容ではなく、承認者に板や ticket の外を見に行かせること
- **非退行の AC には登場人物だけを求め、「いままでできなかった」を求めない**

## 成果物セルフチェック

ticket または実行指示の提出前に次を check し、1 つでも該当すれば抽象化する。

- `product-brief.md` の Architectural Invariants と整合するか
- signature、行番号、内部 flow、snapshot、code snippet 等の実装詳細が混入していないか
- AC が観察可能な振る舞いだけか
- 実行指示に how-to が混入していないか
- AC、実装、ticket 候補に投機的拡張または将来要件向け設計がないか
