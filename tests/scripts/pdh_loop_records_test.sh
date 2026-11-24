#!/usr/bin/env bash
set -eu
root=${PDH_TEST_ROOT:?}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR= GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
mkdir -p "$tmp/scripts" "$tmp/tickets/sample"
cp "$root/scripts/"{check-pdh-ticket,pdh-review-range,pdh-review-tally,pdh-stage-checklist}.sh "$tmp/scripts/"
cd "$tmp"
git init -q -b main
printf 'default_branch: main\nbranch_prefix: features/\n' > .ticket-config.yaml
for st in ticket-write open ticket-review ticket-human-review implement review verify human-review close; do
  skill=$st
  case "$st" in ticket-human-review|human-review) skill=pm ;; esac
  mkdir -p ".claude/skills/pdh-$skill"
  printf -- '- [ ] PDH-%s: 検査済み\n' "$st" >> ".claude/skills/pdh-$skill/SKILL.md"
done
cat > tickets/sample/ticket.md <<'EOF'
### Why
Reproduction-or-measurement: 実行記録
Why-not-fix-now: 該当なし
### What
- [ ] 結果を読む
EOF
hash=$(bash scripts/check-pdh-ticket.sh --ac-hash tickets/sample/ticket.md)
printf 'AC-approved: %s\n' "$hash" >> tickets/sample/ticket.md
git add .
git -c commit.gpgsign=false commit -qm initial
git checkout -qb features/sample
sha=$(git rev-parse HEAD)
note=tickets/sample/note.md
progress=tickets/sample/progress.md
make_note() {
  printf '## Status: PDH-%s\n\n## Checklist\n' "$1" > "$note"
  for st in ticket-write open ticket-review ticket-human-review implement review verify human-review close; do
    printf -- '- [x] PDH-%s: 検査済み\n' "$st" >> "$note"
  done
}
make_progress() {
  printf 'review-sha: %s\n### Findings-PDH-review-1\n| # | 要旨 | 頻度と 1 回のコスト | 判定 | 由来 |\n|---|---|---|---|---|\n' "$sha" > "$progress"
  for ((i=1;i<=$1;i++)); do printf '| %s | 欠陥 | 月1回・1分 | いま直す | 既存 |\n' "$i" >> "$progress"; done
}
expect() {
  local want=$1 label=$2 rc=0
  bash scripts/check-pdh-ticket.sh > output 2>&1 || rc=$?
  if [ "$rc" -ne "$want" ]; then printf 'FAIL %s exit=%s expected=%s\n' "$label" "$rc" "$want"; cat output; exit 1; fi
  printf 'PASS: %s exit=%s\n' "$label" "$rc"
}
make_note verify
printf '<!-- pdh-review-loop: 1 -->\n' >> "$note"
make_progress 7
expect 0 'AC4 threshold7'
make_progress 8
expect 1 'AC4 missing'
grep -q '処置の照らし直し: PDH-review-1 が無い' output
printf '\n処置の照らし直し: PDH-review-1 全件を基準で照合\n' >> "$progress"
expect 0 'AC4 recorded'
make_note review
printf '<!-- pdh-review-loop: 1 -->\n' >> "$note"
make_progress 8
expect 0 'AC4 before next round'
printf '\nreview-sha: 1234567\n' >> "$progress"
expect 1 'AC4 next round'
# 旧 note は同じ記録でも新しい検査を要求しない。
make_note review
expect 0 'AC8 old note'
printf '<!-- pdh-review-loop: 1 -->\n- [x] S8 PDH-review-1 PM が決めた: 構造を変える 覆す条件: 再発\n' >> "$note"
make_progress 1
expect 1 'AC6 missing'
printf '\n収束の選択: PDH-review-1 部品=保存 前の仮説=局所修正 外れ方=退行 次に変えるもの=責任の置き場 外れの条件=再発\n' >> "$progress"
expect 0 'AC6 recorded'
sed 's/前の仮説=局所修正/前の仮説=/' "$progress" > p; mv p "$progress"
expect 1 'AC6 empty field'
make_note close
make_progress 1
printf '\nclose-gate-sha: %s\n' "$sha" >> "$progress"
expect 0 'AC8 old close'
printf '<!-- pdh-effect: 1 -->\n' >> "$note"
expect 1 'AC12 missing'
grep -q '効果: の行が無い' output
printf '\n効果: 判断=1 答え待ち=0 codex=不明 claude=不明 退行=0\n' >> "$progress"
expect 0 'AC12 recorded'
