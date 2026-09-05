# HTML の board を組む〔手順 7〕

HTML 文書または 2 軸デッキを選んだときだけ読む。

## kit を埋め込む

`kit/tokens.css` + `kit/board.css`（デッキはさらに `kit/deck.css`）を `<style>` へ、`kit/page.js` + `kit/board.js`（デッキは `kit/deck.js` + `kit/board.js`）を body の後の `<script>` へ、この順でインラインに埋め込む（`page.js` は目次・現在地。目次を置かない board では省いてよい）。**発行先は外部への通信を遮断するため、CSS / JS / 画像は link や CDN ではなく 1 枚の HTML へ埋める。**

**必ず kit を使うのは回答機構だけである。`board.js` をその場で改変しない** — 足りない機能は «何が足りなかったか» を報告する。**それ以外の見た目の CSS / JS は board ごとに設計して書いてよい。**自分で書く場合は、色・寸法を token の 1 か所で持ち、明るいテーマと暗いテーマの両方で読め、狭い画面で横 overflow が無いようにする（**色の定義を media query の中«だけ»に置かない**）。

**選択の見た目、選択中の 1 枚だけが塗られること、localStorage への保存と復元、コピーの 3 段、送信ボタンの出し分け、目次の ✓、進捗バッジの移動、明暗テーマ、行頭禁則、面の高さと自動縮小 — どれも kit が保証する。板を書く人は class と `data-*` を書くだけで、そうなっているかを確かめない。**

## 外枠

```html
<main class="board" lang="ja" data-board-id="<ticket-or-board-id>" data-answer-title="…">
```

デッキは `<div class="deck" id="deck" lang="ja" data-board-id="…" data-answer-title="…">`。**`data-board-id` は 1 ページに 1 つ。回答フォームの部品（進捗・貼り戻し欄・コピーボタン）は全部この中に置く** — `board.js` は外枠の中しか見ない。デッキの地図 `<nav class="map" id="map">`、4 つの `.edge`、原寸 overlay は deck の**外**に置く。

## 回答フォーム

**`N = 0`（承認だけ）の board にも、選ぶ操作とコメント欄を置く。**承認者が返す答えは «承認する / 承認しない» の 2 つだからである。置くものは 4 つ。

- **押せる選択肢** — `N = 0` なら「承認する」と「承認しない（修正指示・差し戻し）」。**説明のカードそのものを押せるようにする**（別のボタン行を足すと、同じ選択肢が 2 回出る）。
- **コメント欄。**承認しない場合は、ここに書かれた内容が指示の本体になる。
- **貼り戻す文が生成される欄**と、**コピーボタン。**空の `<textarea>` を置くだけにしない。
- **未選択のときは `（未選択）`** と出す。

`N = 0` では、判断ごとの集計・進捗の内訳・複数回答の同期を置かない。`N >= 1` では、各判断に自由記述欄、回答済み件数、判断ごとの完了状態、未回答を明示した貼り戻し文を置く。

**選ぶ操作は、選ぶ材料の隣に置く。末尾にまとめてはならない。**末尾に置くのは貼り戻し欄とコピーボタンだけとし、**承認の回答欄と同じ面に置く。**末尾で選択肢を再表示してよいが、それは同じ `data-q` による «再表示» である。

**目次を置く board では、アンカーの宛先を «節を包む要素»（`<section id>`）にする。**見出しに `id` を置くと選択肢がその中に入らず、**判断のある節が «判断なし» に見える。**

### DOM 契約

同じ論理判断に属する要素は、表示場所が違っても同じ `data-q` を持つ。判断 ID は意味のある安定名にする。**カードには `data-label` を必ず書く**（無いと貼り戻し文にカード本文が丸ごと入る）。

```html
<!-- 選択肢は «説明のカードそのもの»。data-label が貼り戻し文に入る短い名前。 -->
<div class="card rec answer-choice" role="button" tabindex="0" aria-pressed="false"
     data-q="scope" data-value="recommended" data-label="A. 推奨を承認する（推奨）">
  <h4><span class="tag rec">推奨</span>A. 推奨を承認する</h4>
  … 軸と弱点 …
</div>
<div class="card answer-choice" role="button" tabindex="0" aria-pressed="false"
     data-q="scope" data-value="alternative" data-label="B. 別案を指示する">…</div>

<section class="answer-set" data-q="scope" data-title="判断 scope の見出し">
  <textarea class="answer-note" data-q="scope" aria-label="判断 scope の補足"></textarea>
</section>

<a class="answer-jump" href="#answer-summary" data-scroll-target="answer-summary">回答欄へ進む</a>

<aside class="answer-progress" aria-live="polite">
  <span data-progress-count>回答 0 / 1</span>
  <span data-progress-dots aria-hidden="true">○</span>
</aside>

<section id="answer-summary">
  <textarea data-answer-output readonly></textarea>
  <button type="button" data-copy-answer>回答をコピー</button>
  <p data-copy-status role="status"></p>
</section>
```

## AC 原文と本文参照

board 本文が AC に触れる箇所の直下で、対応する原文を開けるようにする。**末尾に原文をまとめない。**AC 一覧は `<details class="acx">`、本文中の AC 参照は `<button popovertarget>` と `<span popover>` を使う（`<details>` は段落の中へ置かない）。popover 非対応環境では本文を壊さず、参照が開かないだけにする。`AC6〜AC9` のような範囲は 1 つの参照にまとめる。**番号のない AC を複製しない。**

## 共有部品

