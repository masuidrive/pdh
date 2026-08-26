# 判断ボードの組み立てと壊れ検査

body 断片を自己完結 HTML に組み立て、その完成物に内容非依存の壊れがないかを調べる opt-in の道具です。`kit/README.md` の「組み立てと検査は kit の外」という境界に従い、kit は CSS / JS のまま、組み立てと検査はこの `tools/` が持ちます。

## 使い方

文書版の body 断片は `<main class="board" …>…</main>`、デッキ版は `<div class="deck" …>…</div>` を含めます。

```bash
python3 tools/build.py --body body.html --out board.html --config board.json
node tools/check.js board.html --config board.json --out results.json
```

`--config` と `--out`（check 側）は省略できます。build は埋め込んだ kit ファイル名と、data URI に変えた画像のファイル名を stderr に出します。相対 `img src` は `png` / `jpg` / `jpeg` / `gif` / `svg` / `webp` だけを受け、読めない画像や未対応形式では出力を止めます。

`href` は画像として埋め込みません。kit の画面写真 overlay と文書部品は `href="#…"` を、script が止まっていても働くページ内移動・開閉として使うためです。

全検査と反証 fixture をまとめて確かめるには次を実行します。

```bash
PLAYWRIGHT_ROOT=/path/to/node_modules/playwright bash tools/selftest.sh
```

通常の shell から `node` が見えない場合、selftest は nvm も探します。別の Node を明示する場合は `NODE=/path/to/node` を渡せます。

## 設定

build と check は同じ JSON を読めます。各コマンドは自分が使うキーだけを参照します。

| キー | 使用側 | 既定値 | 意味 |
|---|---|---|---|
| `lang` | build / check | `"ja"` | `<html lang>`。`ja` で始まるときだけ禁則の挿入・検査を行う |
| `layout` | build / check | `"document"` | `"document"` または `"deck"`。読み込む kit を切り替える |
| `title` | build | 最初の h1、無ければ `"判断ボード"` | `<title>` の文字列 |
| `assets_dir` | build | body ファイルのディレクトリ | 相対画像を探す起点 |
| `mermaid` | build | `false` | bundle と render script を board.js より前へ inline する |
| `kit_dir` | build | `build.py` から見た `../kit` | kit の起点 |
| `widths` | check | `[380, 390, 1440]` | ブラウザ検査に使う幅 |

config に書いた相対 `assets_dir` / `kit_dir` は config ファイルのディレクトリを起点に解決します。config が無い場合、`assets_dir` は body のディレクトリです。

## Playwright

check は Node と Playwright を使います。Playwright の解決順は次のとおりです。

1. `require('playwright')`
2. `PLAYWRIGHT_ROOT` が指す package path
3. `--playwright <path>`

どれにも無ければ exit 2 で、導入または path 指定の方法を表示します。新規に用意する場合の例です。

```bash
npm install playwright
npx playwright install chromium
```

## 検査と反証

検査は A〜K に限定しています。B / C / E / F / G / K は実行中に故意の壊れを挿入し、その壊れを検出できなければ検査自体を fail にします。A / D / H / I / J は `fixtures/broken-*.html` を selftest が組み立て、狙った検査名で落ちることを確かめます。

| 文字 | 検査 | 反証 |
|---|---|---|
| A | page error | `broken-a.html` |
| B | ページ本体の横 overflow | 実行時に幅広要素を挿入 |
| C | `.table-wrap` 内の横 scroll | 実行時に overflow 設定を壊した表を挿入 |
| D | 明示的な閉じタグが要るタグの均衡 | `broken-d.html` |
| E | 使用 class に対応する inline CSS selector | 実行時に未定義 class を挿入 |
| F | 画像の読み込みと alt | 実行時に壊れた data URI 画像を挿入 |
| G | ページ内参照の宛先 | 実行時に存在しない id への参照を挿入 |
| H | 明暗の背景と `--bg` | `broken-h.html` |
| I | details の内容・marker・開いた状態の overflow | `broken-i.html` |
| J | 回答フォームの DOM 契約と実操作 | `broken-j.html` |
| K | 日本語の行頭禁則 | 実行時に行頭約物を挿入 |

回答フォームの `[data-q]` が無い board では J を「この board には回答フォームが無い」と記録して skip します。`lang` が `ja` で始まらない場合は K を skip します。skip は壊れではないため exit status を失敗にしません。

## この道具が検査しないもの

構造・数・節の有無・行数は検査しません。判断ボードの形は案件ごとに違うので、道具が基準を持つと誤検知になるためです。節、カード、AC、判断、決定サマリー、見出しなどの個数や有無は、出力にも含めません。

唯一の例外は、明示的な閉じタグが要るタグの開始・終了の均衡です。不一致の場合もタグ名と差だけを出し、タグの総数は出しません。
