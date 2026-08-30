---
name: pdh-decision-board
description: PDH の human gate で、承認者が追加調査なしに承認または指示できる判断ボード（Completed Staff Work）を作る。実装前 gate（PDH-ticket-human-review。AC と未確定の判断を承認する）と close 前 gate（PDH-human-review。達成が想定どおりかを見て close を承認する）の両方を扱う。「判断ボード」「board を作って」「AC 承認の材料」「close 前のレビュー材料」で使う。
allowed-tools: Bash(tools/build.sh:*) Bash(tools/check-static.sh:*)
---

# pdh-decision-board

**判断ボードとは、承認者に留保された判断について coding agent が作成する Completed Staff Work である。**完成条件は 2 つあり、対になっている。**片方だけでは完成ではない。**

> **① 承認者が、書き手自身でできたはずの追加調査をせずに、求められた判断を下せる。**
> **② 承認者が、その判断に使わないものを読まされない。**

## 唯一の検査

board のすべての段落に、次の 1 問を当てる。

> **これは承認者が決めることか、書き手が決められることか。** **書き手が決められることが書いてあれば、書き手が決めてから書き直す。**

## どちらの gate か〔手順 0 の前に決める〕

| note の Status | 読む分冊 | 承認を求めるもの |
|---|---|---|
| `PDH-ticket-human-review` | [base.md](base.md) と [ticket-gate.md](ticket-gate.md) | この Why を、この AC と解き方で解いてよいか |
| `PDH-human-review` | [base.md](base.md) と [close-gate.md](close-gate.md) | この達成で ticket を閉じてよいか |

**[base.md](base.md) は必ず全文読む。**gate 側の分冊は base への差分であり、**同じ主題について両方に規則があるときは gate 側が優先する。**

## 手順と、そのとき読む分冊

⚠ **各手順に入るときに、その行の分冊を読み直す。**この router は会話が圧縮されても残るが、**分冊は残らない。**「前に読んだ」で進めない。

| 手順 | 読むもの |
|---|---|
| 0 目標確認と risk overlay | [base.md](base.md)「board を作る前に」「risk overlay を当てるか」／ 当たれば [risk-overlay.md](risk-overlay.md) ／ close 前 gate は [ship-risk.md](ship-risk.md) の判定も |
| 1 洗い出しと添付の確認 | gate 側の分冊の洗い出し節、[base.md](base.md)「合意済みの画像」 |
| 2 判断の分類 | [base.md](base.md)「判断の分類」 |
| 3 判断を数えてモードを選ぶ | [base.md](base.md)「判断の数でモードを選ぶ」 |
| 4 主線を組む | gate 側の主線固定部、[base.md](base.md)「主線の構成」「決定サマリー」「Acceptance Criteria の書き方」 |
| 5 推奨と選択肢を書く | [base.md](base.md)「判断カードの型」、gate 側の「選択肢と ticket を一対一にする」 |
| 6 全体を推敲する | [base.md](base.md)「読み手の仕事を増やさない」「数と断定の扱い」「読み手を決める」 |
| 7 媒体を選んで組み上げる | [base.md](base.md)「媒体を選ぶ」と、選んだ媒体の [render-html-common.md](render-html-common.md) / [create-doc.md](create-doc.md) / [create-slides.md](create-slides.md) |
| 8 完成検査 | [final-check.md](final-check.md) |
| 9 発行 | [base.md](base.md)「発行」 |
| 10 回答を ticket へ反映 | [answer-form.md](answer-form.md) |

**作り始めるときに、手順 0〜10 を 1 手順 1 項目で作業一覧へ載せる**（一覧の作り方は `PDH-AGENTS.md`「Execution Model」）。**飛ばした手順がその場で見え、前の手順へ戻ったときにどこからやり直すかが残る。**

## 戻り方

手順 8 から戻れるのは **«決められなくする» 指摘と形の崩れだけ**で、戻り先は欠陥を持ち込んだ手順である。⚠ **戻って直しても検査（手順 8）は回し直さない** — reviewer は 1 回だけである。**例外は構成を組み直したときだけ**で、そのときは 4〜8 を未完了へ戻して 8 をもう 1 回だけ回す。

⚠ **ticket を持たない運用で board を使うなら、board を作る前に反映先を決める**（承認内容を 1 件ずつ消し込める場所）。**板は承認の記録ではない** — 板に書かれたまま転記されなかった承認は、実装されたかを誰も確かめられない。

手順 10 で回答を反映したら、終わり方は 2 つ。**追加質問・修正指示・未回答が残るなら**、直した ticket に合わせて board を直し、8〜9 を再走して**同じ発行先へ再発行する**（新しい URL・新しいファイルを作らない）。**全判断が決まったら gate 通過**で、ticket は次の stage へ進む。

## 規則を撤去する条件

規則は事故のたびに増える。**減る条件を持たない規則集は、必ず読めなくなる。**⚠ **規則を足す前に、この 3 つに当たる既存の規則がないかを先に見る。**

- **別の仕組みが同じことを保証するようになった**（kit の CSS や機械の検査で起きなくしたなら、手順の側は消す）
- **その規則が守る対象を 1 文で言えない**
- **同じ主題の節が他にある**（足すのではなく統合する）

削除したら、その規則を根拠にしていた手順・検査・reviewer の問いも一緒に消す。**片方だけ残すと、根拠の無い手順になる。**

## 組み立てと検査の道具

[kit/README.md](kit/README.md)（CSS・JS・見本）と [tools/README.md](tools/README.md)（組み立てと静的検査）にある。HTML を選んだときだけ読む。

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-decision-board/SKILL.md
