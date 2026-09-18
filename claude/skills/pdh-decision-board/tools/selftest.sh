#!/usr/bin/env bash
# build.sh と check-static.sh を、反証 fixture で確かめる。
# 標準の shell 道具だけで走る（bash / awk / grep / sed）。
set -euo pipefail

TOOLS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FIXTURES_DIR="$TOOLS_DIR/fixtures"
SELFTEST_TMP=$(mktemp -d)
trap 'rm -rf "$SELFTEST_TMP"' EXIT

build_fixture() {
  local name=$1
  "$TOOLS_DIR/build.sh" \
    --body "$FIXTURES_DIR/$name.html" \
    --out "$SELFTEST_TMP/$name.html" \
    >"$SELFTEST_TMP/$name.build.stdout" \
    2>"$SELFTEST_TMP/$name.build.stderr"
}

for fixture in good broken-j broken-static-tag broken-static-reference broken-static-table broken-toc-anchor; do
  build_fixture "$fixture"
done

awk '
  { source = source $0 "\n" }
  END {
    if (index(source, "data-inline-source=\"tokens.css\"") == 0) exit 1
    if (index(source, "data-inline-source=\"board.css\"") == 0) exit 1
    if (index(source, "data-inline-source=\"page.js\"") == 0) exit 1
    if (index(source, "data-inline-source=\"board.js\"") == 0) exit 1
    if (index(source, "data:image/svg+xml;base64,") == 0) exit 1
    if (index(source, "\342\201\240") != 0) exit 1
  }
' "$SELFTEST_TMP/good.html"
"$TOOLS_DIR/build.sh" --body "$FIXTURES_DIR/good.html" --out "$SELFTEST_TMP/deck.html" --layout deck >/dev/null 2>&1
awk '
  { source = source $0 "\n" }
  END {
    a = index(source, "data-inline-source=\"tokens.css\"")
    b = index(source, "data-inline-source=\"board.css\"")
    c = index(source, "data-inline-source=\"deck.css\"")
    d = index(source, "data-inline-source=\"deck.js\"")
    e = index(source, "data-inline-source=\"board.js\"")
    exit !(a < b && b < c && c < d && d < e)
  }
' "$SELFTEST_TMP/deck.html"
printf '%s\n' '<main class="board"><img src="missing.png" alt="x"></main>' > "$SELFTEST_TMP/missing-image.html"
if "$TOOLS_DIR/build.sh" --body "$SELFTEST_TMP/missing-image.html" --out "$SELFTEST_TMP/should-not-build.html" >/dev/null 2>&1; then
  echo 'FAIL build: 読めない相対画像を受理しました' >&2
  exit 1
fi
echo 'PASS build.sh: document/deck・画像・不要文字なし'

# 埋め込みが argv の長さ上限で壊れないことを確かめる。fixture は commit せずここで作る
# — 配布物を重くしないためで、必要なのは «大きさ» だけなので中身は何でもよい。
large_dir=$SELFTEST_TMP/large
mkdir -p "$large_dir"
awk 'BEGIN {
  for (i = 0; i < 64; i++) line = line "PDHLARGEIMAGEPAYLOAD"
  for (n = 0; n < 100; n++) print line
}' > "$large_dir/large.png"
printf '%s\n' '<main class="board"><h2 id="a">大きい画像</h2><img src="large.png" alt="argv の上限を超える大きさ"></main>' \
  > "$large_dir/body.html"
if ! "$TOOLS_DIR/build.sh" --body "$large_dir/body.html" --out "$SELFTEST_TMP/large.html" \
  >/dev/null 2>"$SELFTEST_TMP/large.build.stderr"; then
  echo 'FAIL build: argv の上限を超える画像で失敗しました' >&2
  cat "$SELFTEST_TMP/large.build.stderr" >&2
  exit 1
fi
if grep -qF '__PDH_INLINE_IMAGE_' "$SELFTEST_TMP/large.html"; then
  echo 'FAIL build: 置換前の token が出力に残りました' >&2
  exit 1
