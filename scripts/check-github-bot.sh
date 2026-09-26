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
  github-bot/pdh-hooks.sh
  github-bot/INSTALL.md
  github-bot/.ticket-config.snippet.yaml
  github-bot/pdh-gh-pull/SKILL.md
  github-bot/ROBOT.md
  github-bot/.github/workflows/coding-robot.yml
  github-bot/.github/coding-robot/run-in-container.sh
  github-bot/.github/coding-robot/engines/_stub.sh
  github-bot/.github/coding-robot/run-action.sh
  github-bot/.github/coding-robot/notify-devbot.sh
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

# --- 経路の囲い: 起動側が system prompt に置く <Human-Agent-Interface> が _pdh.md に在り、
# その優先規則が契約（docs/PDH-AGENTS.md）に在るか。片方だけだと、囲いが無視されるか、
# 囲いの無い指定が経路を上書きしうる。再開時に note の Checklist を読む規則も同様に守る。
for tag in '<Human-Agent-Interface>' '</Human-Agent-Interface>'; do
  if [ -f github-bot/_pdh.md ] && ! grep -qF -- "$tag" github-bot/_pdh.md; then
    printf 'github-bot: MISSING route block %s in github-bot/_pdh.md\n' "$tag" >&2
    failed=1
  fi
done
if ! grep -qF -- 'Human-Agent-Interface' docs/PDH-AGENTS.md; then
  printf 'github-bot: docs/PDH-AGENTS.md に <Human-Agent-Interface> の優先規則が無い（囲いが契約で裏付けられていない）\n' >&2
  failed=1
fi
if [ -f github-bot/_github-issue.md ] && ! grep -qF -- '## Checklist' github-bot/_github-issue.md; then
  printf 'github-bot: _github-issue.md に再開時 note の ## Checklist を読む規則が無い\n' >&2
  failed=1
fi

# --- 配線: gate 停止句が «実際に agent の prompt に載る» ことを保証する ---
# run-action.sh は _pdh.md と _github-issue.md を system prompt に連結する。よって「gate 停止句が _pdh.md に在る」かつ
# 「run-action.sh が PDH project で _pdh.md を append する」の 2 つが揃って初めて、停止指示
# が agent に必ず届く。上で前者を検査済み。ここで後者（machinery がその append を今も
# するか）を検査する。upstream の再同期で detection/append が変わればここが落ちて気づける。
ra="github-bot/.github/coding-robot/run-action.sh"
if [ -f "$ra" ]; then
  if ! grep -q 'product-brief.md' "$ra" || ! grep -q -- '-d tickets' "$ra"; then
    printf 'github-bot: run-action.sh の PDH 検出（product-brief.md && tickets/）が見当たらない\n' >&2
    failed=1
  fi
  # PDH 側パッチ: 最終レポート投稿前に pdh-hooks.sh を通す（VENDOR.md）。消えると agent の申告頼みに戻る
  if ! grep -q 'pdh-hooks.sh" final' "$ra"; then
    printf 'github-bot: run-action.sh が pdh-hooks.sh final を呼んでいない（VENDOR.md の PDH 側パッチ）\n' >&2
    failed=1
  fi
  if ! grep -q 'append_prompt "\$SCRIPT_DIR/_pdh.md"' "$ra"; then
    printf 'github-bot: run-action.sh が _pdh.md を system prompt へ append していない（gate 停止句が agent に届かない恐れ）\n' >&2
    failed=1
  fi
fi

# --- 所有と «直す場所» が ROBOT.md に書かれているか ---
# ⚠ かつてここは «取り込み元 commit（40 hex）が固定されているか» を検査していた。2026-09-17 に
# github-bots からの取り込みをやめ PDH が所有者になったので、固定する相手が消えた。代わりに
# «ここが直す場所である» と書いてあることを守る — それが消えると、次に読む人が上流を探しに行く。
if [ -f github-bot/ROBOT.md ] && ! grep -q '直すのはここである' github-bot/ROBOT.md; then
  printf 'github-bot: ROBOT.md に «直すのはここである» が無い（所有の宣言が消えている）\n' >&2
  failed=1
fi

# --- 認証切れ UX: 両 engine script が auth エラーを検出してコメントする処理を持つか ---
# missing/expired の credential で、bot が汎用エラーではなく «再ログインして secret 更新» を
# 案内できることが利用体験の要。machinery 側に既存（_claude.sh / _codex.sh の Authentication
# Error）。re-sync で消えると «認証切れが分かりにくい失敗» に戻るので、存在を守る。
for e in _claude _codex; do
  f="github-bot/.github/coding-robot/engines/${e}.sh"
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
dc="github-bot/.devcontainer/devcontainer.json"
if [ -f "$dc" ] && grep -q 'workspaceFolder.*localWorkspaceFolderBasename' "$dc"; then
  printf 'github-bot: devcontainer.json の workspaceFolder が repo 名依存に戻っている（compose mount と食い違い任意 repo で落ちる。VENDOR.md 参照）\n' >&2
  failed=1
