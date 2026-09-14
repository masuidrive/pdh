#!/usr/bin/env bash
# check-pdh-ticket.sh — ticket dir の受け渡し記録を、agent の申告に依らず確かめる。
# scripts/test-all.sh の 1 段として走る（PDH-implement の出口と PDH-verify で回る）。
#
#   1. tickets/<name>/ticket.md ごとに progress.md がある（経緯は progress.md へ）
#   2. note の Status が human gate なら、Checklist に «発行先:» を含む未了行がある
#      （PDH-AGENTS.md「Handover Routes」）
#
# 追記のみの検査は ticket.sh の append_only_files（check / close）が担う。
# bash / awk / grep / sed だけ。BSD / GNU 両対応。tickets/done/ は見ない。
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

failed=0
seen=0

for t in tickets/*/ticket.md; do
  [ -f "$t" ] || continue
  seen=1
  d=${t%/ticket.md}

  if [ ! -f "$d/progress.md" ]; then
    printf 'check-pdh-ticket: %s/progress.md が無い（経緯は progress.md へ。1 行目は "# Progress: <ticket-name>"）\n' "$d" >&2
    failed=1
  fi

  n="$d/note.md"
  [ -f "$n" ] || continue
  st=$(grep -m1 '^## Status:' "$n" | sed -E 's/^## Status:[[:space:]]*(PDH-[a-z-]+).*/\1/')
  case "$st" in
    PDH-ticket-human-review|PDH-human-review)
      if ! awk '/^## Checklist/{f=1;next} /^## /{f=0} f' "$n" | grep -Eq '^- \[ \].*発行先:.*(https?://|/)'; then
        printf 'check-pdh-ticket: %s は %s なのに、Checklist に «発行先:» + URL か path の未了行が無い（何の答えを待つかと発行先の URL か path を 1 行書く）\n' "$n" "$st" >&2
        failed=1
      fi ;;
  esac
done

if [ "$failed" -ne 0 ]; then
  printf 'check-pdh-ticket: FAILED\n' >&2
  exit 1
fi
if [ "$seen" -eq 0 ]; then
  printf 'check-pdh-ticket: open ticket なし\n'
else
  printf 'check-pdh-ticket: progress.md あり・gate の待ち行あり\n'
fi
