---
name: pdh-decision-board
description: PDH の承認の PDH-stage（`PDH-ticket-human-review` / `PDH-human-review`）と、skill pdh-review がユーザへ持ち込むと定めた判断をユーザに決めてもらうときに読む。会話で質問を出す前に読む。
allowed-tools: Bash(tools/build.sh:*) Bash(tools/check-static.sh:*) Bash(python3 tools/review-copy.py:*) Bash(tools/selftest.sh:*)
---

# pdh-decision-board

decision-board は、承認者に留保された判断について、decision-board の書き手が «承認者が追加の調査なしで決められる材料» としてまとめたものである。完成条件は 2 つあり、片方だけでは完成ではない。

> **① 承認者が、decision-board の書き手自身でできたはずの追加調査をせずに、求められた判断を下せる。**
> **② 承認者が、その判断に使わないものを読まされない。**

## 道具の依存

`tools/review-copy.py` と `tools/selftest.sh` には `python3` が必要である。Python は標準ライブラリだけを使い、追加の package は不要。画像抽出の恒久テストは `tools/review-copy-test.py` にあり、skill 単独で `bash tools/selftest.sh` から実行できる。

## decision-board を作る場面

**この規則の目的: ticket と close の判断に、後から引ける根拠が残ること。**会話に材料を並べて質問だけを出すと、何を根拠に決めたかが会話の中にしか残らない。

- 承認の PDH-stage の 2 つ（実装前・close 前）
- `[SKILLS_PATH]/pdh-review/SKILL.md` がユーザへ持ち込むと定めた判断（修正が永続の state や公開 surface を増やす・AC が Why に届かない・同じ種類の Critical が 2 巡で再発する・2 巡目で修正が Critical / Major を持ち込み、設計の見直しの結論を添えて渡す）と、`[SKILLS_PATH]/pdh-pm/SKILL.md`「気づいたバグは同じ ticket で直す」がユーザに聞くと定めた判断

finding の処置は PM が選ぶ（`[SKILLS_PATH]/pdh-review/SKILL.md`「処置の判断」）。finding ごとに decision-board を作らない。選んだ処置は PDH-human-review の decision-board の «直さなかった finding» で承認者に見せる（`close-gate.md`）。

**判断が 1 件でも、選択肢が単純に見えても decision-board を作る。**判断の無い decision-board を短くしてよいのは `ticket-gate.md`「decision-board を短くしてよい条件〔手順 0〕」の 1 つだけで、そのときも AC と Out-of-scope の提示・明示の回答・`AC-approved:` の記録は省かない。ほかの理由（判断が少ない・急ぐ）では省かない。

## 唯一の検査

decision-board のすべての段落に、次の 1 問を当てる。

> **これは承認者が決めることか、decision-board の書き手が決められることか。decision-board の書き手が決められることが書いてあれば、decision-board の書き手が決めてから書き直す。**

## 読み手プロファイル〔decision-board を書く前と、発行前に読む〕

**既定は [reader-profile.md](reader-profile.md)。**«承認者が何で止まり、何なら決められるか»（媒体・語彙・強調・選択肢の出し方・画面写真か出力の実例の要否）を、base.md の一般規則の上に具体化する。項目は **【名前】** で参照する。

上書きの条件・範囲と承認者ごとの選び方は [reader-profile.md](reader-profile.md) の冒頭に従う。
**reader-profile.md の「発行前の自己検査」は、上書き後の条件に対して当てる**（既定の条件ではなく、その decision-board に効いている profile に対して）。

## どちらの承認の PDH-stage か〔手順 0 の前に決める〕

| note の Status | 読むファイル | 承認を求めるもの |
|---|---|---|
| `PDH-ticket-human-review` | [base.md](base.md) と [ticket-gate.md](ticket-gate.md) | この Why を、この AC と作り方の判断で解いてよいか |
| `PDH-human-review` | [base.md](base.md) と [close-gate.md](close-gate.md) | この達成で ticket を閉じてよいか |

[base.md](base.md) は全文読む。同じ主題について両方に規則があるときは、PDH-stage 側のファイル（`ticket-gate.md` か `close-gate.md`）に従う。

## 手順と、そのとき読むファイル

**各手順に入るときに、その行のファイルを読み直す。**「前に読んだ」で進めない。

| 手順 | 読むもの |
|---|---|
| 0 目標確認と、危険が大きいときの追加規則を当てるかの判定 | [base.md](base.md)「decision-board を作る前に」「危険が大きいときの追加規則を当てるか」／ 当たれば [risk-overlay.md](risk-overlay.md) ／ PDH-human-review は [ship-risk.md](ship-risk.md) の判定も |
| 1 洗い出しと添付の確認 | PDH-stage 側のファイルの洗い出し節、[base.md](base.md)「合意済みの画像」 |
| 2 判断の分類 | [base.md](base.md)「判断の分類」 |
| 3 判断を数えてモードを選ぶ | [base.md](base.md)「判断の数でモードを選ぶ」 |
| 4 承認者が必ず読む本文を組む | PDH-stage 側のファイルが定める本文の固定部、[base.md](base.md)「承認者が必ず読む本文の構成」「決定サマリー」「Acceptance Criteria の書き方」 |
| 5 推奨と選択肢を書く | [base.md](base.md)「判断カードの型」、PDH-stage 側のファイルの「選択肢と ticket を一対一にする」 |
| 6 全体を推敲する | [base.md](base.md)「読み手の仕事を増やさない」「数と断定の扱い」「読み手を決める」 |
| 7 媒体を選んで組み上げる | [base.md](base.md)「媒体を選ぶ」、HTML なら [html.md](html.md) |
| 8 完成検査 | [final-check.md](final-check.md) |
| 9 発行 | [base.md](base.md)「発行」 |
| 10 回答を ticket へ反映 | PDH-stage 側のファイルの「選択肢と ticket を一対一にする」 |