fi
# BSD の base64 は位置引数を取らないので、build.sh と同じく stdin から読む
large_expected=$(base64 < "$large_dir/large.png" | awk '{ printf "%s", $0 }')
large_actual=$(awk '
  {
    at = index($0, "data:image/png;base64,")
    if (at == 0) next
    rest = substr($0, at + 22)
    if (match(rest, /^[A-Za-z0-9+\/=]+/)) print substr(rest, 1, RLENGTH)
    exit
  }
' "$SELFTEST_TMP/large.html")
if [[ "$large_actual" != "$large_expected" ]]; then
  echo 'FAIL build: 埋め込まれた base64 が元の画像と一致しません' >&2
  exit 1
fi
echo 'PASS build.sh: argv の上限を超える画像を丸ごと埋め込む'

if "$TOOLS_DIR/check-static.sh" "$SELFTEST_TMP/good.html" > "$SELFTEST_TMP/good.static"; then
  echo 'PASS good: check-static.sh'
else
  echo 'FAIL good: check-static.sh が成功しませんでした' >&2
  cat "$SELFTEST_TMP/good.static" >&2
  exit 1
fi

sed 's/class="fig"/class="static-undefined"/' "$SELFTEST_TMP/good.html" > "$SELFTEST_TMP/broken-static-class.html"
sed 's|data:image/svg+xml;base64,[A-Za-z0-9+/=]*|data:image/svg+xml;base64,!|' \
  "$SELFTEST_TMP/good.html" > "$SELFTEST_TMP/broken-static-image.html"

expected_for() {
  case $1 in
    broken-static-tag)       echo 'タグの均衡' ;;
    broken-static-class)     echo '未定義 class' ;;
    broken-static-reference) echo 'ページ内参照' ;;
    broken-toc-anchor)       echo 'ページ内参照' ;;
    broken-static-image)     echo '画像' ;;
    broken-j)                echo '回答フォームの属性' ;;
    broken-static-table)     echo '裸の表' ;;
  esac
}

for fixture in broken-static-tag broken-static-class broken-static-reference \
  broken-static-image broken-j broken-static-table broken-toc-anchor; do
  if "$TOOLS_DIR/check-static.sh" "$SELFTEST_TMP/$fixture.html" > "$SELFTEST_TMP/$fixture.static"; then
    echo "FAIL $fixture: 壊した fixture が成功しました" >&2
    cat "$SELFTEST_TMP/$fixture.static" >&2
    exit 1
  fi
  expected=$(expected_for "$fixture")
  if ! grep -q "^FAIL $expected :: " "$SELFTEST_TMP/$fixture.static"; then
    echo "FAIL $fixture: $expected で失敗しませんでした" >&2
    cat "$SELFTEST_TMP/$fixture.static" >&2
    exit 1
  fi
  if [[ $(grep -c '^FAIL ' "$SELFTEST_TMP/$fixture.static") -ne 1 ]]; then
    echo "FAIL $fixture: 狙っていない静的検査も失敗しました" >&2
    cat "$SELFTEST_TMP/$fixture.static" >&2
    exit 1
  fi
  echo "PASS $fixture: static $expected を反証"
done

