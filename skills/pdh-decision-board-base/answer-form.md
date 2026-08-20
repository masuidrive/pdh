# 回答フォーム — 選ばせて、返せる形にする〔手順 10〕

⚠ **HTML で board を作るなら必ず読む。**`N = 0`（承認だけ）でも回答フォームは要る。 DOM の形・状態の同期・コピー・発行前の検査まで、ここが持つ。

⚠ **`N = 0`（承認だけ）の board にも、選ぶ操作とコメント欄を置く。**判断が 0 件でも、**承認者が返す答えは «承認する / 承認しない» の 2 つ**だからである。置くものは次の 4 つ。

- **押せる選択肢 2 つ** — 「承認する」と「承認しない（修正指示・差し戻し）」。⚠ **カードそのものを押せるようにする**（下記「選択肢のカードそのものを、押せるようにする」）。
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

### 選択肢のカードそのものを、押せるようにする

**案を説明したカードが、そのまま «選ぶ» 操作になる。**カードの下や末尾に別のボタン行を置かない。

**別のボタン行を置くと、同じ選択肢が 2 回出る。**読み手は説明のカードで決めたのに、**もう一度ボタンの短いラベルを読んで «どれがどれだったか» を照合する**ことになる。案が 3 つ以上あるほど、この照合は増える。

```html
<div class="card rec answer-choice" role="button" tabindex="0" aria-pressed="false"
     data-q="scope" data-value="A" data-label="A. このまま出す（推奨）">
  <h4><span class="tag rec">推奨</span>A. このまま出す</h4>
  … 軸（利用者から見て / コスト / 取り返し）と弱点 …
</div>
```

⚠ **`data-label` は必須。**貼り戻し文に入る短い名前である。**これが無いと、カードの本文が丸ごと貼り戻し文に入る**（`textContent` を拾うため）。実際にこれを踏み、**選択 1 件で 300 字を超える貼り戻し文**になった（2026-08-15）。

**`<button>` にはしない。**カードの中に表・リスト・見出しが入るため、**`<button>` の中に置けない要素**が出てくる。`role="button"` と `tabindex="0"` を付け、**キーボードは自分で受ける**（下記の `keydown`）。

#### 見出しの左端は «選択»、右端は «推奨か別案か»

⚠ **この左右を入れ替えない。**判断ボードはこの並びで作られてきた。

```
○ A. このまま出す                         [推奨]
◉ B. 絵のとおりに戻す                     [別案]   ← 選ばれているのは B
```

- **左端**に、いま選ばれているかを示す**丸**を置く。選ぶと中が塗られる。
- **右端**に、推奨・別案・その他の**バッジ**を置く。

**逆に置くと、推奨のバッジが «選ばれている印» に読める。**実際そう読まれた（ユーザ指摘 2026-08-15「選択と推奨の UI が過去の判断ボードと合ってない。逆な気がする」）。そのとき出していたのは、左端に大きな推奨バッジ、右端に「選ぶ」ボタンという並びだった。

**「選ぶ」というボタン文字は置かない。**空の丸が «押せば選べる» を、塗られた丸が «選んでいる» を運ぶので、文字は要らない。

⚠ **塗り（背景色）は «選ばれている» だけの印にする。**推奨カードにも塗りがあると、**どちらが選択中か見分けられない**（同じユーザから 2026-08-15「選択わかりにくい」）。推奨であることは、右のバッジと枠線の色で足りる。選択中のカードには**太い枠・左の帯・塗り・塗られた丸**を付け、**同じ判断の他のカードは薄くする**。

⚠ **選択肢カードの地（背景）は 4 枚全部を回答フォームの CSS で決める。**推奨カードだけ書き換えると、**文書版とスライド版でカードの既定の地が違う**ため、片方で «推奨だけ濃い»、もう片方で «推奨だけ薄い» になる。

⚠ **左の帯と丸の幅は、選ばれていないカードでも空けておく。**選んだ瞬間に空けると**本文が右へずれて «別の文章になった» ように見える。**

実装は `kit/board.css` の「回答フォーム」節。丸は `h4::before` で描き、**見出しの 1 行目に合わせる**（カード上端からの距離で置くと、見出しが 2 行になった媒体で丸だけが取り残される）。バッジは `padding` と `background` を回答フォーム側で上書きしてある — スライド版に«推奨のかたまり» を表すブロック用の `.rec` があり、`class="tag rec"` のバッジまで巻き込むため。

**自由記述欄は残す。**カードでは「その他」を選び、**記述が回答本体**になる。

### 選択肢は末尾にまとめない

**選ぶ操作は、選ぶ材料の隣に置く。**A・B・C を説明したその場で押せるようにする。

**末尾にまとめてはならない。**読み手は判断ごとに「決めた」と思った時点で押したいのに、押す場所が末尾にしかないと、**全部読み終えるまで押せず、末尾で «どれがどれだったか» を思い出し直す**ことになる。判断が複数あるほど、この思い出し直しは増える。

**末尾に置くのは貼り戻し欄とコピーボタンだけ**とする（次節）。末尾で選択肢を再表示してよいが、それは**同じ `data-q` による «再表示» であって、選ぶ場所の «本体» ではない。**

**この規則は実際の指摘から来ている**（ユーザ指示 2026-08-15）。選択肢の説明を本文の中ほどに置き、 `.answer-set` を末尾の「返す」節にだけ置いた board を出したところ、**「選択肢がある時はその場で選択できるようにして。最後でまとめないで」**と指摘された。

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

### 状態と同期

