# 横に読み進める HTML の 2 軸デッキ renderer
これは **`html-2d-deck` renderer** であり、PowerPoint、Google Slides、PDF には適用しない。
この媒体を選んだときだけ、先に `SKILL.md` と `render-html-common.md` を読んで使う。

## これは話し手のいない配布資料である

読み手が 1 人で開き、説明者なしで判断する。

- 1 面ごとに意味を閉じる。「後で説明する」を使わない。
- 薄い面を良しとしない。話し手が補わないため、必要情報の削除は欠落になる。
- 読む順は読み手が決める。横へ飛び、縦の裏付けを開かない場合も成立させる。
- 横と縦の意味、現在地、判断できる場所を 1 面目で説明する。
- 「なぜ」を口頭説明へ退避させない。

## 別媒体から組み直すときは、落ちた材料を数える

文書や Markdown からデッキへ移すと、表、内訳、差し引き、述語が面の制約で落ちやすい。
組み直した後、元の主成果物にあってデッキにない項目を列挙する。要約へ置き換えてよいのは、
承認者が判断に使わない裏付けだけである。

段落を対比、図、数字カードへ置き換えるだけでは理由が落ちる。**形は内容を掴むため、文は根拠を
確かめるため**に置く。両方が必要なら両方を置く。1 面へ収まらなければ文を削らず、面を分ける。

次の形だけを必要に応じて足す。

| 形 | 使う場面 |
|---|---|
| 2 列の対比 | A と B の違いを、読み終える前から掴ませる |
| 図 | 分岐、順序、依存を示し、つながらない矢印を発見する |
| 数字カード | 症状や影響の大きさを本文から分離する |

見出しと結論行は、面へ縮める過程で主語と目的語が落ちやすい。両者だけを抜き出し、単独で意味が
閉じるかを `SKILL.md` の文の検査で確認する。

## 2 軸の意味

- **横 = 決めるために必要な主線。**横だけで承認または指示へ到達できる。
- **縦 = 確かめるための裏付け。**読み手が気になった面だけ下へ進む。

文書で本文に置く情報を横へ、折りたたむ情報を縦へ置く。媒体を変えるときに内容の境界を
作り直さない。

判断は、その材料を読み終えた面で回答できるようにする。最後の面には、貼り戻し文と選び直すための
同じ回答項目を置いてよい。両方は `render-html-common.md` の同一 `data-q` で同期し、別の判断として
数えない。

## 横だけで推奨を選べるかを測る

長い根拠ほど縦へ落ちやすい。1 段目だけを抜き出し、推奨、推奨理由、代償、反証条件、各選択肢、
停止条件が横にあるか確認する。

```js
const top = [...document.querySelectorAll('.p')]
  .filter(p => p.id.endsWith('-1'))
  .map(p => p.textContent)
  .join(' ');
```

検索項目は board ごとに列挙する。判断に必要な項目が縦にしかなければ、その項目を横へ上げる。

## 面が単独で閉じるかを測る

本文中の「前の面」「上の表」「4 面目」のような位置参照を出す。現在地の表示と移動案内は除外する。

```js
[...document.querySelectorAll('.p')].map(p => ({
  id: p.id,
  refs: p.textContent.match(/\d+\s*面目|\d+\s*節|前の面|上の表/g) || []
}));
```

位置参照が見つかったら、指している内容をその面へ展開する。読み手が別の面を探さないと意味が
閉じない状態を残さない。

## 深さは面ごとに変える

各列へ同じ数の縦面を作らない。深い列は、判断材料が重い場所を地図の形で示す。
下に面がある場合は矢印だけでなく、**何を確かめられるか**を語で書く。読み手が降りる前に、
降りる価値を判断できるようにする。

## 入れ子の scroll-snap

横の `.deck` と縦の `.col` を別の scroll container にする。

```css
.deck {
  display: flex;
  height: 100dvh;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
}
.deck-col {
  flex: 0 0 100%;
  height: 100dvh;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  scroll-snap-align: center;
  scroll-snap-stop: always;
}
.p {
  height: 100dvh;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  display: flex;
  overflow: hidden;
}
.p > .in { max-width: var(--wide-in); }
.p > .in > p,
.p > .in > ul { max-width: var(--measure); }
```

