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

for fixture in good broken-j broken-static-tag broken-static-reference broken-static-table; do
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
    broken-static-image)     echo '画像' ;;
    broken-j)                echo '回答フォームの属性' ;;
    broken-static-table)     echo '裸の表' ;;
  esac
}

for fixture in broken-static-tag broken-static-class broken-static-reference \
  broken-static-image broken-j broken-static-table; do
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

# measure.sh — 境目が主線を縮めること、増加を打ち切ること
cp "$FIXTURES_DIR/pixel.svg" "$SELFTEST_TMP/"
sed 's|<section class="answer-set"|<section data-backing class="answer-set"|' \
  "$FIXTURES_DIR/good.html" > "$SELFTEST_TMP/backing.html"
"$TOOLS_DIR/build.sh" --body "$SELFTEST_TMP/backing.html" --out "$SELFTEST_TMP/backing.built.html" >/dev/null 2>&1
whole=$(bash "$TOOLS_DIR/measure.sh" "$SELFTEST_TMP/good.html" 2>/dev/null | awk '/主線の量/ { print $2 }')
cut=$(bash "$TOOLS_DIR/measure.sh" "$SELFTEST_TMP/backing.built.html" | awk '/主線の量/ { print $2 }')
if [ "$cut" -ge "$whole" ]; then
  echo "FAIL measure.sh: data-backing が主線を縮めませんでした（$whole -> $cut）" >&2
  exit 1
fi
if ! bash "$TOOLS_DIR/measure.sh" "$SELFTEST_TMP/good.html" 2>/dev/null | grep -q '判断の数 N: 1'; then
  echo 'FAIL measure.sh: data-q を 1 件と数えませんでした（埋め込み CSS/JS を拾っている）' >&2
  exit 1
fi
if bash "$TOOLS_DIR/measure.sh" "$SELFTEST_TMP/good.html" --prev 1 >/dev/null 2>&1; then
  echo 'FAIL measure.sh: 主線が増えたのに打ち切りませんでした' >&2
  exit 1
fi
echo 'PASS measure.sh: 境目・判断数・打ち切り'

echo 'PASS selftest'
