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

## 読み手プロファイル〔board を書く前と、発行前に読む〕

**既定は [reader-profile.md](reader-profile.md)。**«承認者が何で止まり、何なら決められるか»（媒体・語彙・強調・選択肢の出し方・像の要否）を、base.md の一般規則の上に具体化する。項目は **【名前】** で参照する。

- **`AGENTS.local.md` の「読み手プロファイル」節に **【項目名】** があれば、その項目だけ既定を使わずそちらに従う**（項目単位。書かれていない項目は既定のまま）。
- **reader-profile.md の「発行前の自己検査」は、上書き後の条件に対して当てる**（既定の条件ではなく、その board に効いている profile に対して）。
- **上書きできるのは reader-profile.md の項目だけ。**承認・証拠・機微情報・不可逆操作の規則（base.md / [risk-overlay.md](risk-overlay.md)）は読み手の好みで上書きしない。
- 承認者ごとに別のプロファイルがあるなら、その board の承認者のものを使う。

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

作成時は必要な手順を Codex の plan に登録し、進行と残作業を更新する。セッションをまたぐ未完了事項は note に残す。

## 戻り方

手順 8 から戻れるのは **«決められなくする» 指摘と形の崩れだけ**で、戻り先は欠陥を持ち込んだ手順である。修正後は [final-check.md](final-check.md) の範囲で、元の指摘と影響箇所の解消を確認する。構成を組み直した場合は、影響する手順を未完了へ戻して確認する。

手順 10 で回答を反映したら、**追加質問・修正指示・未回答が残るなら**、直した ticket に合わせて board を直し、8〜9 を再走して**同じ発行先へ再発行する**（新しい URL・新しいファイルを作らない）。**全判断が決まったら gate 通過**で、ticket は次の stage へ進む。

## 別の worker に書かせるとき

**守るのは «board を書く worker が、使える class 名と必要な材料を持ったうえで書き始めること» である。**書き手を別の worker にするか、どの engine に書かせるかは project ルールが決める。この節は、委譲すると決めたときの渡し方だけを定める。

**渡すもの**: この skill の分冊（`SKILL.md` / `base.md` / gate 側の `ticket-gate.md` または `close-gate.md` / `final-check.md` / `reader-profile.md` / `risk-overlay.md` / close 前 gate では `ship-risk.md` / HTML なら `html.md`）、project ルールのうち文章の規則、対象の ticket と note、repo のパス。**書かせるのは `<main class="board">` の断片だけ**にし、外枠（`build.sh` が付ける `<head>` と kit）と発行は委譲した側が行う。

- ⚠ **渡すファイルが実在するかを、渡す前に `ls` で確かめる。**無いファイルを指された worker は、黙って «無い» まま書き進める
- ⚠ **worker は会話の経緯を持たない。**ticket と note に無いもの（ユーザとのやりとり・実測・前の ticket との関係）は worker には書けないので、委譲した側が後から足す
- ⚠ **採否と事実の照合は委譲した側が持つ。**worker の出力をそのまま発行しない

**prompt の組み方**は、委譲先 engine の公式の prompt ガイドに従う。とくに次を守る。

- **長文（分冊・ticket・note）は prompt の先頭に、指示は末尾に置く**
- **使ってよい class 名の一覧を、`build.sh` が実際に積む CSS から機械で作って渡す。**渡さないと worker は class 名を発明し、当たる CSS が無いまま素の HTML として描画される（`check-static.sh` の «未定義 class» は、書き終えた後にしか捕まえない）。⚠ **`cat kit/*.css` で作らない** — 積む CSS は layout で違う（`document` は `deck.css` と `view.css` を積まない）。⚠ **手で書いた一覧は古くなる**
  ```bash
  cd <この skill のディレクトリ>
  printf '<main class="board" data-board-id="x"></main>\n' > /tmp/empty-board.html
  # --layout は、その board を組むときに渡す値と同じにする
  css=$(sh tools/build.sh --body /tmp/empty-board.html --out /tmp/empty-board.out.html --layout combined 2>&1 >/dev/null \
    | sed -n 's/^inline: //p' | tr ',' '\n' | tr -d ' ' | grep '\.css$')
  for f in $css; do cat "kit/$f"; done | grep -oE '\.[a-zA-Z][a-zA-Z0-9_-]*' | sort -u
  ```
- **例を `<example>` で 2〜5 個入れる**
- **部品は «場面 → 部品» の向きで書く**（「時系列を見せたい → `ul.tl`」）。class 名の側から並べても選ばれない
- **文体の指示より、構造（何をどの順で書くか・節の並び）を指定する。**そのほうが出力が安定する
- **«してよい» と書かず、«必ず付ける» と義務で書く。**許可の形の指示は無視される。⚠ **上限（「〜は 3 つまで」）を書くと、下限も 0 になる**
- **自由度を開く指示（「必要なら図を描いてよい」）を書かない。**出力の揺れが増える
- **決定論で決められるもの（図の寸法・class の有無・回答機構の `data-q`）は prompt に置かず、kit の CSS と `tools/check-static.sh` に任せる**

**prompt を変えたら、同じ prompt を 2 回走らせた結果を両方見る。**実行ごとのブレが prompt の差より大きいことがあり、1 回ずつの比較は結論にならない。

**発行の前に、強調の数を数える**（`grep -o '<strong>' board.html | wc -l`）。[reader-profile.md](reader-profile.md)【強調は密度×長さ】に照らして多ければ、worker に書き直させる。

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/codex/skills/pdh-decision-board/SKILL.md
