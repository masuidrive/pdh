# 判断ボード kit

判断ボード（文書版・2 軸デッキ版）の CSS と JS。**規則の実装**であって規則ではない —規則の本体は `../render-html-common.md`・`../create-doc.md`・`../create-slides.md`。食い違ったらそちらが正。

外部ツール（Node・Tailwind・CDN）に依存しない。発行先の artifact host は外部への通信を遮断するため、CSS / JS は 1 枚の HTML へ**インラインで**埋め込む。

## ファイルと読み込み順

| ファイル | 中身 |
|---|---|
| `tokens.css` | 色・面（bg / paper / fill の 3 面）・font・寸法の基準 token（明暗）。**基準はここにしか無い** |
| `board.css` | 文書版の組版・カード・表・v2 部品（steps / tl / compare / quote / fig / mermaid-svg / details.fold / toc）・画面写真・付録・**回答フォーム**。⚠ token は定義しない — `tokens.css` を先に読み込む |
| `deck.css` | 2 軸デッキの組版。⚠ 単独では使わない — `board.css` の後ろへ重ねる。token は定義しない |
| `board.js` | 回答フォームの動作（選択・メモ・進捗・貼り戻し文の生成・3 段コピー）。文書とデッキで同じ 1 つ |
| `deck.js` | 面の移動・右下の地図・端の三角・押して送る・自動縮小 |

```text
文書版:   <style>tokens.css + board.css</style> … body … <script>page.js</script><script>board.js</script>
          （page.js = 目次・現在地・h2 stuck。目次の無い短い board では省略可）
デッキ版: <style>tokens.css + board.css + deck.css</style> … body … <script>deck.js</script><script>board.js</script>
```

組み立て（body と CSS / JS を 1 枚にまとめる手順）と、その結果の検査は kit の外（ユーザ指示 2026-08-16）。

## kit が前提にする DOM

- 外枠: `<main class="board" lang="ja" data-board-id="…" data-answer-title="…">`（文書）／ `<div class="deck" id="deck" lang="ja" data-board-id="…" data-answer-title="…">`（デッキ）。⚠ `data-board-id` は 1 ページに 1 つ。**回答フォームの部品（進捗・貼り戻し欄・コピーボタン）は全部この中に置く** — `board.js` は外枠の中しか見ない。
- 選択肢カード・回答欄・進捗・貼り戻し欄は `../render-html-common.md`「DOM 契約」の形。⚠ カードには `data-label` を必ず書く（無いと貼り戻し文にカード本文が丸ごと入る）。
- デッキの列は `<div class="deck-col">`、面は `<section class="p"><div class="in">…`。**id は書かない** — `deck.js` が読み込み時に DOM 順で採番する（列 `c0` `c1` …、面 `p<列>-<段>` で `p0-1` から。地図と `#p3-2` 直接参照がこの id を使う）。書いてあった id も上書きされる — 番号の出所を 2 つにしない。
- デッキの「主線 ✦」は `deck.js` が「主線 n / N」（N = 列数）へ採番する。「↓ 下に N 段」の N も、その面の下に実際にある面の数で書き換える —どちらも数を手で書くと、面を足したときにずれるため。N のまま書いてよい。
- デッキには地図 `<nav class="map" id="map"></nav>` と三角 `<div class="edge edge-l">◀</div>`（l / r / u / d の 4 つ）を deck の**外**に置く（fixed 表示。外枠の中に置く必要があるのは回答フォームの部品だけ）。

## 画面写真を原寸で開く

サムネイルを `<a class="shot-open" href="#zoom-x">` で包み、原寸の overlay を `<a class="shot-zoom" id="zoom-x" href="#shot-x"><img …><span class="shot-zoom-hint">押すと閉じる（Esc でも）</span></a>` として置く（`shot-x` は元の figure の id。img の src / alt は両方同じにする）。開閉は `:target` だけで成立し、script が止まっていても壊れない。Esc は `board.js` の上乗せ。⚠ **デッキでは `.shot-zoom` を `.deck` の外に置く**（地図・三角と同じ場所）。面の中は自動縮小の transform が掛かるため、fixed が viewport に効かない。

## ホストと port の入力 → 確認 URL

本文には path だけを書く（読み手が開く環境のホスト名は書き手には分からない）。

```html
<div class="host-setup">
  <label>ホスト <input data-host-input type="text" placeholder="例: mymachine.example.ts.net"></label>
  <label>port <input data-port-input type="number" min="1" max="65535" placeholder="4177"></label>
</div>
…
<code data-path="/ui/example/items/xxx">/ui/example/items/xxx</code>
```

`board.js` が、入力されたときだけ各 `[data-path]` の後ろに «開く» と «URL をコピー» を生やす。未入力・script 停止時は path の文字だけが見える。入力値は端末に保存され、次の board でも最初から入っている。保存できない環境（file:// 等）でも入力と URL 生成は動く。

