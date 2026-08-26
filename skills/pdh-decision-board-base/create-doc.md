# 1 枚の HTML 文書 renderer
このファイルは、判断ボードを**手書きの 1 枚の HTML 文書**として組む renderer である。 HTML 文書を主成果物に選んだときだけ、先に `SKILL.md` と `render-html-common.md` を読んで使う。

**CSS / JS は自分で書かない。**`kit/tokens.css` + `kit/board.css`（この順）と、`kit/page.js` + `kit/board.js`（この順）をそのまま埋め込む（page.js は目次・現在地・h2 の stuck 検出。目次を置かない短い board では省いてよい — 無くても他は壊れない）（`render-html-common.md`「CSS と JS は自分で書かない — kit を埋め込む」）。 kit に無い部品が必要になったら、継ぎ足さずに «何が足りなかったか» を報告する。このファイルの CSS への言及は、kit が実装している規則の説明である。

## 文書の読み方

読み手は上から読み、決定サマリーから気になる節へ移動し、AC 原文や測定根拠をその場で開く。本文は 1 本の流れに置き、付録には「ここから先は、決めるために読む必要はありません」と明記する。

## 本文幅と表幅を分ける

本文の 1 行を制限する目的は、目が行末から次の行頭へ戻るときの取り違えを減らすことである。制限は、見出し、表、カード、番号札ではなく、目で追う散文だけに適用する。

読みやすさは次の順で作る。

1. 行間を広げ、長い行と狭い行間の組み合わせを避ける。
2. 段落を短くし、行を戻る回数を減らす。
3. 左揃えにして行末の形を手掛かりとして残す。
4. 本文の行長を `--measure` へ制限する。

共有 token の `--measure` は実測値ではなく、半角識別子が混ざる日本語文書を反復調整して得た既定値である。数字だけを適用せず、上の目的が満たされるかを実際の文章で確認する。

行長の制限は散文の箱に `class="prose"` を付けて行い、本文段より広く使う箱には `class="wide"` を付ける（実装は `kit/board.css`）。表は照合と再集計のために本文段より広くしてよい。横 overflow は表を包む `.table-wrap` の中だけで受け、ページ本体を横に動かさない。

## `h2` だけを上端へ固定する

読み手が気になる節へ飛んでも現在地を失わないよう、`h2` を sticky にする。本文より広い表が見出しの裏を通らないよう背景を左右へ伸ばすが、scroll 範囲を増やさない `box-shadow` を使う（実装は `kit/board.css` の `.board h2` と `html, body { overflow-x: clip }`）。

擬似要素を負の inset で広げない。絶対配置の箱が scroll 範囲へ加算されるためである。 `overflow-x: hidden` は scroll container を作り、sticky を壊しうるため使わない。罫線は本文幅に合わせたままにする。`h3` まで固定すると小さい画面の本文領域が減るため、固定しない。

## AC 原文と本文参照

AC の言い換えの直下で、対応する原文を開けるようにする。末尾に原文をまとめない。

- AC 一覧は `<details class="acx">` とし、`<summary>` の AC 番号から次の行へ原文を開く。
- 本文中の AC 参照は `<button popovertarget>` と `<span popover>` を使う。
- `<details>` は phrasing content ではないため、段落の中へ置かない。
- popover 非対応環境では本文を壊さず、参照が開かないだけにする。
- `AC6〜AC9` のような範囲は 1 つの参照にまとめ、途中の AC も同じ場所で確認できるようにする。

実装は `kit/board.css` の `.acx` / `.acref` / `.acpop`。summary の marker は消してあり、その selector は汎用の `details[open] > summary::before` に特異度で負けないよう `.acx[open]` を含めている。閉じた `<details>` に背景や枠を付けず、開いたときだけ内容の境界を示す。

## 表を使う条件

表は、読み手が集合、対応、差し引きを数え直す場合だけ使う。独立項目を並べるだけなら段落またはカードにする。

**表だけを見て board が主張する数を復元できること**を合否基準にする。

- 1 行だけで意味が閉じるようにする。処置が複数行へまたがる場合は、記号またはセル結合で示す。
- 1 列には同じ種類の値だけを置く。個数列へ「含む」「残り」のような語を混ぜない。
- 差し引きを 1 行で書き、変更前、増減、変更後を表から検算できるようにする。
- セル結合の有無そのものを規則にしない。結合後も非結合後も数を復元できるかで決める。

## v2 部品（steps / timeline / compare / quote / fig / mermaid）

kit v2 で確定した共有部品。CSS は `kit/board.css` にある（文書版は tokens.css + board.css を読み込めばそのまま使える）。**色・枠を style 属性で足さない** — 意味は class が持つ。