CSS は `kit/board.css` にある。**色・枠を style 属性で足さない** — 意味は class が持つ。`ol.steps`（順番が意味を持つ列挙。順序が無い列挙には使わない）、`ul.tl`（時系列。1 行 = 事実 1 つ、日付必須）、`blockquote.quote`（報告・発言は要約で潰さず原文で引用。出典必須）、`figure.fig`（画像・SVG・mermaid の枠。caption に「何を見てほしいか」を必ず書く）、`details.fold`（根拠の詳細を 1 手で開く畳み。**summary は結論そのものを書く**）、目次（節が 5 つを超える board に置く）。

**`.table-wrap.compare` は軸を固定して案を横に比べる。**軸の 1 本目は «ゴールへの効き»（Why / AC の言葉で）、続けて「利用者から見て / コスト / 取り返し」。セルは 1 文まで、3 案まで（4 案以上は判断カードの縦積みへ）。推奨列のセル全部に `class="rec"`。

**表は、読み手が集合・対応・差し引きを数え直す場合だけ使う。**独立項目を並べるだけなら段落かカードにする。**横 overflow は `.table-wrap` の中だけで受け、ページ本体を横に動かさない。**

## 2 軸デッキを選んだとき

**列・面の id は書かない** — `kit/deck.js` が DOM 順で採番する。列は `<div class="deck-col">`、面は `<section class="p"><div class="in">…`。**横 = 決めるために必要な主線、縦 = 確かめるための裏付け。**文書で本文に置く情報を横へ、折りたたむ情報を縦へ置く。

- **回答は詳細ではない。選択肢とコメント欄は、その判断の材料を読み終えた «同じ面» に置き、貼り戻し欄とコピーボタンは最後の列の 1 段目（主線）に置く。**縦へ 1 段送らない。
- **最後の列（返す）には裏付けの面を付けない。**裏付けは、それが根拠になっている判断の列へ付ける。
- **1 面ごとに意味を閉じる。**「後で説明する」「前の面」のような位置参照を残さない（`grep -nE '[0-9]+ *面目|前の面|上の表|前述|後述' body.html`）。**収まらない面は、情報を削らずに分ける** — 判断に使う内容なら列を、裏付けなら段を足す。
- **回答フォームの部品は `[data-board-id]` の «中» に置く。**外に置くと、選択は残るのに件数だけ 0 のままになる。原寸 overlay は逆に `.deck` の**外**へ置く。
- 発行前に、**横主線だけで推奨・理由・代償・反証条件・停止条件へ到達でき、選ぶ・書く・コピーするまでが主線の面に揃っているか**を DOM の順序で確かめる。

## 画面写真は押すと原寸で開く

縮小のままでは文言・色・導線が読めないため、サムネイルを `<a class="shot-open" href="#zoom-x">` で包み、原寸の overlay を `<a class="shot-zoom" id="zoom-x" href="#shot-x"><img …></a>` として置く。

- 開く・閉じるは `:target` と `<a href="#…">` だけで成立させる。**script を止めるビューアで開かれても、本文と原寸表示が壊れない**ためである。
- 閉じる手段を必ず置く。overlay のどこを押しても閉じ、元の位置へ戻る。
- 縮小表示と原寸表示は同じ画像・同じ alt にする。

## 確認 URL はホストを書かず、読み手に入れさせる

「自分で確かめる手順」の URL に、ホスト名を書いてはならない。**本文には path だけ**を書き（`data-path`）、board にはホストと port の入力欄を 1 か所置く。入力されたときだけ «開く» リンクと «URL をコピー» が現れ、**未入力・script 停止時は path の文字だけ**が見える。保存できない環境（file:// 等）でも、入力・URL 生成・回答フォームは動き続ける。

## 発行前検査

```bash
tools/build.sh --body body.html --out board.html   # --layout deck でデッキ版
tools/check-static.sh board.html
```

`check-static.sh` はタグの均衡・未定義 class・ページ内参照の宛先・目次アンカー・画像の data URI・回答フォームの属性・`.table-wrap` に包まれていない裸の表を調べる。これに加えて、板ごとに次を確かめる。

1. **本文中の各 AC 参照と範囲参照が、実在する原文の id を指しているか。**`rg -n 'AC[0-9]+|pop-ac[0-9]+-' board.html` で全箇所を出す（`check-static.sh` は AC 番号の付け違いを拾わない）。
2. **開始・終了タグの個数と見出し数を、編集前後で比較する。**正規表現で節を一括置換した場合は、AC 数と回答 `data-q` の数も比較する。**HTML は閉じタグが欠けても描画されるので、目視だけで構造を判断しない。**
3. **選択肢が貼り戻し欄より前に出ているか**を次で確かめる。`末尾のみ` が 1 件でも出たら、その判断の選択肢を材料の直後へ移す。

```bash
awk '{ src = src $0 "\n" }
END {
  # ⚠ 素朴に "data-answer-output" を探すと、CSS の selector に当たる。実体の textarea を探す。
  if (!match(src, /<textarea[^>]*data-answer-output/)) { print "貼り戻し欄が見つからない" > "/dev/stderr"; exit 2 }
  out = RSTART
  rest = src; base = 0
  while (match(rest, /class="answer-set"[^>]*data-q="[^"]+"/)) {
    pos = base + RSTART
    kv = substr(rest, RSTART, RLENGTH); sub(/^.*data-q="/, "", kv); sub(/".*$/, "", kv)
    printf "%s %s\n", (pos < out ? "OK      " : "末尾のみ"), kv
    base = base + RSTART + RLENGTH - 1
    rest = substr(rest, RSTART + RLENGTH)
  }
}' board.html
```

**描画そのもの — 明暗テーマの見え方、狭い画面での折り返し、`<details>` の開閉、sticky `h2`、回答フォームの実操作 — は kit が保証している範囲であり、板ごとには確かめない。**それでも板の見え方を確かめる必要が出たら、`PDH-AGENTS.md`「Browser And Surface Checks」に従う。**確かめずに「確認した」と書かない。**
