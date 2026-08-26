# 判断ボードの組み立てと壊れ検査

body 断片を自己完結 HTML に組み立て、その完成物に内容非依存の壊れがないかを調べる opt-in の道具です。`kit/README.md` の「組み立てと検査は kit の外」という境界に従い、kit は CSS / JS のまま、組み立てと検査はこの `tools/` が持ちます。

**動くのに要るのは shell だけです** — `bash` / `awk` / `grep` / `sed` と、macOS・Ubuntu に既定で入っている道具。Node も Playwright も Python も使いません。

## 使い方

文書版の body 断片は `<main class="board" …>…</main>`、デッキ版は `<div class="deck" …>…</div>` を含めます。

```bash
tools/build.sh --body body.html --out board.html
tools/check-static.sh board.html
```

build は埋め込んだ kit ファイル名と、data URI に変えた画像の有無を stderr に出します。相対 `img src` は `png` / `jpg` / `jpeg` / `gif` / `svg` / `webp` だけを受け、読めない画像や未対応形式では出力を止めます。

`href` は画像として埋め込みません。kit の画面写真 overlay と文書部品は `href="#…"` を、script が止まっていても働くページ内移動・開閉として使うためです。

道具そのものと反証 fixture をまとめて確かめるには次を実行します。

```bash
bash tools/selftest.sh
```

## build の引数

build は JSON 設定を読みません。

| 引数 | 既定値 | 意味 |
|---|---|---|
| `--body` | 必須 | body 断片 |
| `--out` | 必須 | 完成 HTML の出力先 |
| `--kit` | `build.sh` から見た `../kit` | kit の起点 |
| `--lang` | `ja` | `<html lang>` |
| `--layout` | `document` | `document` または `deck`。読み込む kit を切り替える |
| `--title` | 最初の h1、無ければ `判断ボード` | `<title>` の文字列 |

相対画像は body ファイルのディレクトリを起点に解決します。

## 検査と反証

`check-static.sh` は `main.board` 内だけを対象に、次を調べます。ブラウザを起動しません。

| 検査 | 反証 |
|---|---|
| 明示的な閉じタグが要るタグの均衡 | `fixtures/broken-static-tag.html` |
| 使用 class に対応する inline CSS selector | `good.html` の class 名を selftest が壊す |
| ページ内参照の宛先 | `fixtures/broken-static-reference.html` |
| 画像の data URI（base64 として復号できるか） | `good.html` の payload を selftest が壊す |
| 回答フォームの属性 | `fixtures/broken-j.html` |
| `.table-wrap` に包まれていない裸の表 | `fixtures/broken-static-table.html` |

`selftest.sh` は、壊した fixture が**狙った検査名だけで**落ちることを確かめます。落ちなければ selftest 自体が失敗します。あわせて `build.sh`（文書版・デッキ版の埋め込み順、画像、不要文字）と `kit/check-contrast.sh`（token の APCA 検査。正常な `tokens.css` が通り、暗くした palette が落ちること）も確かめます。

**描画そのものは、組み上げた板をブラウザで開いて確かめます。**横 overflow、明暗テーマ、details の開閉、回答フォームの実操作は `render-html-common.md` の共通検査が持ちます。

## この道具が検査しないもの

節・カード・AC・判断・見出しの数や有無は、検査にも出力にも入れません（板の形は案件ごとに違うため）。例外はタグの均衡だけで、それも不一致のタグ名と差しか出しません。

## 読む量を測る

`measure.sh` は、板の **判断の数 `N`・主線の面数・主線の量（byte）**を出します。

```bash
bash tools/measure.sh board.html
bash tools/measure.sh board.html --prev 8900   # 増えていたら exit 1
```

主線と裏付けの境目は、HTML では**最初の `data-backing` 属性**、Markdown では**本文が「裏付け」で始まる見出し行**です。境目が無い板は全体を主線として測り、そのことを警告します。埋め込んだ kit の CSS / JS は数えません。

**なぜ byte か** — 周をまたいで比べるための単位なので、awk の実装や locale で揺れないことだけが要ります。使い方は [final-check.md](../final-check.md)「量の門」が定めます。
