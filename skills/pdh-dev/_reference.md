# PDH Dev — リファレンス

## 用語

- stage label：`PDH-open`、`PDH-ticket-review`、`PDH-ticket-human-review`、`PDH-implement`、`PDH-review`、`PDH-verify`、`PDH-human-review`、`PDH-close`の8つだけ。安定したchecklist keyとして扱う
- review attempt label：`PDH-review-1`、`PDH-review-2`等。top-level stageではなく`PDH-review`配下のlog
- gate：次stageへ進む完了条件。`Gate Remaining`が空でなければstage未完了
- AC：観察可能な振る舞いとして書くAcceptance Criteria
- Architectural Invariants：`product-brief.md`に明記された不変則を正とする

## stage 遷移の宣言

stage遷移と差し戻しは毎回短く宣言する。
省略または暗黙の遷移を禁止する。

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

| file | 役割 | 残す情報 |
|---|---|---|
| `current-ticket.md` | 後世への記録 | Why、AC、Invariants check、確定判断、Out-of-scope、任意のImplementation Notes |
| `current-note.md` | session間の引継ぎ | Status、実装log、review結果、process check、Discoveries |

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

ACには観察可能なproduct動作を書く。
review結果やtest pass等のprocess要件は書かず、noteのchecklistへ置く。

## Implementation Notes は自主的に書かない

Implementation Notesはユーザが明示または会話で言及した事項だけを、関数名またはmodule名levelまで書く。
Design Decisionや実装詳細を自主的に書かない。
実装担当は空でも実装する。

## note のセクション構成

| section | 記録内容 |
|---|---|
| Status | 冒頭に現在stageとtimestamp |
| PDH-ticket-review | Why、AC、Design Decisions、Out-of-scope、Dependencies、Invariants。AC承認は得ない |
| PDH-ticket-human-review | 修正点、概要、達成内容、AC、Out-of-scope、判断点、AC承認 |
| PDH-implement | commit、実装中の判断、scope判断 |
| PDH-review | attempt別のreview、finding、対応 |
| PDH-verify | process checklistと証拠 |
| PDH-human-review | review依頼、確認手順、承認または差し戻し |
| Discoveries | 想定外の事実 |

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
- 実行指示にhow-toが混入していないか
- AC、実装、ticket候補に投機的拡張または将来要件向け設計がないか

1つでも該当すれば抽象化する。
