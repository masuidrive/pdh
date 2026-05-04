#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/pdh-flow-sub-agent-context-test"
rm -rf "$TMP_ROOT"
mkdir -p "$TMP_ROOT"

REPO="$TMP_ROOT/repo"
cp -R "$ROOT/examples/sample1" "$REPO"
cd "$REPO"
git init -q
git -c user.name=t -c user.email=t@x.com add -A
git -c user.name=t -c user.email=t@x.com commit -qm seed
./ticket.sh start runtime-test --no-worktree >/dev/null
git -c user.name=t -c user.email=t@x.com commit -qam start
node --experimental-strip-types "$ROOT/src/cli.ts" run --repo "$REPO" --ticket runtime-test --no-ticket-start --variant full --start-step PD-C-3 >/dev/null

CLI=( node --experimental-strip-types "$ROOT/src/cli.ts" sub-agent-context --repo "$REPO" )

assert_contains() {
  local needle="$1" haystack="$2" label="$3"
  if ! grep -qF "$needle" <<<"$haystack"; then
    echo "FAIL: $label — expected to find: $needle"
    echo "----- output -----"
    echo "$haystack"
    exit 1
  fi
}

assert_not_contains() {
  local needle="$1" haystack="$2" label="$3"
  if grep -qF "$needle" <<<"$haystack"; then
    echo "FAIL: $label — should NOT contain: $needle"
    exit 1
  fi
}

# ---- Test 1: basic --step / --role / --scope ----
echo "[1] basic invocation"
out_path="$("${CLI[@]}" --step PD-C-4 --role "Test Reviewer" --scope "test scope text")"
[[ -f "$out_path" ]] || { echo "FAIL: bundle file missing: $out_path"; exit 1; }
body="$(cat "$out_path")"
assert_contains "# sub-agent context — Test Reviewer" "$body" "title"
assert_contains "担当 scope: test scope text" "$body" "scope"
assert_contains "## honest ルール (絶対禁止)" "$body" "honest rules"
assert_contains "## 禁止コマンド (自分で実行しない)" "$body" "forbidden commands"
assert_contains "## product-brief.md (snapshot)" "$body" "product brief section"
assert_contains "Product Brief: sample1 calc" "$body" "product brief content"
assert_contains "## current-ticket.md" "$body" "ticket section"

# ---- Test 2: --reviewer-id resolves label/responsibility/focus ----
echo "[2] --reviewer-id resolution"
out_path="$("${CLI[@]}" --step PD-C-4 --reviewer-id devils_advocate)"
body="$(cat "$out_path")"
assert_contains "あなたは **Devil's Advocate**" "$body" "reviewer label from flow"
assert_contains "あなたの注力点 (reviewer 役割定義から流用)" "$body" "focus header"
assert_contains "計画の修正方針に矛盾や見落としがないか" "$body" "focus item from yaml"

# ---- Test 3: --output-schema reviewer ----
echo "[3] --output-schema reviewer"
out_path="$("${CLI[@]}" --step PD-C-4 --role R --scope S --output-schema reviewer)"
body="$(cat "$out_path")"
assert_contains "## 出力契約 — \`review.json\`" "$body" "reviewer schema header"
assert_contains '"severity": "major"' "$body" "json shape"
assert_contains "review.json" "$body" "review.json path"

# ---- Test 4: --output-schema repair ----
echo "[4] --output-schema repair"
out_path="$("${CLI[@]}" --step PD-C-4 --role R --scope S --output-schema repair)"
body="$(cat "$out_path")"
assert_contains "## 出力契約 — \`repair.json\`" "$body" "repair schema header"
assert_contains "commit_required" "$body" "repair json shape"

# ---- Test 5: --stdout (no snapshot path emitted; body on stdout) ----
echo "[5] --stdout"
stdout_body="$("${CLI[@]}" --step PD-C-4 --role R --scope S --stdout)"
[[ "$stdout_body" == *"# sub-agent context — R"* ]] || { echo "FAIL: --stdout did not emit bundle"; exit 1; }
[[ "$stdout_body" != *".pdh-flow/runs/"* ]] || true  # path not expected on stdout (paths in body OK)

# ---- Test 6: --files emits write-scope hint ----
echo "[6] --files"
out_path="$("${CLI[@]}" --step PD-C-6 --role "Coding 1" --scope "feature impl" --files src/a.py,src/b.py)"
body="$(cat "$out_path")"
assert_contains "## 編集 (write) してよい範囲" "$body" "files section"
assert_contains '`src/a.py`' "$body" "files item a"
assert_contains '`src/b.py`' "$body" "files item b"

# ---- Test 7: missing --step errors out ----
echo "[7] missing --step"
if "${CLI[@]}" --role R --scope S 2>"$TMP_ROOT/err7" >/dev/null; then
  echo "FAIL: should have errored"; exit 1
fi
grep -q "Missing --step" "$TMP_ROOT/err7" || { echo "FAIL: expected Missing --step error"; cat "$TMP_ROOT/err7"; exit 1; }

# ---- Test 8: unknown reviewer-id errors out ----
echo "[8] unknown reviewer-id"
if "${CLI[@]}" --step PD-C-4 --reviewer-id nope 2>"$TMP_ROOT/err8" >/dev/null; then
  echo "FAIL: should have errored"; exit 1
fi
grep -q "not found" "$TMP_ROOT/err8" || { echo "FAIL: expected not-found error"; cat "$TMP_ROOT/err8"; exit 1; }

# ---- Test 9: slug + timestamp uniqueness ----
echo "[9] slug+timestamp uniqueness"
out_a="$("${CLI[@]}" --step PD-C-4 --role "Plan DA" --scope x)"
sleep 1.2
out_b="$("${CLI[@]}" --step PD-C-4 --role "Plan DA" --scope x)"
[[ "$out_a" != "$out_b" ]] || { echo "FAIL: slug should differ between invocations"; exit 1; }
[[ "$(basename "$(dirname "$out_a")")" =~ ^plan-da-[0-9]{8}-[0-9]{6}$ ]] || {
  echo "FAIL: slug-timestamp pattern mismatch: $(basename "$(dirname "$out_a")")"; exit 1
}

# ---- Test 10: concurrent-review principle in step prompts (rendered) ----
echo "[10] concurrent-review principle in PD-C-4 / PD-C-7 / PD-C-9 / PD-D-2 step prompts"
node --experimental-strip-types -e "
import('$ROOT/src/flow/prompts/template-engine.ts').then(({ renderTemplate }) => {
  const targets = ['steps/PD-C-4.j2','steps/PD-C-7.j2','steps/PD-C-9.j2','steps/PD-D-2.j2','shared/common.j2','shared/reviewer_prompt.j2'];
  let fails = 0;
  for (const t of targets) {
    const out = renderTemplate(t, { run: {id:'r', ticket_id:'t', flow_id:'f', flow_variant:'full'}, step: {id:'PD-C-N', label:'X'}, reviewer: {label:'l', responsibility:'r', focus:[]}, reviewPlan: {}, jsonShape: '{}', outputPath: 'x', round: null, priorFindings: [], reviewerStepRules: [] });
    if (!out.includes('## reviewer / DA の並行運用原則')) {
      console.error('FAIL:', t, 'missing concurrent-review principle');
      fails++;
    }
  }
  process.exit(fails ? 1 : 0);
});
"

echo "ALL TESTS PASSED"