実装は `kit/board.js`。文書とデッキへ**同じファイル**を埋め込み、board ごとにロジックを書き換えない。`kit/board.js` が守っている挙動:

- 状態は `[data-board-id]` の値ごとに localStorage へ保存し、再読み込みで復元する。**保存に失敗しても、回答と貼り戻し文の生成は続ける。**
- 貼り戻し文の短い名前は **`data-label` から**取る。カードを選択肢にすると `textContent` は «カード全部» になり、本文が丸ごと貼り戻し文へ入るため（実例: 選択 1 件で 300 字超、2026-08-15）。
- 選ぶと同じ `data-q` の他のカードを引き（`is-dimmed`）、選んだ 1 枚だけが前に出る。
- **入力中の `<textarea>` 自身は同期処理で書き換えない。**書き換えるとカーソル位置が飛ぶ。
- カードは `<button>` ではないので、Enter / Space のキーボード操作を自前で受ける。
- 未回答は `（未選択）` と貼り戻し文に明示し、進捗（`回答 n / N`）を更新する。

### コピーは 3 段で受ける — 手でコピーさせるのは最後だけ

**埋め込みブラウザ、sandbox された iframe、preview では `navigator.clipboard` が権限で失敗する。**そこで諦めて「長押ししてください」と出すと、**ボタンがコピーしないまま «押せる» 状態**になる。**古い `document.execCommand('copy')` は、押した操作（user activation）の中で呼べば sandbox された iframe でも通る。**必ず間に挟む。

実装は `kit/board.js` の `copyAnswer`。3 段の順は ① `navigator.clipboard` →② `document.execCommand('copy')`（readonly な `<textarea>` は iOS で選択できないため一時的に外して選択する）→ ③ 選択を残して手でのコピーを案内、である。

**⚠ 合成クリックで検査しても «コピーできた» は確かめられない。**`element.click()` は user activation を持たないので `execCommand` は必ず false を返す。**検査は次の順で行う。**

1. ボタンに focus を当て、**キーボードで押す**（`press Enter`）。これは trusted な操作になる。
2. 空の `<textarea>` を作って focus し、**`Ctrl+V` で貼る**。
3. 貼れた文字数と、回答項目の数を数える。

**`navigator.clipboard` を一時的に失敗させてから測る。**そうしないと 1 段目だけを検査して「通った」と判断し、実際に使われる 2 段目を一度も動かさないまま出すことになる。

### 貼り戻し欄は、読み終わる面に置く

**貼り戻し欄とコピーボタンは、承認の回答欄と同じ面に置く。**別の面へ送らない。読み手はそこで判断を終えるので、**「答えたのにコピーが見つからない」を作らない。**面を分ける媒体での置き場（最後の列の 1 段目）は `create-slides.md`「2 軸の意味」が定める。

**これは «選択肢も末尾に置く» という意味ではない。**選択肢は各判断の場に置き（「選択肢は末尾にまとめない」）、末尾に置くのは**貼り戻し欄とコピーボタン**である。

### 発行前に、選択肢の位置を検査する

`data-q` ごとに、**その `.answer-set` が貼り戻し欄より前に出ているか**を確かめる。末尾の貼り戻し節の中にしか無い `data-q` があれば、その判断は**その場で選べない。**

```bash
python3 - <<'PY' <board.html>
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
# ⚠ 素朴に "data-answer-output" を探すと、CSS の selector に当たる。実体の textarea を探す。
m = re.search(r'<textarea[^>]*data-answer-output', h)
assert m, "貼り戻し欄が見つからない"
for a in re.finditer(r'class="answer-set"[^>]*data-q="([^"]+)"', h):
    print(("OK       " if a.start() < m.start() else "末尾のみ "), a.group(1))
PY
```

`末尾のみ` が 1 件でも出たら、その判断の選択肢を材料の直後へ移す。

⚠ **検査の位置を «最初に現れた文字列» で決めない。**共通 CSS が `[data-answer-output]` を selector として持つため、素朴な検索はページ先頭の CSS に当たり、**全部が `OK` に見える。**実際にこの検査を書いた初回にそうなった（2026-08-15）。

`href` は JS が無効な場合の移動先として残す。横方向へ読むデッキでは `href` だけに頼らず、 `scrollIntoView` の `inline` 方向を明示する。

### 発行前に、選択の丸が左・バッジが右にあることを測る

**目で見て確かめない。**丸は `::before` で描くので DOM に要素として現れず、**バッジの位置は媒体ごとの CSS に巻き込まれて変わる**（スライド版の `.rec` が実例）。

```js
// ブラウザで実行する。1 判断ぶんの選択肢カードを測る。
Array.from(document.querySelectorAll('.answer-choice')).map(c => {
  const h = c.querySelector('h4'), tag = h.querySelector('.tag');
  const dot = getComputedStyle(h, '::before');
  return {
    label: h.textContent.trim().slice(0, 12),
    丸がある: dot.content !== 'none' && parseFloat(dot.width) > 0,
    丸は左: parseFloat(dot.insetInlineStart) < 0,
    バッジは右: !tag || getComputedStyle(tag).float === 'inline-end',
    地: getComputedStyle(c).backgroundColor,
  };
});
```

- `丸がある` `丸は左` `バッジは右` が全カードで真であること。
- `地` は、**選択中の 1 枚だけが他と違う**こと。選択前は 4 枚が同じ値になる。
- 明・暗の両方で測る。**測る前に、実際にその配色で開けているかを `matchMedia('(prefers-color-scheme: dark)').matches` で確かめる**（切り替えたつもりで切り替わっていないことがある）。
