#!/usr/bin/env bash
# Tests for the resource lease registry (src/runtime/leases.ts +
# src/cli/lease.ts). Exercises the CLI surface end-to-end on a tmp git
# repo; no real providers, no network.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/src/cli/index.ts"
TMP_ROOT="${TMP_ROOT:-${TMPDIR:-/tmp}/pdh-flow-lease-tests}"
rm -rf "$TMP_ROOT"
mkdir -p "$TMP_ROOT"

pass=0
fail=0

note() {
  printf '\033[1;34m[lease-test]\033[0m %s\n' "$*"
}
ok() {
  pass=$((pass + 1))
  printf '\033[1;32m  ok\033[0m %s\n' "$*"
}
bad() {
  fail=$((fail + 1))
  printf '\033[1;31m  FAIL\033[0m %s\n' "$*"
}

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  if [ "$expected" = "$actual" ]; then
    ok "$label ($actual)"
  else
    bad "$label: expected '$expected', got '$actual'"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  case "$haystack" in
    *"$needle"*) ok "$label" ;;
    *) bad "$label: '$needle' not found in: $haystack" ;;
  esac
}

# Build a clean fixture repo with the given pdh-flow.config.yaml content.
make_repo() {
  local name="$1" config="$2"
  local repo="$TMP_ROOT/$name"
  mkdir -p "$repo/tickets"
  (
    cd "$repo"
    git init -q
    git -c user.name=test -c user.email=t@t.t commit -q --allow-empty -m seed
  )
  if [ -n "$config" ]; then
    printf '%s\n' "$config" > "$repo/pdh-flow.config.yaml"
  fi
  printf '%s\n' "$repo"
}

# Add a ticket file in active state (started_at/closed_at empty).
make_ticket() {
  local repo="$1" id="$2"
  cat > "$repo/tickets/$id.md" <<MD
---
priority: 1
description: "test ticket $id"
created_at: "2026-05-07T00:00:00Z"
started_at:
closed_at:
---

## $id
MD
}

# Move a ticket into tickets/done/ to simulate close.
close_ticket() {
  local repo="$1" id="$2"
  mkdir -p "$repo/tickets/done"
  mv "$repo/tickets/$id.md" "$repo/tickets/done/$id.md"
}

cli() {
  node "$CLI" "$@"
}

# Extract a JSON field with a small Python helper (jq is not assumed).
# Pass the path as a sequence of keys, e.g.: json_path leases 0 value
PY_JSON_PATH='import json,sys
d=json.load(sys.stdin)
for k in sys.argv[1:]:
    d=d[int(k)] if k.lstrip("-").isdigit() else d[k]
print(d)'

json_path() {
  python3 -c "$PY_JSON_PATH" "$@"
}

# ---------------------------------------------------------------------------
# Case 1: single acquire returns expected leases + writes .env.lease
# ---------------------------------------------------------------------------
note "case 1: single acquire writes .env.lease"
CONFIG_BASIC='version: 1
leases:
  pools:
    port:
      kind: port
      range: [5170, 5172]
      env: PORT
    db-name:
      kind: name
      template: "pdh_{slug-hash}"
      env: DB_NAME'
repo="$(make_repo case1 "$CONFIG_BASIC")"
make_ticket "$repo" ticket-a

out="$(cli lease acquire --ticket ticket-a --repo "$repo" --worktree "$repo")"
assert_eq "5170" "$(printf '%s' "$out" | json_path leases 0 value)" "case1: port=5170"
assert_eq "PORT" "$(printf '%s' "$out" | json_path leases 0 env)" "case1: env=PORT"
assert_contains "$(cat "$repo/.env.lease")" "PORT=5170" "case1: env file has PORT=5170"
assert_contains "$(cat "$repo/.env.lease")" "DB_NAME=pdh_" "case1: env file has DB_NAME=pdh_*"

# ---------------------------------------------------------------------------
# Case 2: idempotency — repeat acquire returns same value, doesn't allocate
# ---------------------------------------------------------------------------
note "case 2: idempotent acquire"
out2="$(cli lease acquire --ticket ticket-a --repo "$repo" --worktree "$repo")"
assert_eq "5170" "$(printf '%s' "$out2" | json_path leases 0 value)" "case2: still 5170"
list_out="$(cli lease list --repo "$repo")"
n_leases="$(printf '%s' "$list_out" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["leases"]))')"
assert_eq "2" "$n_leases" "case2: still 2 leases (port + name)"

# ---------------------------------------------------------------------------
# Case 3: second ticket gets distinct port
# ---------------------------------------------------------------------------
note "case 3: second ticket gets next port"
make_ticket "$repo" ticket-b
out3="$(cli lease acquire --ticket ticket-b --repo "$repo" --worktree "$repo")"
b_port="$(printf '%s' "$out3" | json_path leases 0 value)"
assert_eq "5171" "$b_port" "case3: ticket-b port=5171"

# ---------------------------------------------------------------------------
# Case 4: release frees port for reuse
# ---------------------------------------------------------------------------
note "case 4: release + reuse"
cli lease release --ticket ticket-a --repo "$repo" --worktree "$repo" >/dev/null
make_ticket "$repo" ticket-c
out4="$(cli lease acquire --ticket ticket-c --repo "$repo" --worktree "$repo")"
c_port="$(printf '%s' "$out4" | json_path leases 0 value)"
assert_eq "5170" "$c_port" "case4: ticket-c reclaims 5170"

