# 1 枚の HTML 文書 renderer
このファイルは、判断ボードを**手書きの 1 枚の HTML 文書**として組む renderer である。
HTML 文書を主成果物に選んだときだけ、先に `SKILL.md` と `render-html-common.md` を読んで使う。

## 文書の読み方

読み手は上から読み、決定サマリーから気になる節へ移動し、AC 原文や測定根拠をその場で開く。
本文は 1 本の流れに置き、付録には「ここから先は、決めるために読む必要はありません」と明記する。

## 本文幅と表幅を分ける

本文の 1 行を制限する目的は、目が行末から次の行頭へ戻るときの取り違えを減らすことである。
制限は、見出し、表、カード、番号札ではなく、目で追う散文だけに適用する。

読みやすさは次の順で作る。

1. 行間を広げ、長い行と狭い行間の組み合わせを避ける。
2. 段落を短くし、行を戻る回数を減らす。
3. 左揃えにして行末の形を手掛かりとして残す。
4. 本文の行長を `--measure` へ制限する。

共有 token の `--measure` は実測値ではなく、半角識別子が混ざる日本語文書を反復調整して得た既定値である。
数字だけを適用せず、上の目的が満たされるかを実際の文章で確認する。

```css
.board { color: var(--fg); background: var(--bg); }
.board .prose { max-width: var(--measure); }
.board .wide { width: min(100%, var(--wide)); }
.board p { line-height: var(--lh-body); }
.board table { width: 100%; }
.board .table-wrap { max-width: 100%; overflow-x: auto; }
```

表は照合と再集計のために本文段より広くしてよい。横 overflow は `.table-wrap` の中だけで受け、
ページ本体を横に動かさない。

## `h2` だけを上端へ固定する

読み手が気になる節へ飛んでも現在地を失わないよう、`h2` を sticky にする。本文より広い表が
見出しの裏を通らないよう背景を左右へ伸ばすが、scroll 範囲を増やさない `box-shadow` を使う。

```css
.board h2 {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg);
  box-shadow: -50vw 0 0 0 var(--bg), 50vw 0 0 0 var(--bg);
}
html, body { overflow-x: clip; }
```

擬似要素を負の inset で広げない。絶対配置の箱が scroll 範囲へ加算されるためである。
`overflow-x: hidden` は scroll container を作り、sticky を壊しうるため使わない。罫線は本文幅に
合わせたままにする。`h3` まで固定すると小さい画面の本文領域が減るため、固定しない。

## AC 原文と本文参照

AC の言い換えの直下で、対応する原文を開けるようにする。末尾に原文をまとめない。

- AC 一覧は `<details class="acx">` とし、`<summary>` の AC 番号から次の行へ原文を開く。
- 本文中の AC 参照は `<button popovertarget>` と `<span popover>` を使う。
- `<details>` は phrasing content ではないため、段落の中へ置かない。
- popover 非対応環境では本文を壊さず、参照が開かないだけにする。
- `AC6〜AC9` のような範囲は 1 つの参照にまとめ、途中の AC も同じ場所で確認できるようにする。

```css
.acpop { display: none; }
.acpop:popover-open { display: block; }

.acx > summary { display: block; }
.acx > summary::marker,
.acx > summary::-webkit-details-marker { content: ""; display: none; }
.acx[open] > summary::before,
.acx > summary::before { content: none; }
```

最後の selector は、汎用の `details[open] > summary::before` に特異度で負けないよう
`.acx[open]` を含める。閉じた `<details>` に背景や枠を付けず、開いたときだけ内容の境界を示す。

## 表を使う条件

表は、読み手が集合、対応、差し引きを数え直す場合だけ使う。独立項目を並べるだけなら段落または
カードにする。

**表だけを見て board が主張する数を復元できること**を合否基準にする。

- 1 行だけで意味が閉じるようにする。処置が複数行へまたがる場合は、記号またはセル結合で示す。
- 1 列には同じ種類の値だけを置く。個数列へ「含む」「残り」のような語を混ぜない。
- 差し引きを 1 行で書き、変更前、増減、変更後を表から検算できるようにする。
- セル結合の有無そのものを規則にしない。結合後も非結合後も数を復元できるかで決める。

## 文書固有の発行前検査

`render-html-common.md` の共通検査に、次を追加する。

1. sticky `h2` が表の上を覆い、見出しの背景拡張が横 scroll を作らないことを確認する。
2. `<details>` を開閉し、summary marker が二重に出ないことを確認する。
3. 本文中の各 AC 参照と範囲参照を開き、対応する原文が出ることを確認する。
4. 表の箱だけが必要に応じて横へ動き、ページ本体は動かないことを確認する。
5. 開始・終了タグの個数と見出し数を編集前後で比較する。

HTML は閉じタグが欠けても描画される。残りの本文が誤った親要素に包まれるため、目視だけで
構造を判断しない。正規表現で節を一括置換した場合は、見出し数、AC 数、回答 ID 数も比較する。

CSS selector が存在することだけでは足りない。sticky、popover、表の overflow、回答フォームの
代表要素を `getComputedStyle` と実画面の両方で確認する。
