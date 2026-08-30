# PDH Dev — リファレンス

## 用語

- stage label：`PDH-open`、`PDH-ticket-review`、`PDH-ticket-human-review`、`PDH-implement`、`PDH-review`、`PDH-verify`、`PDH-human-review`、`PDH-close`の8つだけ。安定したchecklist keyとして扱う
- review attempt label：`PDH-review-1`、`PDH-review-2`等。top-level stageではなく`PDH-review`配下のlog
- gate：次stageへ進む完了条件。`Gate Remaining`が空でなければstage未完了
- AC：観察可能な振る舞いとして書くAcceptance Criteria
- Architectural Invariants：`product-brief.md`に明記された不変則に従う

## stage 遷移の宣言

stage遷移と差し戻しは毎回短く宣言する。省略または暗黙の遷移を禁止する。

```text
[PDH-open] -> [PDH-ticket-review] — ticket 確定
[PDH-ticket-review] -> [PDH-ticket-human-review] — ticket contract を提示可能
[PDH-ticket-human-review] -> [PDH-implement] — AC 承認、実装開始
[PDH-review] -> [PDH-verify] — 重要指摘なし、または対応済み
[PDH-verify] -> [PDH-human-review] — 自動検証完了
[PDH-human-review] -> [PDH-close] — ユーザが明示承認
```

## 進捗報告フォーマット

```text
Current Stage:
Stage Status: 未着手 / 進行中 / 完了
Gate Remaining:
Evidence:
Next Stage:
```

## stage 完了ルール

stage完了時に必要なら`[stage label] 概要`形式でcommitし、session中断耐性とhistory追跡性を保つ。

## ticket と note の役割分担

ticket file / note file の実パスは`./ticket.sh start`または`./ticket.sh restore`出力の`ticket:`/`note:`行が示す（互換symlink: `current-ticket.md`/`current-note.md`）。

| file | 役割 | 残す情報 |
|---|---|---|
| ticket file (`ticket:`) | 後世への記録 | Why、AC、Invariants check、確定判断、Out-of-scope、任意のImplementation Notes |
| note file (`note:`) | session間の引継ぎ | Status、実装log、review結果、process check、Discoveries |

## ticket 標準構造

ticketは次の構造で、1 page、約20行以内を目安にする。

```markdown
# Why
ユーザ価値（1〜3行）

# What / Acceptance Criteria
- AC 1: 観察可能な振る舞い

# Architectural Invariants check
product-brief.mdとの整合を1行で宣言

# 確定判断 (Design Decisions)
- 既知の判断と理由

# Out-of-scope
- やらないこと

# Implementation Notes (任意、自主 NG)
- ユーザが明示した関数名またはmodule名levelの事項だけ
```

## AC に書いてよいもの / 書いてはいけないもの

ACには観察可能なproduct動作を書く。 review結果やtest pass等のprocess要件は書かず、noteのchecklistへ置く。

**ACの読み手はticketを承認する人である。**実装するagentではない。読めるACとは、承認者がその1行だけを読んで「満たされた場面」を頭の中で再生できるACをいう。要るのは3つ — 登場人物、その人がする操作、その人が見る結果。

判定は1問で行う。**「承認者がこれを自分で確かめるとしたら、何をするか。」**答えが書けなければ、そのACは承認者の言葉になっていない。実装の言葉で決めた中身は`確定判断 (Design Decisions)`へ移し、ACには場面を残す。**約束の中身を減らさない。読み手だけを変える。**

⚠ 取り違えやすい3点。

- **内部識別子は禁止語ではない。**悪いのは`PATCH /api/…`がACに出ることではなく、それが約束の本体になっていること。「管理者が設定を保存できる（実装上は`PATCH /api/model-aliases/{alias}`）」は読める
- **平易な言葉への言い換えではない。**読み手は上級エンジニアである。避けるのは技術的な内容ではなく、承認者に板やticketの外を見に行かせること
- **非退行のACは「できるようになる」型に収まらない。**「既存のUTF-8 CSVは、これまでと同じ結果で取り込める」は誰も新しく何かをできるようにしない。非退行では登場人物だけを必須とし、「いままでできなかった」を求めない

書き直しの例。