# ---------------------------------------------------------------------------
# Case 5: pool exhaustion → non-zero exit
# ---------------------------------------------------------------------------
note "case 5: pool exhaustion"
# Pool is [5170, 5172] = 3 slots. We have ticket-b (5171) + ticket-c (5170) ; one slot left.
make_ticket "$repo" ticket-d
cli lease acquire --ticket ticket-d --repo "$repo" --worktree "$repo" >/dev/null
make_ticket "$repo" ticket-e
set +e
err_out="$(cli lease acquire --ticket ticket-e --repo "$repo" --worktree "$repo" 2>&1)"
err_code=$?
set -e
if [ "$err_code" -ne 0 ]; then
  ok "case5: exit non-zero on exhaustion ($err_code)"
else
  bad "case5: expected non-zero exit on exhaustion"
fi
assert_contains "$err_out" "exhausted" "case5: error mentions 'exhausted'"

# ---------------------------------------------------------------------------
# Case 6: gc reclaims dead-pid + missing-worktree entries
# ---------------------------------------------------------------------------
note "case 6: gc reclaims orphans"
repo6="$(make_repo case6 "$CONFIG_BASIC")"
make_ticket "$repo6" ticket-x
cli lease acquire --ticket ticket-x --repo "$repo6" --worktree "$repo6" >/dev/null
# Manually rewrite the lease so it looks owned by a dead pid + missing worktree.
python3 - "$repo6/.pdh-flow/leases.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as fh:
  data = json.load(fh)
for entry in data["leases"]:
  entry["pid"] = 1  # init: alive but not ours; combined with missing worktree triggers gc
  entry["worktree"] = "/tmp/this-path-does-not-exist-pdh-test"
# Note: pid=1 is alive, so gc by pid+worktree won't fire. We fake it harder:
# put a syntactically dead pid.
for entry in data["leases"]:
  entry["pid"] = 999999
with open(path, "w") as fh:
  json.dump(data, fh)
PY
gc_out="$(cli lease gc --repo "$repo6")"
n_reclaimed="$(printf '%s' "$gc_out" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["reclaimed"]))')"
if [ "$n_reclaimed" -ge 1 ]; then
  ok "case6: gc reclaimed $n_reclaimed orphan(s)"
else
  bad "case6: expected gc to reclaim >=1 orphan, got 0. gc output: $gc_out"
fi

# ---------------------------------------------------------------------------
# Case 7: closing a ticket (move to done/) auto-reclaims on next acquire
# ---------------------------------------------------------------------------
note "case 7: closed-ticket auto-reclaim"
repo7="$(make_repo case7 "$CONFIG_BASIC")"
make_ticket "$repo7" t1
make_ticket "$repo7" t2
cli lease acquire --ticket t1 --repo "$repo7" --worktree "$repo7" >/dev/null
out_t1="$(cli lease list --ticket t1 --repo "$repo7")"
t1_port="$(printf '%s' "$out_t1" | json_path leases 0 value)"
assert_eq "5170" "$t1_port" "case7: t1 acquired 5170"

close_ticket "$repo7" t1
out_t2="$(cli lease acquire --ticket t2 --repo "$repo7" --worktree "$repo7")"
t2_port="$(printf '%s' "$out_t2" | json_path leases 0 value)"
# t1's port should be reclaimed by gc-during-acquire, so t2 takes 5170.
assert_eq "5170" "$t2_port" "case7: t2 reclaims t1's 5170 after t1 closed"

# ---------------------------------------------------------------------------
# Case 8: no config → no-op (no error, no .env.lease)
# ---------------------------------------------------------------------------
note "case 8: no config no-ops"
repo8="$(make_repo case8 "")"
make_ticket "$repo8" lone
out8="$(cli lease acquire --ticket lone --repo "$repo8" --worktree "$repo8")"
n_lone="$(printf '%s' "$out8" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["leases"]))')"
assert_eq "0" "$n_lone" "case8: empty leases"
if [ ! -f "$repo8/.env.lease" ]; then
  ok "case8: no .env.lease written"
else
  bad "case8: .env.lease should not exist"
fi

# ---------------------------------------------------------------------------
# Case 9: concurrent acquire — 16 parallel processes get distinct ports
# ---------------------------------------------------------------------------
note "case 9: 16 parallel acquires get distinct ports"
CONFIG_WIDE='version: 1
leases:
  pools:
    port:
      kind: port
      range: [6000, 6020]
      env: PORT'
repo9="$(make_repo case9 "$CONFIG_WIDE")"
for i in $(seq 1 16); do
  make_ticket "$repo9" "ticket-$i"
done
# Spawn all 16 acquire calls in parallel, capture each port to a file.
mkdir -p "$TMP_ROOT/case9-results"
for i in $(seq 1 16); do
  (
    out="$(cli lease acquire --ticket "ticket-$i" --repo "$repo9" --worktree "$repo9" 2>&1)"
    printf '%s\n' "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["leases"][0]["value"])' \
      > "$TMP_ROOT/case9-results/$i.port"
  ) &
done
wait
# Concat all ports, sort uniq.
all_ports="$(cat "$TMP_ROOT/case9-results/"*.port | sort -n)"
n_total="$(printf '%s\n' "$all_ports" | wc -l | tr -d ' ')"
n_unique="$(printf '%s\n' "$all_ports" | sort -u | wc -l | tr -d ' ')"
assert_eq "16" "$n_total" "case9: 16 ports allocated"
assert_eq "16" "$n_unique" "case9: all 16 are unique"

# ---------------------------------------------------------------------------
echo
note "summary: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
