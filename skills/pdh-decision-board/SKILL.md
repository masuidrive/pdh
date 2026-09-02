---
name: pdh-decision-board
description: PDH の human gate（`PDH-ticket-human-review` / `PDH-human-review`）で承認者へ渡す判断ボードを作るときに読む。
allowed-tools: Bash(tools/build.sh:*) Bash(tools/check-static.sh:*)
---

# pdh-decision-board

判断ボードは、承認者に留保された判断について書き手が作る Completed Staff Work である。完成条件は 2 つあり、片方だけでは完成ではない。

> **① 承認者が、書き手自身でできたはずの追加調査をせずに、求められた判断を下せる。**
> **② 承認者が、その判断に使わないものを読まされない。**

## 唯一の検査

board のすべての段落に、次の 1 問を当てる。

> **これは承認者が決めることか、書き手が決められることか。書き手が決められることが書いてあれば、書き手が決めてから書き直す。**

## どちらの gate か〔手順 0 の前に決める〕

| note の Status | 読む分冊 | 承認を求めるもの |
|---|---|---|
| `PDH-ticket-human-review` | [base.md](base.md) と [ticket-gate.md](ticket-gate.md) | この Why を、この AC と解き方で解いてよいか |
| `PDH-human-review` | [base.md](base.md) と [close-gate.md](close-gate.md) | この達成で ticket を閉じてよいか |

[base.md](base.md) は全文読む。同じ主題について両方に規則があるときは gate 側に従う。

## 手順と、そのとき読む分冊

**各手順に入るときに、その行の分冊を読み直す。**「前に読んだ」で進めない。

| 手順 | 読むもの |
|---|---|
| 0 目標確認と overlay 判定 | [base.md](base.md)「board を作る前に」「risk overlay を当てるか」／ 当たれば [risk-overlay.md](risk-overlay.md) ／ close 前 gate は [ship-risk.md](ship-risk.md) の判定も |
| 1 洗い出しと添付の確認 | gate 側の分冊の洗い出し節、[base.md](base.md)「合意済みの画像」 |
| 2 判断の分類 | [base.md](base.md)「判断の分類」 |
| 3 判断を数えてモードを選ぶ | [base.md](base.md)「判断の数でモードを選ぶ」 |
| 4 主線を組む | gate 側の主線固定部、[base.md](base.md)「主線の構成」「決定サマリー」「Acceptance Criteria の書き方」 |
| 5 推奨と選択肢を書く | [base.md](base.md)「判断カードの型」、gate 側の「選択肢と ticket を一対一にする」 |
| 6 全体を推敲する | [base.md](base.md)「読み手の仕事を増やさない」「数と断定の扱い」「読み手を決める」 |
| 7 媒体を選んで組み上げる | [base.md](base.md)「媒体を選ぶ」、HTML なら [html.md](html.md) |
| 8 完成検査 | [final-check.md](final-check.md) |
| 9 発行 | [base.md](base.md)「発行」 |
| 10 回答を ticket へ反映 | gate 側の「選択肢と ticket を一対一にする」 |

**作り始めるときに、手順 0〜10 を engine の task 管理機構へ 1 手順 1 項目で登録し、手順を終えるたびに完了へ更新する**（Claude Code は task list、codex は plan。機構の無い engine では note に `- [ ] 手順 0 …` を書いて消し込む）。

## 戻り方

手順 8 から戻れるのは **«決められなくする» 指摘と形の崩れだけ**で、戻り先は欠陥を持ち込んだ手順である。**戻って直しても検査（手順 8）は回し直さない。**構成を組み直したときだけ、4〜8 を未完了へ戻して 8 をもう 1 回だけ回す。

手順 10 で回答を反映したら、**追加質問・修正指示・未回答が残るなら**、直した ticket に合わせて board を直し、8〜9 を再走して**同じ発行先へ再発行する**（新しい URL・新しいファイルを作らない）。**全判断が決まったら gate 通過**で、ticket は次の stage へ進む。

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-decision-board/SKILL.md
