#!/usr/bin/env bash
# check-github-bot.sh — opt-in github-bot レイヤーの load-bearing な不変条件を検査する。
#
# なぜ要るか: github-bot/ は engine 中立の単一コピー（claude/ と codex/ に割れない）なので
# check-guard-parity.sh の cross-set 検査は当たらない。だが «cloud agent は human gate で
# 自己承認せず停止する» は、engine で変えてはならない安全核（docs/PDH-AGENTS.md の gate
# 規則を Actions に写したもの）。単一コピーなので divergence は起きないが、**消えても既存
# 検査は落ちない**。この検査が、その 1 文の存在と、レイヤーの骨格ファイルの存在を守る。
#
# 検査するのは «在るか» だけ（文面の完全一致は見ない。自由文の網羅性は測らない ―
# CLAUDE.md「自由文は、行数や件数で機械的に評価できない」）。
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

failed=0

# --- 骨格ファイルが在るか ---
required=(
  github-bot/_pdh.md
  github-bot/_github-issue.md
  github-bot/INSTALL.md
  github-bot/.ticket-config.snippet.yaml
  github-bot/pdh-gh-pull/SKILL.md
  github-bot/vendor/VENDOR.md
  github-bot/vendor/.github/workflows/coding-robot.yml
  github-bot/vendor/.github/coding-robot/run-action.sh
)
for f in "${required[@]}"; do
  if [ ! -f "$f" ]; then
    printf 'github-bot: MISSING file — %s\n' "$f" >&2
    failed=1
  fi
done

# --- 安全核: gate 停止の guard が _pdh.md と _github-issue.md の両方に在るか ---
# 句は load-bearing（消えると cloud agent が gate を越えうる）。言い換えに強い最小断片。
gate_guard="自己承認しない"
for f in github-bot/_pdh.md github-bot/_github-issue.md; do
  if [ -f "$f" ] && ! grep -q -- "$gate_guard" "$f"; then
    printf 'github-bot: MISSING gate-stop guard "%s" in %s\n' "$gate_guard" "$f" >&2
    failed=1
  fi
done

# --- vendor の出どころ commit が VENDOR.md に固定されているか ---
if [ -f github-bot/vendor/VENDOR.md ] && ! grep -qE 'commit.*[0-9a-f]{40}' github-bot/vendor/VENDOR.md; then
  printf 'github-bot: vendor/VENDOR.md に取り込み元 commit（40 hex）が無い\n' >&2
  failed=1
fi

# --- stale の再混入検出: vendor の古い _pdh.md を取り込んでいないか ---
if [ -f github-bot/vendor/.github/coding-robot/_pdh.md ]; then
  printf 'github-bot: vendor に _pdh.md がある（古い版。PDH は github-bot/_pdh.md を正とし vendor には置かない）\n' >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  printf 'check-github-bot: FAILED\n' >&2
  exit 1
fi
printf 'check-github-bot: layer files present, gate-stop guard present, vendor pinned\n'
