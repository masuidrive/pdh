# 回答フォーム — 選ばせて、返せる形にする〔手順 10〕

⚠ **HTML で board を作るなら必ず読む。**`N = 0`（承認だけ）でも回答フォームは要る。**このファイルは «板を書く人が決めること» だけを持つ** — 何を置くか、どこに置くか、DOM の形、発行前の検査。見た目と動きは kit が保証する（下記）。

⚠ **`N = 0`（承認だけ）の board にも、選ぶ操作とコメント欄を置く。**判断が 0 件でも、**承認者が返す答えは «承認する / 承認しない» の 2 つ**だからである。置くものは次の 4 つ。

- **押せる選択肢 2 つ** — 「承認する」と「承認しない（修正指示・差し戻し）」。⚠ **説明のカードそのものを押せるようにする**（別のボタン行を足すと、同じ選択肢が 2 回出て、読み手が短いラベルと本文を照合し直すことになる）。形は下記「DOM 契約」。
- **コメント欄。**承認しない場合は、ここに書かれた内容が指示の本体になる。
- **貼り戻す文が生成される欄**と、**コピーボタン**。⚠ **空の `<textarea>` を置くだけにしない** —選んだ内容が文章になっていなければ、承認者が自分で書くことになる。
- **未選択のときは `（未選択）`** と出す。

**置かないもの**は、判断ごとの集計・進捗の内訳・複数回答の同期である。扱う回答は 1 件だけなので、 `回答 0 / 1` のような名乗りも要らない（置いてもよいが、判断の数と食い違わせない）。

`N >= 1` では、各判断に次を置く。

- **選択肢はその判断の材料を読み終わったその場に置く。**
- 自由記述欄。「その他」を選んだ場合は記述が回答本体になる。
- 最後にある貼り戻し用の回答一覧。同じ選択肢を再表示する場合は同じ状態へ同期する。
- 回答済み件数と、判断ごとの完了状態。
- 未回答を `（未選択）` と明示した貼り戻し文。

### 見た目と動きは kit が保証する

**選択の丸が左でバッジが右にあること、選択中の 1 枚だけが塗られること、localStorage への保存と復元、コピーの 3 段、送信ボタンの出し分け、目次の ✓、進捗バッジの移動** — どれも `kit/board.css` と `kit/board.js` が実装して保証する。**板を書く人は下の DOM 契約のとおり class と `data-*` を書くだけで、そうなっているかを確かめない。**

⚠ **skill の中からブラウザは開けない。**だから「発行前に `getComputedStyle` で測れ」のような手順は置かない。書き忘れは [tools/](tools/README.md) の `check-static.sh` が拾う（`data-q` / `data-label` の欠落、`[data-answer-output]` / `.answer-progress` / `[data-copy-answer]` / `[data-copy-status]` の不在、未定義 class）。

保証している挙動の一覧と、kit を変えたときの確かめ方は [kit/README.md](kit/README.md)「kit が保証している挙動」にある。

⚠ **目次を置く board では、アンカーの宛先を «節を包む要素»（`<section id>`）にする。**見出しに `id` を置くと選択肢がその中に入らず、**判断のある節が «判断なし» に見える。**ここだけは板を書く人が守る。

### 選択肢は末尾にまとめない

**選ぶ操作は、選ぶ材料の隣に置く。**A・B・C を説明したその場で押せるようにする。

**末尾にまとめてはならない。**読み手は判断ごとに「決めた」と思った時点で押したいのに、押す場所が末尾にしかないと、**全部読み終えるまで押せず、末尾で «どれがどれだったか» を思い出し直す**ことになる。判断が複数あるほど、この思い出し直しは増える。

**末尾に置くのは貼り戻し欄とコピーボタンだけ**とする（次節）。末尾で選択肢を再表示してよいが、それは**同じ `data-q` による «再表示» であって、選ぶ場所の «本体» ではない。**

### DOM 契約

同じ論理判断に属する要素は、表示場所が違っても同じ `data-q` を持つ。

```html
<!-- 選択肢は «説明のカードそのもの»。data-label が貼り戻し文に入る短い名前。 -->
<div class="card rec answer-choice" role="button" tabindex="0" aria-pressed="false"
     data-q="scope" data-value="recommended" data-label="A. 推奨を承認する（推奨）">
  <h4><span class="tag rec">推奨</span>A. 推奨を承認する</h4>
  … 軸と弱点 …
</div>
<div class="card answer-choice" role="button" tabindex="0" aria-pressed="false"
     data-q="scope" data-value="alternative" data-label="B. 別案を指示する">
  <h4><span class="tag alt">別案</span>B. 別案を指示する</h4>
  … 軸と弱点 …
</div>

<section class="answer-set" data-q="scope" data-title="判断 scope の見出し">
  <textarea class="answer-note" data-q="scope" aria-label="判断 scope の補足"></textarea>
</section>

<a class="answer-jump" href="#answer-summary" data-scroll-target="answer-summary">
  回答欄へ進む
</a>

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

判断 ID は意味のある安定名にする。同じ `data-q` を持つ選択肢とメモを 1 件として数え、表示されたボタン数を判断数として数えない。

回答 UI の class（`.answer-set` `.answer-choice` `.answer-note` `.answer-jump` `.answer-progress` `[data-answer-output]` `[data-copy-answer]` `[data-copy-status]`）は、すべて `kit/board.css` の「回答フォーム」節が実装している。DOM へ class を書くだけで効く。枠だけのボタン風の見た目は素の `button.answer-choice` にだけ掛かる — カードに掛けるとカードの見た目が消えるため。

### 貼り戻し欄は、読み終わる面に置く

**貼り戻し欄とコピーボタンは、承認の回答欄と同じ面に置く。**別の面へ送らない。読み手はそこで判断を終えるので、**「答えたのにコピーが見つからない」を作らない。**面を分ける媒体での置き場（最後の列の 1 段目）は `create-slides.md`「2 軸の意味」が定める。

**これは «選択肢も末尾に置く» という意味ではない。**選択肢は各判断の場に置き（「選択肢は末尾にまとめない」）、末尾に置くのは**貼り戻し欄とコピーボタン**である。

### 発行前に、選択肢の位置を検査する

`data-q` ごとに、**その `.answer-set` が貼り戻し欄より前に出ているか**を確かめる。末尾の貼り戻し節の中にしか無い `data-q` があれば、その判断は**その場で選べない。**

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
}' <board.html>
```

`末尾のみ` が 1 件でも出たら、その判断の選択肢を材料の直後へ移す。

⚠ **検査の位置を «最初に現れた文字列» で決めない。**共通 CSS が `[data-answer-output]` を selector として持つため、素朴な検索はページ先頭の CSS に当たり、**全部が `OK` に見える。**実際にこの検査を書いた初回にそうなった。

`href` は JS が無効な場合の移動先として残す。横方向へ読むデッキでは `href` だけに頼らず、 `scrollIntoView` の `inline` 方向を明示する。
