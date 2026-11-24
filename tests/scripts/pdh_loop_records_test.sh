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
printf '\nreview-sha: %s\n' "$sha" >> "$progress"
expect 1 'AC4 next round on same SHA'
make_progress 8
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

# 印のある現行表は、列を黙って捨てず診断する。
make_note verify
printf '<!-- pdh-review-loop: 1 -->\n' >> "$note"
make_progress 8
sed 's/| 1 | 欠陥 |/| 1 | a \\| b |/' "$progress" > p; mv p "$progress"
expect 1 'escaped pipe counts eight'
grep -q '処置の照らし直し: PDH-review-1' output
for heading in '### Findings-PDH-review-1（修正確認の巡）' '#### Findings-PDH-review-1'; do
  make_progress 8
  sed "s/^### Findings-PDH-review-1$/$heading/" "$progress" > p; mv p "$progress"
  expect 1 'annotated or deep heading counts eight'
  printf '\n- 処置の照らし直し: PDH-review-1 照合\n' >> "$progress"
  expect 0 'annotated heading with bullet reconsideration'
done
make_progress 1
sed 's/| いま直す |/| **いま直す** |/' "$progress" > p; mv p "$progress"
expect 1 'unreadable decision rejected'
grep -q 'progress.md:5: PDH-review-1: Findings 行' output
make_progress 1
sed 's/| 判定 |/| 補足 | 判定 |/' "$progress" > p; mv p "$progress"
expect 1 'unreadable current header rejected'
grep -q 'progress.md:3: PDH-review-1: 現行 Findings 表' output
make_progress 1
sed 's/| 1 | 欠陥 | 月1回・1分 |/| 1 | a \\| | 月1回・1分 |/' "$progress" > p; mv p "$progress"
expect 0 'escaped empty fragment is not the cost cell'
sed 's/| 月1回・1分 |/| |/' "$progress" > p; mv p "$progress"
expect 1 'escaped pipe cannot hide empty cost'
make_note review
printf '<!-- pdh-review-loop: 1 -->\n- [x] S8 PDH-review-1 PM が決めた: 構造 覆す条件: 再発\n' >> "$note"
make_progress 1
choice='収束の選択: PDH-review-1 部品=保存 前の仮説=局所 外れ方=退行 次に変えるもの=責任 外れの条件=再発'
printf '\n%s\n' "${choice/前の仮説=局所/前の仮説=}" >> "$progress"
expect 1 'incomplete component rejected'
printf '%s\n' "${choice/部品=保存/部品=取得}" >> "$progress"
expect 1 'other component cannot hide incomplete choice'
printf '%s\n' "$choice" >> "$progress"
expect 0 'same component corrected by append'
make_progress 1
printf '\n%s\n' "${choice/部品=保存/部品=}" >> "$progress"
expect 1 'component missing is diagnosed'
grep -q 'progress.md:7' output
printf '%s\n' "$choice" >> "$progress"
expect 0 'complete append resolves unknown component'
printf '%s\n' "${choice/前の仮説=局所/前の仮説=}" >> "$progress"
expect 1 'malformed append needs a later correction'
printf '%s\n' "$choice" >> "$progress"
expect 0 'later readable append corrects the key'
printf -- '- 収束の選択: PDH-review-1 の説明である\n' >> "$progress"
expect 0 'prose bullet is not a record'
make_progress 1
printf -- '- %s\n' "$choice" >> "$progress"
expect 0 'complete bullet is a record' 
make_note close
printf '<!-- pdh-effect: 1 -->\n' >> "$note"
make_progress 1
printf '\nclose-gate-sha: %s\n- 効果: 判断=1 答え待ち=0 codex=不明 claude=不明 退行=0\n' "$sha" >> "$progress"
expect 0 'effect with bullet'
# 後から増えた checklist は適用の印が無い ticket に求めない。
review_line='PDH-review: PM が Findings 全件を「処置の判断」の 4 つの規則で照合し、同じ種類の参照・母数と期間・判定を変えた証拠が progress にある'
close_line='PDH-close: 効果: 判断・答え待ち・codex・claude・退行が progress にある'
printf -- '- [ ] %s\n' "$review_line" >> .claude/skills/pdh-review/SKILL.md
printf -- '- [ ] %s\n' "$close_line" >> .claude/skills/pdh-close/SKILL.md
make_note review
make_progress 1
expect 0 'legacy review checklist excludes late loop lines'
printf '<!-- pdh-review-loop: 1 -->\n' >> "$note"
expect 1 'marked review checklist requires late loop lines'
make_note close
printf '\nclose-gate-sha: %s\n' "$sha" >> "$progress"
expect 0 'legacy close checklist excludes effect line'
printf '<!-- pdh-effect: 1 -->\n' >> "$note"
printf '\n効果: 判断=1 答え待ち=0 codex=不明 claude=不明 退行=0\n' >> "$progress"
expect 1 'marked close checklist requires effect checklist'
write_line='PDH-ticket-write: Failure Tolerance の 3 欄が埋まり、許す失敗の頻度と誰の何分かが数字で、許さない失敗が絞られている。変更した場合は回答と Brief 変更への承認が progress にある'
printf -- '- [ ] %s\n' "$write_line" >> .claude/skills/pdh-ticket-write/SKILL.md
make_note ticket-write
expect 1 'missing tolerance checklist rejected'
printf -- '- [x] PDH-ticket-write: Failure Tolerance が埋まっている。無いか空だった場合は、3 つの問いへの回答と brief 変更への承認が progress にある\n' >> "$note"
expect 0 'legacy tolerance checklist recognized'