## 弱い文字

補足・脇の説明は `class="mut"`。部品ごとに薄い色を直接書かない。

## 見た目を変えるとき

色・面・寸法は `tokens.css` の token だけを差し替える（明暗とも。差し替えたら `check-contrast.py` を回す）。文字階調・本文幅の組版 token は `board.css` 先頭。個別部品に直接書かない。強調・選択肢カード・塗りの規則は `../render-html-common.md` が正で、kit 固有の判断（推奨は塗らない・帯は薄く・tabular-nums など）は各 CSS の該当箇所にコメントで書いてある。

## v2 部品系（2026-08-19 確定 — ui-sample.html が実物見本）

ユーザとの往復で確定した設計の第 2 版。**新しい board の見た目はこちらを正とする。** `board.css` / `deck.css`（組版と回答フォーム機構）も 2026-08-19 に v2 の token・面モデル（bg / paper / fill の 3 面）へ移行済み（ticket 260819-072511）。色・面の基準は tokens.css にしか無く、board.css / deck.css は token を定義しない。

| ファイル | 中身 |
|---|---|
| `tokens.css` | 確定 palette（明暗・font・寸法・color-scheme）。**基準はここにしか無い** |
| `primitives.css` | 見本ページ（ui-sample.html）の土台と部品の CSS。共有部品（steps / tl / compare / quote / fig / mermaid-svg / details.fold / toc）は board.css へ移動済みで、ここには無い |
| `page.js` | 文書版のページ機構（目次開閉・決定論 scroll-spy・h2 の stuck 検出）。見本専用ではなく文書版 board でも使う。picker・目次が無いページでは各機構が自動で何もしない |
| `beautiful-mermaid.iife.js` | mermaid renderer（esbuild で依存ごと bundle 済み。global: `BeautifulMermaid`） |
| `mermaid-render.js` | `pre.mermaid` を token 色で描画。テーマ変更で再描画。失敗時はソース表示 + console.error |
| `check-contrast.py` | token の APCA 検査。**tokens.css を書き換えたら必ず回す**（exit 0 が合格） |
| `ui-sample.html` | 全部品の実物見本（mermaid bundle は未挿入 — 下記の手順で差し込む） |

### v2 の設計規則（部品を足すとき・値を触るとき）

- 幅と色は token のみ。色 literal は `grep -nE '#[0-9a-fA-F]{3,6}' primitives.css board.css deck.css`（0 件が正）、幅 literal は `grep -nE '[0-9]px' primitives.css` で検査できる形を保つ（board.css / deck.css の px は罫線幅など既存の組版値で常時ヒットするため色だけを見る）
- container は列幅いっぱいが既定。`--measure` を当てるのは散文（p / li / dd と説明テキスト）だけ。熟読される要素ほど measure に寄せ、一覧・比較する要素（表・段組・色見本）は広く使う
- `--line` は装飾ではなく**形状の輪郭**（Lc 25〜30）。面の段差（bg/paper）は控えめのまま輪郭が形を担う
- 表を使うのはセルが語・数値・1 句で終わる列挙だけ。語+説明は facts、案の比較は compare（セル 1 文まで）
- 節は `<section id>` で包む — h2 の sticky が節内に閉じ、アンカーの宛先は静的な section 側に置く（sticky 要素へ飛ぶと停泊位置に着地する）
- form 部品（textarea / input）は色を継承しない。`color` を token で明示し、`color-scheme` も tokens 側が持つ
- SVG を手描きするときも色は `style="fill:var(--…)"` で token 参照（presentation attribute では var() が効かない）
- **回答機構は board.js（か、それに準ずる検証済みの機構）を使い、その場で自作しない。**自作するなら 2 点を必ず守る: ①回答文は選択・メモと**連動して生成**する（静的テンプレは「選んだのに反映されない」になる — 2026-08-19 に実際に起きた）。②コピーは `execCommand('copy')` を先に使う — artifact host は Permissions Policy で `navigator.clipboard` を塞ぎ、**reject は promise で返るので try/catch では捕まらない**。最後の劣化は「全選択 + ⌘C の案内」

### mermaid の差し込み

図がある board だけ、`</body>` 直前（回答フォームの script より前）へ順に inline する:

```text
<script>beautiful-mermaid.iife.js の中身</script>
<script>mermaid-render.js の中身</script>
```

分岐・依存は mermaid ソース（`pre.mermaid`）で書く。手描き SVG は固定図だけ。⚠ bundle は必ずこの IIFE 版を使う — 上流 dist は `entities` を bare import しており、 inline すると module 解決エラーで**丸ごと沈黙する**（node では動くので気づけない）。