- `GET /dispatch/namespaces/{ns}/scripts` の一覧に居るか → 新しいアプリを作れる。新規に作ったアプリの初回deployが成功する
- `settings` による存在判定を撤去する → deployが拒否されたら、そのまま作り直せる。拒否されたdeployが、アプリのデータの置き場所・前の版へ戻す手段・稼働状態のどれも壊さない
- orphanの印を付けるのはPUT成功後にする → 状態を判断できないときは、送らずに止まる。止まったときは何が分からなかったのかが読んで分かる
- 行数・バイトサイズの上限を超えるCSVは413/422で弾く → 大きすぎるCSVを上げた人が、取り込まれないことと理由をその場で知る
- 回帰テストを追加 → ACではない。process要件なのでnoteのchecklistへ移す

**この書き直しを後工程へ先送りしない。**判断ボード・human reviewの材料づくり・close報告で言い換えて辻褄を合わせると、ticketのACは実装の言葉のまま溜まり、boardを作らない場面では読めないままになる。

## Implementation Notes は自主的に書かない

Implementation Notesはユーザが明示または会話で言及した事項だけを、関数名またはmodule名levelまで書く。 Design Decisionや実装詳細を自主的に書かない。実装担当は空でも実装する。

## note のセクション構成

| section | 記録内容 |
|---|---|
| Status | 冒頭に現在stageとtimestamp |
| PDH-ticket-review | Why、AC、Design Decisions、Out-of-scope、Dependencies、Invariants。AC承認は得ない |
| PDH-implement | commit、実装中の判断、scope判断 |
| PDH-review | attempt別のreview結果と対応 |
| PDH-review > Findings (PDH-review-N) | findingの台帳。検出時点で1行追加し、判定列（採用 / 起票 / 記録のみ / 棄却）と理由を埋める |
| PDH-verify | process checklistと証拠 |
| Technical reference 更新 | この ticketの差分に因果がある追記・上書き、または「該当なし」と理由 |
| PDH-human-review | review依頼、確認手順、承認または差し戻し |
| Discoveries | 想定外の事実 |

section構成は`.ticket-config.yaml`の`note_content`で決まる。ここに無いsectionを前提にしない。 `PDH-ticket-human-review`のAC承認は専用sectionを持たず、Statusと`PDH-ticket-review`へ記録する。 attempt 2以降は`### Findings (PDH-review-2)`のように見出しを自分で追加する。

次を守る。

- Status行を冒頭に維持し、timestampを必須とする
- 空sectionにはskip理由を1行書く
- gate未達のまま次stage名へStatusを進めない
- `PDH-human-review`承認前はcloseせず、自動工程終了時はhuman-review待ちと記録する
- session終了時に作業途中なら、現在状態と次actionをnoteへ残す
- 検証checkは対象SHA、実command、実outputをnoteへ貼ってからcheckする。影響する後続commit後は取り直し、証拠なしまたは部分実行で全suiteをcheckしない
- workerのPASSまたは実機確認主張は、SHAと再現可能証拠がなければ`NOT VERIFIED`とする。PMが証拠取得または同経路を再実行し、repo実状態と不一致ならworker報告を差し戻す

## 責務境界（artifact 観点）

| layer | 意思決定者の領域 | 実装担当の領域 |
|---|---|---|
| Product Brief | ユーザの意思 | なし |
| Ticket | Why、AC、Invariants check、確定判断、Out-of-scope、任意のImplementation Notes | 実code details |
| Subagentまたは実行指示 | 目的、背景、AC、担当範囲、確定判断 | how-to、実装手順、command |

## 成果物セルフチェック（内容品質チェック）

ticketまたは実行指示の提出前に次をcheckする。

- `product-brief.md`のArchitectural Invariantsと整合するか
- signature、行番号、内部flow、snapshot、code snippet等の実装詳細が混入していないか
- ACが観察可能な振る舞いだけか
- ACが承認者の読める言葉か（その1行を承認者が自分で確かめるとしたら何をするか、が書けるか）
- 実行指示にhow-toが混入していないか
- AC、実装、ticket候補に投機的拡張または将来要件向け設計がないか

1つでも該当すれば抽象化する。
