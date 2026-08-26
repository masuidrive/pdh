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
    # nvm is optional; sourcing it only supplies node when the parent shell did not.
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
  PYTHONDONTWRITEBYTECODE=1 python3 "$TOOLS_DIR/build.py" \
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

for fixture in good broken-a broken-d broken-h broken-i broken-j; do
  build_fixture "$fixture"
done

PYTHONDONTWRITEBYTECODE=1 python3 - "$TOOLS_DIR/build.py" "$FIXTURES_DIR" <<'PY'
import importlib.util
from pathlib import Path
import sys

module_path = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("decision_board_build", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
source = '<p title="A。"><b>X</b>。 A。 B&#12290;</p><code>A。</code><pre>A。</pre><img src="pixel.svg" alt="x">'
once, _ = module.transform_body(source, Path(sys.argv[2]), True)
twice, _ = module.transform_body(once, Path(sys.argv[2]), True)
assert once == twice
assert 'title="A。"' in once
assert '<b>X</b>\u2060。' in once
assert 'A\u2060。' in once
assert 'B\u2060&#12290;' in once
assert '<code>A。</code>' in once and '<pre>A。</pre>' in once
assert 'data:image/svg+xml;base64,' in once
PY
echo "PASS build: 自己完結化・text node 禁則・冪等性"

if run_check good; then
  echo "PASS good: A〜K"
else
  echo "FAIL good: check.js が成功しませんでした" >&2
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

echo "PASS selftest"