**作り始めるときに、手順 0〜10 を engine の task 管理機構へ 1 手順 1 項目で登録し、手順を終えるたびに完了へ更新する**（Claude Code は task list、codex は plan。機構の無い engine では note に `- [ ] 手順 0 …` を書いて消し込む）。

## 戻り方

手順 8 から戻れるのは **«決められなくする» finding と形の崩れだけ**で、戻り先は欠陥を持ち込んだ手順である。直したら、手順 8 で [final-check.md](final-check.md)「出す条件 — 修正を同じ reviewer に戻す」に従い、同じ reviewer に指摘の解消を確かめさせる。構成を組み直したときは、影響する手順も未完了へ戻す。

手順 10 で回答を反映したら、**追加質問・修正指示・未回答が残るなら**、直した ticket に合わせて decision-board を直し、8〜9 を再走して**同じ発行先へ再発行する**（新しい URL・新しいファイルを作らない）。**全判断が決まったら承認の PDH-stage を通過**し、ticket は次の PDH-stage へ進む。

## 別の worker に書かせるとき

**この規則の目的: decision-board を書く worker が、使える class 名と必要な材料を手にして書き始められること。**decision-board の書き手を別の worker にするか、どの engine に書かせるかは `CLAUDE.md`（codex では `AGENTS.md`）が決める。この節は、委譲すると決めたときの渡し方だけを定める。

**渡すもの**: この skill の各ファイル（`SKILL.md` / `base.md` / PDH-stage 側の `ticket-gate.md` または `close-gate.md` / `final-check.md` / `reader-profile.md` / `risk-overlay.md` / PDH-human-review では `ship-risk.md` / HTML なら `html.md`）、`CLAUDE.md`（codex では `AGENTS.md`）のうち文章の規則、対象の ticket と note、repo のパス。HTML のときは、**書かせるのは `<main class="board">` の断片だけ**にし、外枠（`build.sh` が付ける `<head>` と kit）と発行は委譲した側が行う。Markdown のとき（`base.md`「媒体を選ぶ」）は `html.md` と class 名の一覧を渡さず、decision-board の Markdown のファイルを丸ごと書かせる。発行は同じく委譲した側が行う。

- HTML の本文の保存先と、使う画像それぞれの実在する絶対パス・本文からの相対パスを prompt に書く。委譲した側がその配置で本文を保存して build し、全画像が元のファイルと一致することを確かめる。worker は build と仮画像への置換を行わない。この照合は手順 8 の形の検査で行い、画像の内容の一致は機械では数えられないため委譲した側が判断する
- ⚠ **渡すファイルが実在するかを、渡す前に `ls` で確かめる。**無いファイルを指された worker は、黙って «無い» まま書き進める
- ⚠ **worker は会話の経緯を持たない。**ticket と note に無いもの（ユーザとのやりとり・実測・前の ticket との関係）は worker には書けないので、委譲した側が後から足す
- ⚠ **採否と事実の照合は委譲した側が持つ。**worker の出力をそのまま発行しない

**prompt の組み方**は、委譲先 engine の公式の prompt ガイドに従う（Claude なら https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices）。とくに次を守る。

- **長文（この skill の各ファイル・ticket・note）は prompt の先頭に、指示は末尾に置く**
- HTML のときは、**使ってよい class 名の一覧を、`build.sh` が実際に積む CSS から機械で作って渡す。**渡さないと worker は class 名を発明し、当たる CSS が無いまま素の HTML として描画される（`check-static.sh` の «未定義 class» は、書き終えた後にしか捕まえない）。⚠ **`cat kit/*.css` で作らない** — 積む CSS は layout で違う（`document` は `deck.css` と `view.css` を積まない）。⚠ **手で書いた一覧は古くなる**
  ```bash
  cd <この skill のディレクトリ>
  printf '<main class="board" data-board-id="x"></main>\n' > /tmp/empty-board.html
  # --layout は、その decision-board を組むときに渡す値と同じにする
  css=$(sh tools/build.sh --body /tmp/empty-board.html --out /tmp/empty-board.out.html --layout combined 2>&1 >/dev/null \
    | sed -n 's/^inline: //p' | tr ',' '\n' | tr -d ' ' | grep '\.css$')
  for f in $css; do cat "kit/$f"; done | grep -oE '\.[a-zA-Z][a-zA-Z0-9_-]*' | sort -u
  ```
- **例を `<example>` で 2〜5 個入れる**
- **部品は «場面 → 部品» の向きで書く**（「時系列を見せたい → `ul.tl`」）。class 名の側から並べても選ばれない
- **文体の指示より、構造（何をどの順で書くか・節の並び）を指定する。**そのほうが出力が安定する
- **«してよい» と書かず、«必ず付ける» と義務で書く。**許可の形の指示は無視される。⚠ **上限（「〜は 3 つまで」）を書くと、下限も 0 になる**
- **自由度を開く指示（「必要なら図を描いてよい」）を書かない。**出力の揺れが増える
- **決定論で決められるもの（図の寸法・class の有無・回答 UI（`board.js`）の `data-q`）は prompt に置かず、kit の CSS と `tools/check-static.sh` に任せる**

**prompt を変えたら、同じ prompt を 2 回走らせた結果を両方見る。**実行ごとのブレが prompt の差より大きいことがあり、1 回ずつの比較は結論にならない。

**発行の前に、強調の数を数える**（`grep -o '<strong>' board.html | wc -l`）。[reader-profile.md](reader-profile.md)【強調は密度×長さ】に照らして多ければ、worker に書き直させる。⚠ **Claude の model は太字を多用する傾向がある。**
