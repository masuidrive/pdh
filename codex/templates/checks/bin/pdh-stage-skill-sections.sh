#!/usr/bin/env bash
# PDH-stage の skill が «入力・処理・出力・例外» の 4 つの節を持つかを確かめる（pdh-change「PDH-stage の skill の形」）。
# この形の目的: PM が、どの PDH-stage でも同じ場所で確かめ方を見つけ、前の PDH-stage の出力と次の入力のつながりを確かめられること。
# 対象は PDH-stage の skill 全部（PDH-stage の一覧は .agents/skills/pdh-pm/SKILL.md「状態遷移」）。
set -uo pipefail
stage_skills=(
  .agents/skills/pdh-ticket-write/SKILL.md
  .agents/skills/pdh-open/SKILL.md
  .agents/skills/pdh-resume/SKILL.md
  .agents/skills/pdh-ticket-review/SKILL.md
  .agents/skills/pdh-implement/SKILL.md
  .agents/skills/pdh-review/SKILL.md
  .agents/skills/pdh-verify/SKILL.md
  .agents/skills/pdh-close/SKILL.md
)
rc=0
for f in "${stage_skills[@]}"; do
  for h in 入力 処理 出力 例外; do
    if ! grep -qx "## $h" "$f"; then
      echo "$f: 節「## $h」が無い（pdh-change「PDH-stage の skill の形」）"; rc=1
    fi
  done
done
exit $rc
