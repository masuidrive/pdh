#!/usr/bin/env bash
# Brief の形は、stage 入口と単独検査で同じ結果になる。
set -eu
root=${PDH_TEST_ROOT:?}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/scripts" "$tmp/.claude/skills" "$tmp/tickets/sample"
cp "$root/scripts/pdh-stage-checklist.sh" "$tmp/scripts/"
cp -R "$root/.claude/skills/pdh-ticket-write" "$root/.claude/skills/pdh-brief-writing" "$tmp/.claude/skills/"
printf '## Status: PDH-ticket-write\n\n## Checklist\n' > "$tmp/tickets/sample/note.md"
cd "$tmp"
for kind in valid missing empty placeholder nondigit alternate; do
  printf '## Failure Tolerance\n- 使う人と量: 本人\n- 許さない失敗: 記録の喪失\n' > product-brief.md
  expected=1
  case "$kind" in
    valid) printf '%s\n' '- 許す失敗の目安: 月1回、本人1分' >> product-brief.md; expected=0 ;;
    empty) printf '%s\n' '- 許す失敗: ' >> product-brief.md ;;
    placeholder) printf '%s\n' '- 許す失敗: <月1回>' >> product-brief.md ;;
    nondigit) printf '%s\n' '- 許す失敗: 稀に本人の短時間' >> product-brief.md ;;
    alternate) printf '%s\n' '- 許す失敗: 月２回、本人１分' >> product-brief.md; expected=0 ;;
  esac
  for entry in check enter; do
    cp tickets/sample/note.md before
    rc=0
    if [ "$entry" = check ]; then
      bash .claude/skills/pdh-brief-writing/scripts/check-brief.sh product-brief.md > out 2>&1 || rc=$?
    else
      bash scripts/pdh-stage-checklist.sh PDH-ticket-write --enter tickets/sample/note.md > out 2>&1 || rc=$?
    fi
    [ "$rc" -eq "$expected" ] || { cat out; exit 1; }
    if [ "$expected" -ne 0 ]; then
      grep -q '許す失敗' out
      cmp before tickets/sample/note.md
    fi
    printf 'PASS: AC2 %s %s exit=%s\n' "$entry" "$kind" "$rc"
  done
done