面の箱全体を `--measure` へ制限しない。散文だけを制限し、見出し、表、カードは面幅を使う。
`--measure` は文字数の制約なので `em` のまま使う。

横移動で離れた列は、画面外に出てから一番上へ戻す。来る列をその場で戻すと、読み手の目の前で
内容が飛ぶ。戻す処理は即時にし、初回読み込みでは実行しない。初回に戻すと `#p3-2` のような
直接参照を壊すため、デッキが一度横へ動いた後だけ有効にする。

## キー操作

入れ子の scroll container では、ブラウザ既定の矢印操作が focus 位置で変わる。次を明示的に処理する。

- `ArrowRight` / `ArrowLeft` — 隣の横列へ移動する。端では何もしない。
- `ArrowDown` / `ArrowUp` / `Space` / `PageDown` / `PageUp` — 同じ列の縦面へ移動する。端では何もしない。
- input、textarea、select、contenteditable に focus がある場合は横取りしない。
- Ctrl、Alt、Meta などの修飾キーが押されている場合は横取りしない。

## 画面を押す操作

キーボードのない端末向けに、画面座標から移動方向を決める。

```text
┌─────┬───────────────┬─────┐
│     │   上 1/4  ▲   │     │
│  ◀  ├───────────────┤  ▶  │
│ 1/4 │   中央は空ける   │ 1/4 │
│     ├───────────────┤     │
│     │   下 1/4  ▼   │     │
└─────┴───────────────┴─────┘
```

左 1/4 と右 1/4 は横移動、中央 2/4 の上 1/4 と下 1/4 は縦移動に使う。中央は文字選択と
回答操作のために空ける。

透明な hit area を重ねない。document の click を 1 つ受け、座標から方向を計算する。
次の場合は移動しない。

- 押した要素が `a, button, textarea, input, select, label`、回答フォーム、地図の内側。
- `String(getSelection())` が空でなく、文字を選択している。
- その方向に移動先がない。

hover の判定は event target ではなく `elementFromPoint` を使う。合成イベントや親要素で受けた
mousemove の target が、実際にポインタ直下の要素とは限らないためである。移動可能な方向だけ
三角の色と拡大率を変え、cursor を pointer にする。操作できないフォーム上で矢印を光らせない。

## 現在地

### 右下の地図

横を列、縦を深さとする枡を作る。枡数をデッキ構造と一致させ、現在の面を塗る。
`IntersectionObserver` の既定は `threshold: 0.6` とする。これは移動途中に 2 面が同時選択されにくい
実測由来の目安である。各枡を `<a href="#p3-2">` にし、JS が無効でも目次として働かせる。

### 4 辺の三角

移動先がある辺だけ表示する。常時 4 つを表示しない。三角は低い不透明度で置き、
`pointer-events: none` にする。click の方向判定は座標で行い、三角自体を hit area にしない。

地図番号、数字カード、回答進捗へ同じ一般名の class を使わない。部品の役割を含む名前を付け、
`render-html-common.md` のクラス検査を行う。

## 1 面を 1 画面へ収める

`min-height: 100dvh` の要素に `scrollHeight > clientHeight` を当てると、内容に合わせて
`clientHeight` も伸び、overflow を見落とす。`height: 100dvh` に固定し、面の実寸と viewport を比べる。

```js
const deck = document.getElementById('deck');
const vh = deck.clientHeight;
[...deck.querySelectorAll('.p')]
  .map(p => ({ id: p.id, ratio: p.getBoundingClientRect().height / vh }))
  .filter(item => item.ratio > 1.02);
```

狭い画面で測る。判断に使う 1 段目は `1.05` 以下を目安とする。裏付けは、読み手が降りると
決めているため `1.2` 程度まで許容できる。いずれも実測由来の目安であり、内容が読めることを
スクリーンショットで確認する。

収まらないときは情報を削らず、判断情報なら横、裏付けなら縦へ面を分ける。

## 自動縮小と fallback scroll

viewport ごとの手詰めを避け、面の高さを `100dvh` に固定したうえで内容を縮小する。