fi

# --- 止まったことの知らせ: 秘密は host 側の step だけが持つか ---
# 守るのは «署名の秘密が agent の動く devcontainer と command line に届かないこと» である。
# agent は run-action.sh と同じ container で動くので、container の env に足すと agent から読める。
wf="github-bot/.github/workflows/coding-robot.yml"
nd="github-bot/.github/coding-robot/notify-devbot.sh"
if [ -f "$wf" ]; then
  agent_env=$(awk '/- name: Run Agent/{f=1;next} f && /^      - name:/{exit} f' "$wf")
  if printf '%s\n' "$agent_env" | grep -q 'DEVBOT_'; then
    printf 'github-bot: coding-robot.yml の Run Agent step に DEVBOT_ が渡っている（秘密が agent から読める）\n' >&2
    failed=1
  fi
  if ! grep -q 'name: Tell devbot why the run stopped' "$wf" || ! grep -q 'RUNNER_TEMP/notify-devbot.sh' "$wf"; then
    printf 'github-bot: coding-robot.yml に host 側の知らせ step（退避した notify-devbot.sh を使う）が無い\n' >&2
    failed=1
  fi
fi
if [ -f "$wf" ]; then
  # agent は workflow_dispatch で自分の branch を指せる。その run の workspace の script を秘密付きで走らせない
  grep -q 'git show "origin/${{ github.event.repository.default_branch }}:.github/coding-robot/notify-devbot.sh"' "$wf" \
    || { printf 'github-bot: notify-devbot.sh を default branch から退避していない\n' >&2; failed=1; }
  awk '/- name: Tell devbot why the run stopped/{getline; print; exit}' "$wf" | grep -q "github.event_name != 'workflow_dispatch'" \
    || { printf 'github-bot: 知らせ step が workflow_dispatch でも走る\n' >&2; failed=1; }
fi
# cwd の hmac.py を import させない（host の cwd は agent が書ける workspace）
if [ -f "$nd" ] && grep -v '^[[:space:]]*#' "$nd" | grep 'python3' | grep -vq -- 'python3 -I'; then
  printf 'github-bot: notify-devbot.sh が python3 を -I なしで呼んでいる（workspace の module を import する）\n' >&2
  failed=1
fi
if [ -f "$nd" ] && grep -v '^[[:space:]]*#' "$nd" | grep -q -- '-hmac'; then
  printf 'github-bot: notify-devbot.sh が openssl -hmac を使っている（秘密が command line に載る）\n' >&2
  failed=1
fi
if [ -f "$nd" ] && ! out=$(DEVBOT_NOTIFY_URL= bash "$nd" 1 ticket_gate 2>&1); then
  printf 'github-bot: notify-devbot.sh が URL 未設定で非 0 を返した（知らせは run の結果を変えてはならない）: %s\n' "$out" >&2
  failed=1
fi

# --- stale の再混入検出: machinery 側に古い _pdh.md が紛れていないか ---
if [ -f github-bot/.github/coding-robot/_pdh.md ]; then
  printf 'github-bot: machinery 側に _pdh.md がある（PDH は github-bot/_pdh.md を持ち、machinery 側には置かない）\n' >&2
  failed=1
fi

# --- gh repo view は repo を引数で受け取る。--repo は無く、run が起動直後に落ちる（2026-09-26 に実際に起きた） ---
if grep -rnE 'gh repo view[^|;]*--repo' github-bot >&2; then
  printf 'github-bot: gh repo view に --repo は無い。repo は引数で渡す（gh repo view "$GITHUB_REPOSITORY" --json …）\n' >&2
  failed=1
fi

# --- pr-merge の push は PAT で出る。runner が agent の起動前に origin の認証を差し替える ---
# agent に認証を外させ push ごとに PAT を指定させる手順は、agent が認証を GITHUB_TOKEN へ戻すと崩れ、
# 以降の push が起こす CI が «Approve and run» 待ちで止まった（2026-09-26）。
ra=github-bot/.github/coding-robot/run-action.sh
set_line=$(grep -n '^  use_pat_for_origin$' "$ra" | head -1 | cut -d: -f1)
engine_line=$(grep -n '^source "\$ENGINE_FILE"' "$ra" | head -1 | cut -d: -f1)
if [ -z "$set_line" ] || [ -z "$engine_line" ] || [ "$set_line" -gt "$engine_line" ]; then
  printf 'github-bot: run-action.sh が agent の起動前に origin の認証を ATTACHMENTS_TOKEN へ差し替えていない\n' >&2
  failed=1
fi
if grep -n 'unset-all' github-bot/_pdh.md >&2; then
  printf 'github-bot: _pdh.md が agent に origin の認証を外させている（runner が差し替える。agent は触らない）\n' >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  printf 'check-github-bot: FAILED\n' >&2
  exit 1
fi
printf 'check-github-bot: files present, gate-stop guard present & wired into prompt, ownership declared\n'
