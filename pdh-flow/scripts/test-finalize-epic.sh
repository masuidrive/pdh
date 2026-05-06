#!/usr/bin/env bash
# Tests for `pdh-flow finalize-epic` and `pdh-flow cancel-epic`.
#
# Each test sets up a fresh tmp git repo, runs the CLI, and asserts on
# the resulting state (file moves, frontmatter, commits, branches).
# No real providers are spawned; this exercises only git + the WASM
# screenshot pipeline.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/pdh-flow-finalize-epic-tests"
PDH_FLOW_BIN=(node "$ROOT/src/cli.ts")

rm -rf "$TMP_ROOT"
mkdir -p "$TMP_ROOT"

GIT="git -c user.name=pdh-test -c user.email=pdh-test@example.invalid -c init.defaultBranch=main"

failures=0
PASS_COUNT=0
FAIL_COUNT=0

ok()    { printf "ok   %s\n" "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail()  { printf "FAIL %s — %s\n" "$1" "$2"; FAIL_COUNT=$((FAIL_COUNT + 1)); failures=$((failures + 1)); }

assert_file_exists() {
  if [ ! -e "$1" ]; then
    fail "$3" "expected file to exist: $1 ($2)"
    return 1
  fi
  return 0
}

assert_file_missing() {
  if [ -e "$1" ]; then
    fail "$3" "expected file to be missing: $1 ($2)"
    return 1
  fi
  return 0
}

assert_grep() {
  if ! grep -qE "$2" "$1"; then
    fail "$4" "expected pattern '$2' in $1 ($3)"
    return 1
  fi
  return 0
}

# ----------------------------------------------------------------
# Test 1: close epic with branch=main (most common standalone case)
# ----------------------------------------------------------------
test_close_main_direct() {
  local name="close-main-direct"
  local repo="$TMP_ROOT/$name"
  rm -rf "$repo"
  mkdir -p "$repo/epics" "$repo/tickets/done"
  cd "$repo"
  $GIT init -q
  cat > epics/foo.md <<'EOF'
---
title: Foo
branch: main
created_at: 2026-05-01T00:00:00Z
---

### Outcome
test
EOF
  cat > tickets/done/done-ticket.md <<'EOF'
---
priority: 2
epic: foo
base_branch: default
closed_at: 2026-05-02T00:00:00Z
---

### Why
done
EOF
  $GIT add .
  $GIT commit -q -m "seed"

  if ! "${PDH_FLOW_BIN[@]}" finalize-epic --epic foo --repo "$repo" --dry-run --no-push >/tmp/finalize-test-out 2>&1; then
    fail "$name" "dry-run failed: $(cat /tmp/finalize-test-out)"
    return
  fi
  if ! grep -q "Preflight: OK" /tmp/finalize-test-out; then
    fail "$name" "dry-run did not show Preflight: OK; output: $(cat /tmp/finalize-test-out)"
    return
  fi

  if ! "${PDH_FLOW_BIN[@]}" finalize-epic --epic foo --repo "$repo" --no-push >/tmp/finalize-test-out 2>&1; then
    fail "$name" "close failed: $(cat /tmp/finalize-test-out)"
    return
  fi
  assert_file_missing "$repo/epics/foo.md" "epic file should have moved" "$name" || return
  assert_file_exists "$repo/epics/done/foo/index.md" "epic should be at done/<slug>/index.md" "$name" || return
  assert_grep "$repo/epics/done/foo/index.md" "closed_at:" "frontmatter should have closed_at" "$name" || return
  if [ "$(cd "$repo" && git log --pretty=%s -1)" != "Close epic foo" ]; then
    fail "$name" "expected last commit subject 'Close epic foo', got: $(cd "$repo" && git log --pretty=%s -1)"
    return
  fi
  ok "$name"
}

# ----------------------------------------------------------------
# Test 2: close blocked by open linked ticket
# ----------------------------------------------------------------
test_close_blocked_by_open_ticket() {
  local name="close-blocked-open-ticket"
  local repo="$TMP_ROOT/$name"
  rm -rf "$repo"
  mkdir -p "$repo/epics" "$repo/tickets"
  cd "$repo"
  $GIT init -q
  cat > epics/foo.md <<'EOF'
---
title: Foo
branch: main
---
EOF
  cat > tickets/open-ticket.md <<'EOF'
---
priority: 2
epic: foo
base_branch: default
---

### Why
still working
EOF
  $GIT add .
  $GIT commit -q -m "seed"

  if "${PDH_FLOW_BIN[@]}" finalize-epic --epic foo --repo "$repo" --dry-run --no-push >/tmp/finalize-test-out 2>&1; then
    fail "$name" "dry-run with open ticket should have exited non-zero"
    return
  fi
  if ! grep -q "still has 1 open ticket" /tmp/finalize-test-out; then
    fail "$name" "blocker message not found; output: $(cat /tmp/finalize-test-out)"
    return
  fi
  ok "$name"
}

# ----------------------------------------------------------------
# Test 3: close epic with branch=epic/<slug> (squash-merge path)
# ----------------------------------------------------------------
test_close_epic_branch() {
  local name="close-epic-branch"
  local repo="$TMP_ROOT/$name"
  rm -rf "$repo"
  mkdir -p "$repo/epics"
  cd "$repo"
  $GIT init -q
  echo "# placeholder" > placeholder.md
  $GIT add .
  $GIT commit -q -m "seed"

  $GIT switch -c epic/bar -q
  cat > epics/bar.md <<'EOF'
---
title: Bar
branch: epic/bar
created_at: 2026-05-01T00:00:00Z
---
EOF
  mkdir -p tickets/done
  cat > tickets/done/closed-bar.md <<'EOF'
---
priority: 2
epic: bar
base_branch: epic/bar
closed_at: 2026-05-02T00:00:00Z
---
EOF
  $GIT add .
  $GIT commit -q -m "epic bar work"

  $GIT switch main -q

  if ! "${PDH_FLOW_BIN[@]}" finalize-epic --epic bar --repo "$repo" --no-push >/tmp/finalize-test-out 2>&1; then
    fail "$name" "close failed: $(cat /tmp/finalize-test-out)"
    return
  fi
  assert_file_exists "$repo/epics/done/bar/index.md" "epic file should be on main after squash merge" "$name" || return
  assert_grep "$repo/epics/done/bar/index.md" "closed_at:" "frontmatter has closed_at" "$name" || return
  if [ "$(cd "$repo" && git log --pretty=%s -1)" != "Close epic bar" ]; then
    fail "$name" "expected last commit 'Close epic bar', got: $(cd "$repo" && git log --pretty=%s -1)"
    return
  fi
  if cd "$repo" && git rev-parse --verify refs/heads/epic/bar >/dev/null 2>&1; then
    fail "$name" "epic/bar branch should have been deleted locally"
    return
  fi
  ok "$name"
}

# ----------------------------------------------------------------
# Test 4: cancel epic with branch=main
# ----------------------------------------------------------------
test_cancel_main_direct() {
  local name="cancel-main-direct"
  local repo="$TMP_ROOT/$name"
  rm -rf "$repo"
  mkdir -p "$repo/epics"
  cd "$repo"
  $GIT init -q
  cat > epics/baz.md <<'EOF'
---
title: Baz
branch: main
---

### Outcome
to be cancelled
EOF
  $GIT add .
  $GIT commit -q -m "seed"

  if ! "${PDH_FLOW_BIN[@]}" cancel-epic --epic baz --repo "$repo" --reason "out of scope" --no-push >/tmp/finalize-test-out 2>&1; then
    fail "$name" "cancel failed: $(cat /tmp/finalize-test-out)"
    return
  fi
  assert_file_missing "$repo/epics/baz.md" "epic file should be moved" "$name" || return
  assert_file_exists "$repo/epics/done/baz/index.md" "cancelled epic should be at done/" "$name" || return
  assert_grep "$repo/epics/done/baz/index.md" "cancelled_at:" "frontmatter has cancelled_at" "$name" || return
  assert_grep "$repo/epics/done/baz/index.md" "out of scope" "cancel_reason should be in frontmatter" "$name" || return
  ok "$name"
}

# ----------------------------------------------------------------
# Test 5: dirty working tree blocks operation
# ----------------------------------------------------------------
test_close_blocked_by_dirty_tree() {
  local name="close-blocked-dirty-tree"
  local repo="$TMP_ROOT/$name"
  rm -rf "$repo"
  mkdir -p "$repo/epics"
  cd "$repo"
  $GIT init -q
  cat > epics/qux.md <<'EOF'
---
title: Qux
branch: main
---
EOF
  $GIT add .
  $GIT commit -q -m "seed"
  echo "scribble" > unrelated.txt  # dirty

  if "${PDH_FLOW_BIN[@]}" finalize-epic --epic qux --repo "$repo" --dry-run --no-push >/tmp/finalize-test-out 2>&1; then
    fail "$name" "dry-run with dirty tree should have failed"
    return
  fi
  if ! grep -q "Working tree is dirty" /tmp/finalize-test-out; then
    fail "$name" "expected 'Working tree is dirty' in output; got: $(cat /tmp/finalize-test-out)"
    return
  fi
  ok "$name"
}

# ----------------------------------------------------------------
# Test 6: WASM smoke — encode a small PNG via screenshot.ts
# ----------------------------------------------------------------
test_wasm_smoke() {
  local name="wasm-screenshot-smoke"
  local out
  # Run from pdh-flow root so node can resolve @jsquash from node_modules.
  out=$(cd "$ROOT" && node --input-type=module \
    -e 'import { writeFileSync, readFileSync } from "node:fs";
        import { fileURLToPath } from "node:url";
        const orig = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          const url = typeof input === "string" ? input : input?.url ?? String(input);
          if (url.startsWith("file://")) {
            return new Response(readFileSync(fileURLToPath(url)), { status: 200, headers: { "content-type": "application/wasm" }});
          }
          return orig(input, init);
        };
        const { default: pngEncode } = await import("@jsquash/png/encode.js");
        const w=400, h=300;
        const px=new Uint8ClampedArray(w*h*4);
        for (let i=0;i<px.length;i+=4){px[i]=200; px[i+1]=80; px[i+2]=160; px[i+3]=255;}
        const png = await pngEncode({data: px, width: w, height: h, colorSpace: "srgb"});
        writeFileSync("/tmp/finalize-wasm-smoke.png", Buffer.from(png));

        const { optimizeScreenshot } = await import("./src/runtime/screenshot.ts");
        const stats = await optimizeScreenshot("/tmp/finalize-wasm-smoke.png", "/tmp/finalize-wasm-smoke.webp", { quality: 80, maxSide: 1280 });
        const buf = readFileSync("/tmp/finalize-wasm-smoke.webp");
        const riff = buf.subarray(0,4).toString("ascii");
        const fmt = buf.subarray(8,12).toString("ascii");
        console.log(JSON.stringify({ srcBytes: stats.srcBytes, destBytes: stats.destBytes, riff, fmt }));
        ' 2>&1)
  if ! echo "$out" | grep -q '"riff":"RIFF"' ; then
    fail "$name" "no RIFF header; output: $out"
    return
  fi
  if ! echo "$out" | grep -q '"fmt":"WEBP"' ; then
    fail "$name" "no WEBP fourcc; output: $out"
    return
  fi
  ok "$name"
}

# ---------------- run ----------------

test_close_main_direct
test_close_blocked_by_open_ticket
test_close_epic_branch
test_cancel_main_direct
test_close_blocked_by_dirty_tree
test_wasm_smoke

if [ "$failures" -gt 0 ]; then
  printf "\n%d failed (%d passed)\n" "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf "\nfinalize-epic tests passed (%d)\n" "$PASS_COUNT"
