#!/usr/bin/env bash
# pdh-stage-checklist.sh — PDH-stage のチェックリストを、その stage の skill から取り出す。
# この script の目的: stage のチェックリストの元を skill の 1 か所に置き、note には ticket ごとの写しを置くこと。
#
#   bash scripts/pdh-stage-checklist.sh <PDH-stage>                 # skill の «- [ ] <PDH-stage>: …» の行を出す
#   bash scripts/pdh-stage-checklist.sh <PDH-stage> --enter <note>  # stage に入るとき、note の ## Checklist へ写す
#   bash scripts/pdh-stage-checklist.sh --show [<note>]            # 現在の stage と未了の行を読む（変更しない）
#
# --enter は、note にある同じ stage の行（[ ]・[x]・[-] のどれでも）を消してから、skill の行を
# ## Checklist の末尾へ足す。同じ stage を 2 回目に通るときも、印を未了に戻して確かめ直すためである。
# 前に通ったときの証拠は progress に残る。⚠ 作業を再開するとき（pdh-resume）は実行しない — 済んだ印が消える。
# skill からその stage の行を取り出せないときは、note を変えずに 1 で終わる。
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

tickets_dir=$(awk '/^tickets_dir:/ {sub(/^tickets_dir:[[:space:]]*/, ""); sub(/[[:space:]]+#.*/, ""); gsub(/["\047]/, ""); sub(/[[:space:]]+$/, ""); print; exit}' "$root/.ticket-config.yaml" 2>/dev/null)
tickets_dir=${tickets_dir:-tickets}
tickets_dir=${tickets_dir%/}
tickets_dir=${tickets_dir#./}
stage=${1:-}
show=false
branch=''
if [ "$stage" = --show ]; then
  show=true
  note=${2:-}
  if [ -z "$note" ]; then
    branch=$(git -C "$root" symbolic-ref -q --short HEAD 2>/dev/null || true)
    prefix=features/
    if [ -f "$root/.ticket-config.yaml" ]; then
      # 設定が重複しているときは、最初の値で ticket を決めない。
      prefix=$(awk '
        /^branch_prefix:/ { sub(/^branch_prefix:[[:space:]]*/, ""); gsub(/["\047]/, ""); value=$1; n++ }
        END { if (n > 1) exit 1; print (n ? value : "features/") }
      ' "$root/.ticket-config.yaml") || prefix=$'\n'
    fi
    if [ -n "$branch" ] && [[ "$prefix" != *$'\n'* && "$branch" == "$prefix"* ]]; then
      ticket=${branch#"$prefix"}
      if [[ -n "$ticket" && "$ticket" != */* && "$ticket" != . && "$ticket" != .. ]]; then
        note="$root/$tickets_dir/$ticket/note.md"
      fi
    fi
  fi
  if [ -n "$branch" ] && { [ -z "$note" ] || [ ! -f "$note" ]; }; then
    for base in "$root/$tickets_dir" "$root/$tickets_dir/done"; do
      for candidate in "$base"/*/ticket.md; do
        [ -f "$candidate" ] || continue
        own=$(awk '
          NR == 1 {if ($0 != "---") exit; next}
          /^---[[:space:]]*$/ {exit}
          /^branch:/ {sub(/^branch:[[:space:]]*/, ""); sub(/[[:space:]]+#.*/, ""); sub(/[[:space:]]+$/, ""); if ($0 ~ /^".*"$/ || $0 ~ /^\047.*\047$/) $0=substr($0,2,length($0)-2); print; exit}
        ' "$candidate")
        if [ "$own" = "$branch" ] && [ -f "${candidate%/*}/note.md" ]; then
          note=${candidate%/*}/note.md
          break 2
        fi
      done
    done
  fi
  if [ -z "$note" ] || [ ! -f "$note" ]; then
    printf '%s\n' 'PDH の ticket は未確定（この worktree の branch に対応する note が無い）'
    exit 0
  fi
  status=$(awk '/^## Status:/ { sub(/^## Status:[[:space:]]*/, ""); print; exit }' "$note") || exit 1
  stage=$(printf '%s\n' "$status" | sed -n 's/^\(PDH-[A-Za-z0-9_-]*\).*/\1/p')
fi

# --show でも既存の stage → skill の対応を使う。
case "$stage" in
  PDH-ticket-write) skill=pdh-ticket-write ;;
  PDH-open) skill=pdh-open ;;
  PDH-ticket-review) skill=pdh-ticket-review ;;
  PDH-ticket-human-review|PDH-human-review) skill=pdh-pm ;;
  PDH-implement) skill=pdh-implement ;;
  PDH-review) skill=pdh-review ;;
  PDH-verify) skill=pdh-verify ;;
  PDH-close) skill=pdh-close ;;
  *)
    if "$show"; then
      printf 'ticket: %s\nStatus は PDH-stage ではない: %s\n' "$(basename "$(dirname "$note")")" "${status:-（無し）}" |
        python3 -c 'import sys; s=sys.stdin.read(); sys.stdout.write(s if len(s)<=1500 else s[:1498]+"…\n")'
      exit $?
    fi
    printf 'usage: %s <PDH-stage> [--enter <note>] | --show [<note>]（PDH-stage の名前が違う: %s）\n' "$0" "$stage" >&2; exit 2 ;;
esac
file=''
for d in .agents/skills; do
  [ -f "$root/$d/$skill/SKILL.md" ] && { file="$root/$d/$skill/SKILL.md"; break; }
done
[ -n "$file" ] || { printf 'pdh-stage-checklist: skill %s が見つからない\n' "$skill" >&2; exit 1; }

if "$show"; then
  # skill の案内を先に出し、長い checklist でも再開の手掛かりを残す。
  {
    printf 'ticket: %s\nStatus: %s\nPM が読む skill: %s\n未了の行:\n' "$(basename "$(dirname "$note")")" "$stage" "${file#"$root/"}"
    awk -v stage="$stage" '
      /^##? / { inside = ($0 ~ /^## Checklist[[:space:]]*$/) }
      inside && index($0, "- [ ] " stage ": ") == 1 { print; n++ }
      END { if (!n) print "（無し）" }
    ' "$note" || exit 1
  } | python3 -c 'import sys; s=sys.stdin.read(); sys.stdout.write(s if len(s)<=1500 else s[:1498]+"…\n")'
  exit $?
fi

lines=$(grep -E "^- \[ \] ${stage}: " "$file") || {
  rc=$?
  if [ "$rc" -eq 1 ]; then
    printf 'pdh-stage-checklist: %s のチェックリストの行が skill %s に無い\n' "$stage" "$file" >&2
  else
    printf 'pdh-stage-checklist: %s のチェックリストを skill %s から取り出せない（grep exit %s）\n' "$stage" "$file" "$rc" >&2
  fi
  exit 1
}

if [ "${2:-}" != --enter ]; then
  [ -n "$lines" ] && printf '%s\n' "$lines"
  exit 0
fi
note=${3:-}
[ -f "$note" ] || { printf 'pdh-stage-checklist: note が無い: %s\n' "$note" >&2; exit 2; }
grep -q '^## Checklist[[:space:]]*$' "$note" || { printf 'pdh-stage-checklist: %s に ## Checklist が無い\n' "$note" >&2; exit 1; }
tmp=$(mktemp) || exit 1
ADD="$lines" awk -v stage="$stage" '
  # ## Checklist の節を溜め、同じ stage の行を除き、末尾の空行の前に skill の行を足す。
  BEGIN { add = ENVIRON["ADD"] }
  function flush(   i, last) {
    last = n
    while (last > 0 && buf[last] ~ /^[[:space:]]*$/) last--
    for (i = 1; i <= last; i++) print buf[i]
    print add
    for (i = last + 1; i <= n; i++) print buf[i]
    n = 0; inside = 0
  }
  /^##? / {
    continuation = 0
    if (inside) flush()
    print
    if ($0 ~ /^## Checklist[[:space:]]*$/) inside = 1
    next
  }
  inside && index($0, "- [") == 1 && index($0, "] " stage ": ") == 5 { continuation=1; next }
  inside && continuation && /^[[:space:]]+[^[:space:]]/ { next }
  inside && $0 !~ /^[[:space:]]*$/ { continuation=0 }
  inside { buf[++n] = $0; next }
  { print }
  END { if (inside) flush() }
' "$note" > "$tmp" && mv "$tmp" "$note"

rc=$?
[ "$rc" -eq 0 ] || exit "$rc"
printf '%s\n' 'pdh-stage-checklist: 写した行は印と skip 理由以外を変えず、補足は次の行に書く（行の完全一致で検査する）' >&2