- **steps** — 順番が意味を持つ列挙（依存順・段階承認・確認手順）。順序が無い列挙には使わない。 `<ol class="steps"><li class="done|on"><b>名前</b><span class="sub">補足</span></li></ol>` （`done` = 済んだ段階、`on` = いまの段階。無印は未着手）
- **timeline** — 経緯を時系列で。1 行 = 事実 1 つ、日付必須。 `<ul class="tl"><li class="warn|mark"><time>2026-08-12</time>事実</li></ul>` （`warn` = 問題が起きた行、`mark` = この board に関わる行）
- **compare** — 軸を固定して案を横に比べる。軸の 1 本目は «ゴールへの効き»（Why / AC の言葉で）、続けて「利用者から見て / コスト / 取り返し」を既定にし、案ごとに違う観点で書かない。セルは 1 文まで、3 案まで（4 案以上は判断カードの縦積みへ）。 `<div class="table-wrap compare"><table><thead><tr><th></th><th class="rec">A 案<span class="tag">推奨</span></th>…</thead><tbody><tr><th>軸名</th><td class="rec">…</td>…</tbody></table></div>` （推奨列のセル全部に `class="rec"`）
- **quote** — 報告・発言は要約で潰さず原文で引用する。出典（誰・どこ・いつ）必須。 `<blockquote class="quote"><p>原文</p><cite>誰 · どこ · いつ</cite></blockquote>`
- **fig** — 画像・SVG 図・flowchart の共通枠。caption に「何を見てほしいか」を必ず書く。**箱は中身の幅に合わせて縮む**（表や図解のように広い中身は列いっぱいになる） — 狭い画像を列いっぱいの箱に入れると、右に大きな空白が残って «幅が揃っていない» と読める。⚠ それでも、**像は承認者が実際に見る幅で撮る**（SKILL.md「判断カードの型」）。箱が縮むことは、小さく撮ってよい理由にはならない。 `<figure class="fig"><div class="bar"><b>題</b><span class="badge">種別</span></div><div class="media">img / svg / pre.mermaid</div><figcaption>見てほしい点</figcaption></figure>` （余白が要る図は `.media.pad`。手描き SVG の色は `style="fill:var(--…)"` で token 参照 — presentation attribute では var() が効かない）
- **mermaid** — 分岐・順序・依存は `pre.mermaid` に mermaid ソースで書き、`.fig` の `.media.pad` に入れる。描画機構（bundle の inline 手順・失敗時の挙動）は kit/README「mermaid の差し込み」にある。
- **details.fold** — 根拠の詳細（確認コマンド・生出力・数え上げ・手順詳細）を 1 手で開く汎用の畳み。
  `<details class="fold"><summary>「変更無し」の追跡 — 出荷物への同梱と参照の 2 方向</summary>…</details>`
  （summary は例のように結論そのものを書く — base「作業経緯は畳む」の見出し規則と同じ。
  AC 原文専用の `.acx` とは別部品。何を主線に置き何を裏付け・畳みにするかは gate skill の主線固定部が定める）
- **目次** — 節が 5 つを超える board に置く。`<div class="layout"><nav class="toc" id="toc"><button class="toc-t" type="button" id="toct">目次</button><ol><li><a href="#節id">節名</a></li>…</ol></nav><div class="content">…全節…</div></div>`
  で本文を包む（節は `<section id>` 前提 — 既定どおり）。現在地・狭い画面の目次ボタン・h2 の
  stuck 切り詰めは page.js が担う。**判断のある節の行末には ✓ が出る**（board.js が付ける。
  規則は `answer-form.md`「判断がある節は、目次から分かるようにする」）。⚠ アンカーの宛先を
  見出しではなく `<section id>` にすること — 見出しに向けると選択肢が宛先の中に入らず、
  **判断のある節が «判断なし» に見える。**

## 文書固有の発行前検査

板ごとに回すのは [tools/](tools/README.md) の `check-static.sh` である（ブラウザは要らない）。そのうえで、`render-html-common.md` の共通検査に次を追加する。

1. sticky `h2` が表の上を覆い、見出しの背景拡張が横 scroll を作らないことを確認する。
2. `<details>` を開閉し、summary marker が二重に出ないことを確認する。
3. 本文中の各 AC 参照と範囲参照を開き、対応する原文が出ることを確認する。
4. 表の箱だけが必要に応じて横へ動き、ページ本体は動かないことを確認する。
5. 開始・終了タグの個数と見出し数を編集前後で比較する。
6. 目次を置いた board では、**`.toc a.has-q` の行数と、判断のある節の数が一致すること**をブラウザで数える（目視で ✓ を探さない。アンカーが見出しを指していると印が黙って消え、判断が 1 件も無いように見える）。

HTML は閉じタグが欠けても描画される。残りの本文が誤った親要素に包まれるため、目視だけで構造を判断しない。正規表現で節を一括置換した場合は、見出し数、AC 数、回答 ID 数も比較する。

CSS selector が存在することだけでは足りない。sticky、popover、表の overflow、回答フォームの代表要素を `getComputedStyle` と実画面の両方で確認する。