```css
.p { height: 100dvh; display: flex; overflow: hidden; }
.p > .in {
  margin: auto;
  transform: scale(var(--s, 1));
  transform-origin: center top;
}
.p.spill { overflow-y: auto; }
.p.spill > .in { margin: 0 auto; }
```

`transform-origin` は `center top` にする。`center center` では、面より高い内容の中心を軸に縮小し、
塊が下へずれる。

```js
const MIN = 0.72; // 実測由来の可読性下限
const inner = p.firstElementChild;
inner.style.setProperty('--s', '1');
const style = getComputedStyle(inner);
let needed = inner.scrollHeight;
if (inner.scrollHeight > inner.clientHeight) {
  needed += parseFloat(style.paddingBottom) || 0;
}
needed = Math.max(needed, inner.offsetHeight);
const scale = p.clientHeight / needed;
inner.style.setProperty('--s', scale >= 1 ? '1' : Math.max(MIN, scale).toFixed(4));
p.classList.toggle('spill', scale < MIN);
```

`transform: scale` は版面の高さを変えない。`zoom` は再レイアウトで高さを変えるため、倍率計算を
反復させる。

- overflow の高さは `scrollHeight` で測る。flex item の `offsetHeight` は面の高さへ丸められうる。
- 内容が溢れる場合は `scrollHeight` に含まれない下 padding を足す。
- `MIN` に達したら内容を切らず、その面だけ `.spill` で縦 scroll を許す。
- 高さだけでなく、面と内容の上端・下端を比較する。

```js
const pageRect = p.getBoundingClientRect();
const innerRect = p.firstElementChild.getBoundingClientRect();
const outside = (pageRect.top - innerRect.top > 1) || (innerRect.bottom - pageRect.bottom > 1);
```

検査が働くか、十分に高い probe を一時挿入して確認する。`transform-origin` を一時的に誤った値へ
戻すなど、直した欠陥を検査が検出することも確認する。

## 表は横に切らない

判断材料の列が画面外に隠れると、読み手は存在に気づけない。

- 表を `width: 100%; max-width: 100%; table-layout: auto` にする。
- `white-space: nowrap` を header と色分け class の両方から除く。
- 縦へ伸びた分は、自動縮小または面の分割で処理する。
- 狭い画面では、表を 1 行 1 カードへ組み替える。既定境界 `760px` は実測由来の目安である。
- header の語を JS で各 cell の `data-label` へ写す。手で複製しない。
- label は cell 内の同じ行へ置く。label 専用行や固定幅の左列を増やし、縦長にしない。

```js
const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
table.querySelectorAll('tbody tr').forEach(row => {
  [...row.children].forEach((cell, index) => {
    cell.setAttribute('data-label', headers[index] || '');
  });
});
```

各表で `scrollWidth > clientWidth` の cell または wrapper がないことを、想定 viewport 全部で測る。

## 画像面の例外

細かい mockup や画面写真を 1 面へ縮めると文字が読めない場合は、その画像面だけ scroll または
拡大を許す。例外を使う場合は、キャプションに「この面だけは 1 画面に収まらない」ことを書く。
画像が決めている内容は別の面に文字でも置き、小さい画面で画像が読めなくても判断できる状態にする。

## 発行前検査

`render-html-common.md` の共通検査に、次を追加する。

1. 各面の幅が viewport 幅と等しい。
2. 各面の高さ比、縮小率、`.spill`、内容の上下位置が基準内にある。
3. 地図の枡数が面総数と一致し、面 ID と判断 ID が一意である。
4. 横主線だけで推奨、理由、代償、反証条件、停止条件、回答へ到達できる。
5. 面本文に、別の面を探させる位置参照が残っていない。
6. キー、swipe、四辺 click、地図、直接 hash、回答欄への移動を操作する。
7. 画像面以外の表と判断面が横に切れない。
8. 数値検査の後に、狭い画面と広い画面を撮って見る。

正規表現の一括置換を行ったら、`id="p<列>-<深さ>"`、見出し、地図枡、回答 `data-q` の数を
編集前後で比較する。1 つの一致だけを置き換える場合は、置換前に一致数が 1 であることを確認する。

selector が定義されていても、期待する layout が効いているとは限らない。grid、border、position、
transform-origin を `getComputedStyle` で確認し、実画面でも見る。
