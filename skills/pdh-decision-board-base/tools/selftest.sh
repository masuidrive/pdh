#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FIXTURES_DIR="$TOOLS_DIR/fixtures"
SELFTEST_TMP=$(mktemp -d)
trap 'rm -rf "$SELFTEST_TMP"' EXIT

NODE_BIN=${NODE:-}
if [[ -z "$NODE_BIN" ]] && command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
fi
if [[ -z "$NODE_BIN" ]]; then
  NVM_SCRIPT="${NVM_DIR:-${HOME}/.nvm}/nvm.sh"
  if [[ -r "$NVM_SCRIPT" ]]; then
    # shellcheck disable=SC1090
    source "$NVM_SCRIPT" >/dev/null 2>&1
    NODE_BIN=$(command -v node || true)
  fi
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "FAIL selftest: node が見つかりません。NODE=/path/to/node を指定してください。" >&2
  exit 1
fi

build_fixture() {
  local name=$1
  "$TOOLS_DIR/build.sh" \
    --body "$FIXTURES_DIR/$name.html" \
    --out "$SELFTEST_TMP/$name.html" \
    >"$SELFTEST_TMP/$name.build.stdout" \
    2>"$SELFTEST_TMP/$name.build.stderr"
}

run_check() {
  local name=$1
  local config_args=()
  if [[ "$name" != good ]]; then
    config_args=(--config "$FIXTURES_DIR/selftest.json")
  fi
  set +e
  "$NODE_BIN" "$TOOLS_DIR/check.js" "$SELFTEST_TMP/$name.html" "${config_args[@]}" \
    >"$SELFTEST_TMP/$name.check" 2>&1
  local status=$?
  set -e
  return "$status"
}

for fixture in good broken-a broken-d broken-h broken-i broken-j \
  broken-static-tag broken-static-reference broken-static-table; do
  build_fixture "$fixture"
done

mawk '
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
mawk '
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

if run_check good; then
  echo 'PASS good: check.js A〜J'
else
  echo 'FAIL good: check.js が成功しませんでした' >&2
  cat "$SELFTEST_TMP/good.check" >&2
  exit 1
fi

declare -A EXPECTED=(
  [broken-a]='A. page error'
  [broken-d]='D. タグの均衡'
  [broken-h]='H. テーマ'
  [broken-i]='I. details'
  [broken-j]='J. 回答フォームの DOM 契約'
)

for fixture in broken-a broken-d broken-h broken-i broken-j; do
  if run_check "$fixture"; then
    echo "FAIL $fixture: 壊した fixture が成功しました" >&2
    cat "$SELFTEST_TMP/$fixture.check" >&2
    exit 1
  fi
  expected=${EXPECTED[$fixture]}
  if ! grep -Fqx "FAIL $expected" "$SELFTEST_TMP/$fixture.check"; then
    echo "FAIL $fixture: $expected で失敗しませんでした" >&2
    cat "$SELFTEST_TMP/$fixture.check" >&2
    exit 1
  fi
  if grep '^FAIL ' "$SELFTEST_TMP/$fixture.check" | grep -Fvx "FAIL $expected" >/dev/null; then
    echo "FAIL $fixture: 狙っていない検査も失敗しました" >&2
    cat "$SELFTEST_TMP/$fixture.check" >&2
    exit 1
  fi
  echo "PASS $fixture: $expected を反証"
done

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

declare -A STATIC_EXPECTED=(
  [broken-static-tag]='タグの均衡'
  [broken-static-class]='未定義 class'
  [broken-static-reference]='ページ内参照'
  [broken-static-image]='画像'
  [broken-j]='回答フォームの属性'
  [broken-static-table]='裸の表'
)

for fixture in broken-static-tag broken-static-class broken-static-reference \
  broken-static-image broken-j broken-static-table; do
  if "$TOOLS_DIR/check-static.sh" "$SELFTEST_TMP/$fixture.html" > "$SELFTEST_TMP/$fixture.static"; then
    echo "FAIL $fixture: 壊した fixture が成功しました" >&2
    cat "$SELFTEST_TMP/$fixture.static" >&2
    exit 1
  fi
  expected=${STATIC_EXPECTED[$fixture]}
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

echo 'PASS selftest'
