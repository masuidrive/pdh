#!/usr/bin/env bash
# 判断ボード kit の描画検査。**PDH repo 自身の検査であり、配布物ではない。**
#
# kit（board.css / board.js / deck.css / deck.js / page.js）を変えたときに回す。
# 配布先は kit を変えないので、この検査を配る必要はない。配布しないため
# product-brief の AI-4（配布物の実行依存は標準的な Unix 環境に入っているものだけ）
# の対象外で、Node と Playwright を使ってよい（scripts/check-links.py と同じ扱い）。
#
# 依存: node 18+ と playwright。無い場合の入れ方は下の使い方に出る。
# usage: bash scripts/check-board-render.sh
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
KIT_TOOLS="$ROOT/skills/pdh-decision-board/tools"
SHIPPED_FIXTURES="$KIT_TOOLS/fixtures"
OWN_FIXTURES="$ROOT/scripts/board-check/fixtures"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

NODE_BIN=${NODE:-$(command -v node || true)}
if [ -z "$NODE_BIN" ]; then
  echo "check-board-render: node が見つかりません。NODE=/path/to/node を渡してください。" >&2
  exit 2
fi
if ! "$NODE_BIN" -e "require.resolve('playwright')" >/dev/null 2>&1 \
   && [ -z "${PLAYWRIGHT_ROOT:-}" ]; then
  cat >&2 <<'MSG'
check-board-render: playwright が見つかりません。次のどちらかで用意してください。

  npm install playwright && npx playwright install chromium
  PLAYWRIGHT_ROOT=/path/to/node_modules/playwright bash scripts/check-board-render.sh
MSG
  exit 2
fi

build() {   # $1 = fixture 名, $2 = fixture の置き場
  "$KIT_TOOLS/build.sh" --body "$2/$1.html" --out "$TMP/$1.html" >/dev/null 2>&1
}
run_check() {   # $1 = fixture 名, $2 = --config を付けるか
  local args=()
  [ "$2" = "config" ] && args=(--config "$OWN_FIXTURES/selftest.json")
  set +e
  "$NODE_BIN" "$ROOT/scripts/board-check/check.js" "$TMP/$1.html" "${args[@]}" \
    >"$TMP/$1.out" 2>&1
  local st=$?
  set -e
  return "$st"
}

# good / broken-j は配布側の fixture を使う（shell 検査と同じものを見る）
cp "$SHIPPED_FIXTURES/pixel.svg" "$OWN_FIXTURES/" 2>/dev/null || true
build good "$SHIPPED_FIXTURES"
build broken-j "$SHIPPED_FIXTURES"
for f in broken-a broken-d broken-h broken-i; do build "$f" "$OWN_FIXTURES"; done
rm -f "$OWN_FIXTURES/pixel.svg"

if run_check good plain; then
  echo 'PASS good: check.js A〜J'
else
  echo 'FAIL good: check.js が成功しませんでした' >&2; cat "$TMP/good.out" >&2; exit 1
fi

expected_for() {
  case $1 in
    broken-a) echo 'A. page error' ;;
    broken-d) echo 'D. タグの均衡' ;;
    broken-h) echo 'H. テーマ' ;;
    broken-i) echo 'I. details' ;;
    broken-j) echo 'J. 回答フォームの DOM 契約' ;;
  esac
}
for f in broken-a broken-d broken-h broken-i broken-j; do
  if run_check "$f" config; then
    echo "FAIL $f: 壊した fixture が成功しました" >&2; cat "$TMP/$f.out" >&2; exit 1
  fi
  want=$(expected_for "$f")
  if ! grep -Fqx "FAIL $want" "$TMP/$f.out"; then
    echo "FAIL $f: $want で失敗しませんでした" >&2; cat "$TMP/$f.out" >&2; exit 1
  fi
  if grep '^FAIL ' "$TMP/$f.out" | grep -Fvx "FAIL $want" >/dev/null; then
    echo "FAIL $f: 狙っていない検査も失敗しました" >&2; cat "$TMP/$f.out" >&2; exit 1
  fi
  echo "PASS $f: $want を反証"
done

echo 'PASS check-board-render'