# to-markdown.sh — HTML の board から経路へ貼る Markdown を作る。
# 守るのは「本文が 1 つであること」。Markdown を書かせず HTML から機械で作るので、
# 落ちると «Markdown を手で書く» へ戻り、2 つの本文がずれ始める。
if sh "$TOOLS_DIR/to-markdown.sh" "$SELFTEST_TMP/good.html" > "$SELFTEST_TMP/good.md" 2>"$SELFTEST_TMP/good.md.err"; then
  md_bad=0
  # HTML の残骸が無いこと（details / summary だけは GitHub が描くので残す）
  if grep -qE '<(div|span|section|main|label|aside|figure|input|button|textarea|svg|nav|style|script)' "$SELFTEST_TMP/good.md"; then
    echo 'FAIL to-markdown: HTML の残骸が出ました' >&2; grep -nE '<(div|span|section|main|label|aside|figure|input|button|textarea|svg|nav|style|script)' "$SELFTEST_TMP/good.md" | head -5 >&2; md_bad=1
  fi
  # 見出しが Markdown になっていること
  grep -q '^#\{1,4\} ' "$SELFTEST_TMP/good.md" || { echo 'FAIL to-markdown: 見出しが出ませんでした' >&2; md_bad=1; }
  grep -q '^#### ' "$SELFTEST_TMP/good.md" || { echo 'FAIL to-markdown: h4 の階層が落ちました' >&2; md_bad=1; }
  # 表が GFM になっていること（区切り行がある）
  if grep -q '^| ' "$SELFTEST_TMP/good.md"; then
    grep -q '^| --- ' "$SELFTEST_TMP/good.md" || { echo 'FAIL to-markdown: 表の区切り行がありません' >&2; md_bad=1; }
  fi
  # URL を渡したら先頭の 1 行目に出ること（ユーザ指示 2026-09-18「url は最上位に出す」）
  sh "$TOOLS_DIR/to-markdown.sh" "$SELFTEST_TMP/good.html" --url 'https://example.invalid/b' \
    | head -1 | grep -q 'https://example.invalid/b' \
    || { echo 'FAIL to-markdown: --url が先頭に出ませんでした' >&2; md_bad=1; }
  # callout → GitHub Alerts（GFM が枠と色で描く）。段落に落とすと «注意» の意味が消える。
  printf '%s\n' '<main class="board">' '<div class="callout warn"><span class="lab">気をつけること</span><p>本番に出ます。</p></div>' '<div class="callout ok"><p>通りました。</p></div>' '</main>' > "$SELFTEST_TMP/callout.html"
  sh "$TOOLS_DIR/to-markdown.sh" "$SELFTEST_TMP/callout.html" > "$SELFTEST_TMP/callout.md"
  grep -q '^> \[!WARNING\]' "$SELFTEST_TMP/callout.md" || { echo 'FAIL to-markdown: callout.warn が alert になりません' >&2; md_bad=1; }
  grep -q '^> \[!TIP\]'     "$SELFTEST_TMP/callout.md" || { echo 'FAIL to-markdown: callout.ok が alert になりません' >&2; md_bad=1; }
  grep -q '^> \*\*気をつけること\*\*' "$SELFTEST_TMP/callout.md" || { echo 'FAIL to-markdown: callout の見出しが引用の中に入りません' >&2; md_bad=1; }
  # 行内の強調と用語の列挙。⚠ `**出ません。**触った` は GitHub が記号ごと素で出す
  # （CommonMark の flanking 規則。2026-09-18 に実測）。句読点は強調の外へ出す。
  printf '%s\n' '<main class="board">' \
    '<p>前<strong>出ません。</strong>触った。<em>「注」</em>です</p>' \
    '<dl class="facts"><dt>用語</dt><dd>説明の文</dd></dl>' \
    '<p><a class="answer-jump" href="#answer-summary">回答欄へ進む</a></p>' '</main>' > "$SELFTEST_TMP/inline.html"
  sh "$TOOLS_DIR/to-markdown.sh" "$SELFTEST_TMP/inline.html" > "$SELFTEST_TMP/inline.md"
  grep -q '前\*\*出ません\*\*。触った。' "$SELFTEST_TMP/inline.md" || { echo 'FAIL to-markdown: 強調の閉じの直前の句読点が外へ出ません' >&2; md_bad=1; }
  grep -q '「\*注\*」です'            "$SELFTEST_TMP/inline.md" || { echo 'FAIL to-markdown: 強調の開きの直後の括弧が外へ出ません' >&2; md_bad=1; }
  grep -q '^\*\*用語\*\*\\$'          "$SELFTEST_TMP/inline.md" || { echo 'FAIL to-markdown: dt が太字の行になりません' >&2; md_bad=1; }
  grep -q '^説明の文$'                 "$SELFTEST_TMP/inline.md" || { echo 'FAIL to-markdown: dd が説明の行になりません' >&2; md_bad=1; }
  if grep -q 'answer-summary' "$SELFTEST_TMP/inline.md"; then echo 'FAIL to-markdown: 回答欄へのリンクが残っています' >&2; md_bad=1; fi
  [ "$md_bad" -eq 0 ] || { cat "$SELFTEST_TMP/callout.md" "$SELFTEST_TMP/inline.md" >&2; exit 1; }
  echo 'PASS to-markdown.sh: Markdown へ落とす（表・畳み・alert・mermaid・強調・dl）'
else
  echo 'FAIL to-markdown.sh: 変換に失敗しました' >&2
  cat "$SELFTEST_TMP/good.md.err" >&2
  exit 1
fi

if bash "$TOOLS_DIR/../kit/check-contrast.sh" >"$SELFTEST_TMP/contrast.out" 2>&1; then
  echo 'PASS check-contrast.sh: tokens.css'
else
  echo 'FAIL check-contrast.sh: tokens.css が基準を満たしませんでした' >&2
  cat "$SELFTEST_TMP/contrast.out" >&2
  exit 1
fi
sed 's/--muted:#5c6672/--muted:#f0f0f0/' "$TOOLS_DIR/../kit/tokens.css" > "$SELFTEST_TMP/broken-tokens.css"
if bash "$TOOLS_DIR/../kit/check-contrast.sh" "$SELFTEST_TMP/broken-tokens.css" >/dev/null 2>&1; then
  echo 'FAIL check-contrast.sh: 壊した palette が合格しました' >&2
  exit 1
fi
echo 'PASS check-contrast.sh: 壊した palette を反証'

echo 'PASS selftest'
