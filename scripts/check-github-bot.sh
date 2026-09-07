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

# --- 配線: gate 停止句が «実際に agent の prompt に載る» ことを保証する ---
# run-action.sh は system prompt へ _pdh.md «だけ» を append する（_github-issue.md は
# agent が Read する前提で append しない）。よって「gate 停止句が _pdh.md に在る」かつ
# 「run-action.sh が PDH project で _pdh.md を append する」の 2 つが揃って初めて、停止指示
# が agent に必ず届く。上で前者を検査済み。ここで後者（vendored 機構がその append を今も
# するか）を検査する。upstream の再同期で detection/append が変わればここが落ちて気づける。
ra="github-bot/vendor/.github/coding-robot/run-action.sh"
if [ -f "$ra" ]; then
  if ! grep -q 'product-brief.md' "$ra" || ! grep -q -- '-d tickets' "$ra"; then
    printf 'github-bot: run-action.sh の PDH 検出（product-brief.md && tickets/）が見当たらない\n' >&2
    failed=1
  fi
  if ! grep -q 'append_prompt "\$SCRIPT_DIR/_pdh.md"' "$ra"; then
    printf 'github-bot: run-action.sh が _pdh.md を system prompt へ append していない（gate 停止句が agent に届かない恐れ）\n' >&2
    failed=1
  fi
fi

# --- vendor の出どころ commit が VENDOR.md に固定されているか ---
if [ -f github-bot/vendor/VENDOR.md ] && ! grep -qE 'commit.*[0-9a-f]{40}' github-bot/vendor/VENDOR.md; then
  printf 'github-bot: vendor/VENDOR.md に取り込み元 commit（40 hex）が無い\n' >&2
  failed=1
fi

# --- 認証切れ UX: 両 engine script が auth エラーを検出してコメントする処理を持つか ---
# missing/expired の credential で、bot が汎用エラーではなく «再ログインして secret 更新» を
# 案内できることが利用体験の要。machinery 側に既存（_claude.sh / _codex.sh の Authentication
# Error）。re-sync で消えると «認証切れが分かりにくい失敗» に戻るので、存在を守る。
for e in _claude _codex; do
  f="github-bot/vendor/.github/coding-robot/engines/${e}.sh"
  if [ -f "$f" ]; then
    if ! grep -q 'Authentication Error' "$f"; then
      printf 'github-bot: %s に認証エラーコメント（Authentication Error）が無い\n' "$f" >&2
      failed=1
    fi
    # run 中の expired/invalid 検出（missing だけでなく «切れた» も拾うヒューリスティック）
    if ! grep -qi 'unauthorized\|invalid.*token\|invalid.*api.*key\|expired' "$f"; then
      printf 'github-bot: %s に run 中の認証失敗（expired/unauthorized）検出が無い\n' "$f" >&2
      failed=1
    fi
  fi
done

# --- 移植性パッチ: devcontainer の workspaceFolder が固定パスか（re-sync で戻ると任意 repo で落ちる）---
# upstream は repo 名依存の ${localWorkspaceFolderBasename} で、compose の既定(/workspaces/project)と
# 食い違い devcontainer exec が落ちる（smoke 実測。VENDOR.md「PDH 側の移植性パッチ」）。固定形を守る。
dc="github-bot/vendor/.devcontainer/devcontainer.json"
if [ -f "$dc" ] && grep -q 'workspaceFolder.*localWorkspaceFolderBasename' "$dc"; then
  printf 'github-bot: devcontainer.json の workspaceFolder が repo 名依存に戻っている（compose mount と食い違い任意 repo で落ちる。VENDOR.md 参照）\n' >&2
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
printf 'check-github-bot: files present, gate-stop guard present & wired into prompt, vendor pinned\n'
