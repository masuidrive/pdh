#!/usr/bin/env bash
# spawn-worker.sh --wait が、待ち時間 0 でも «終わった worker» と «走っている worker» を見分けることを確かめる。
# 再開するとき（skill pdh-resume）は --wait <dir> 0 で worker の状態を 1 回だけ見るため。
set -uo pipefail
root=${PDH_TEST_ROOT:?}
sw="$root/scripts/spawn-worker.sh"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "NG: $1 (want $2, got $3)"; fail=1; fi; }

bash "$sw" "$t/done" -- true >/dev/null
for _ in $(seq 1 50); do [ -f "$t/done/rc.txt" ] && break; sleep 0.1; done
out="$(bash "$sw" --wait "$t/done" 0)"; rc=$?
check "終わった worker を --wait 0 で DONE と返す" 0 "$rc"
check "DONE の行に rc を出す" "DONE rc=0" "$out"

bash "$sw" "$t/run" -- sleep 30 >/dev/null
bash "$sw" --wait "$t/run" 0 >/dev/null; rc=$?
check "走っている worker を --wait 0 で 75 と返す" 75 "$rc"
kill "$(cat "$t/run/pid.txt")" 2>/dev/null
mkdir -p "$t/manual"
printf '0\n' > "$t/manual/rc"
out="$(bash "$sw" --wait "$t/manual" 0)"; rc=$?
check "手動 launch の rc を読む" 0 "$rc"
check "手動 launch を DONE と返す" 'DONE rc=0' "$out"
out="$(bash "$sw" --wait "$t/missing" 0 2>&1)"; rc=$?
check "存在しない dir は入力エラー" 66 "$rc"
exit $fail
