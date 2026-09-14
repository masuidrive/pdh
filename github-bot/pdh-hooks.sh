#!/usr/bin/env bash
# pdh-hooks.sh — github-bot 層の runner hook。PDH mode（product-brief.md と tickets/ がある repo）の
# ときだけ run-action.sh が最終レポートの投稿直前に呼ぶ。
#
# 人との受け渡し経路（GitHub Issue）で、agent の申告に依らず runner が保証するもの:
#   1. ticket dir に progress.md が無ければ作る
#   2. note の `## Status: PDH-*` を issue の stage ラベルに写す
#   3. Status が human gate なら、最終レポートにその gate の承認語（🤖 承認 / 🤖 クローズ承認）が無ければ導線を足す
#   4. Status が human gate なら、note の Checklist に «発行先:» 付きの未了行が無ければ足す
#      （URL は今回の gate コメント）
#   5. progress.md に削除行があれば報告に警告を足す
#   6. 導入検査（stage ラベル・Actions の PR 作成許可）で要追加があれば報告に足す
#
# usage:
#   pdh-hooks.sh final <issue> <branch> <comment-id>   # stdin: 最終レポート → stdout: 補正後の本文
#   pdh-hooks.sh setup [owner/repo]                     # 導入検査だけ。要追加があれば exit 1
# 依存: bash / git / awk / grep / sed / gh。GITHUB_REPOSITORY を使う（setup は引数でも可）。
set -uo pipefail

REPO="${GITHUB_REPOSITORY:-}"
STAGES="PDH-open PDH-ticket-review PDH-ticket-human-review PDH-implement PDH-review PDH-verify PDH-human-review PDH-close"
log() { printf 'pdh-hooks: %s\n' "$*" >&2; }

setup_check() {
  # 出力: 要追加の行（無ければ空）。exit code は呼び手が判断する。
  local repo="$1" missing="" have
  have=$(gh label list --repo "$repo" --limit 200 --json name -q '.[].name' 2>/dev/null || echo "__gh_failed__")
  if [ "$have" = "__gh_failed__" ]; then
    printf '%s\n' "- stage ラベルを確認できない（gh label list が失敗）"
  else
    for s in $STAGES; do
      printf '%s\n' "$have" | grep -qx "$s" || missing="$missing $s"
    done
    [ -z "$missing" ] || printf '%s\n' "- stage ラベルが無い:$missing（github-bot/INSTALL.md「3. stage ラベルを作る」）"
  fi
  local perm
  perm=$(gh api "repos/$repo/actions/permissions/workflow" -q .can_approve_pull_request_reviews 2>/dev/null || echo "unknown")
  case "$perm" in
    true) ;;
    false) printf '%s\n' "- Actions が PR を作成できない設定（github-bot/INSTALL.md「Actions に PR 作成を許可する」）" ;;
    *) ;;  # 権限不足で読めないときは黙る（誤報しない）
  esac
}

cmd="${1:-}"
case "$cmd" in
  setup)
    repo="${2:-$REPO}"; [ -n "$repo" ] || { log "owner/repo が要る"; exit 2; }
    out=$(setup_check "$repo")
    if [ -n "$out" ]; then printf '%s\n' "$out"; exit 1; fi
    echo "pdh-hooks setup: ok（ラベル 8 段・PR 作成許可）"; exit 0 ;;
  final) ;;
  *) log "usage: pdh-hooks.sh final <issue> <branch> <comment-id> | setup [owner/repo]"; exit 2 ;;
esac

ISSUE="${2:-}"; BRANCH="${3:-}"; CID="${4:-}"
[ -n "$ISSUE" ] && [ -n "$BRANCH" ] && [ -n "$REPO" ] || { log "final: issue / branch / GITHUB_REPOSITORY が要る"; cat; exit 1; }
report=$(cat)

# --- ticket dir（done/ は対象外） ---
dir=""
for d in tickets/*-issue-"$ISSUE"; do [ -d "$d" ] && [ -f "$d/ticket.md" ] && { dir="$d"; break; }; done
if [ -z "$dir" ]; then
  log "issue #$ISSUE の ticket dir が無い（done 済みか未作成）。補正なし"
  printf '%s' "$report"; exit 0
fi
name=$(basename "$dir"); note="$dir/note.md"; changed=0

# --- 1. progress.md ---
if [ ! -f "$dir/progress.md" ]; then
  printf '# Progress: %s\n\n' "$name" > "$dir/progress.md"
  log "$dir/progress.md を作った（agent は作っていなかった）"; changed=1
fi

# --- Status ---
status=""
[ -f "$note" ] && status=$(grep -m1 '^## Status:' "$note" | sed -E 's/^## Status:[[:space:]]*(PDH-[a-z-]+).*/\1/')
gate=0; case "$status" in PDH-ticket-human-review|PDH-human-review) gate=1 ;; esac

# --- 2. stage ラベル ---
if [ -n "$status" ] && printf '%s\n' $STAGES | grep -qx "$status"; then
  have=$(gh label list --repo "$REPO" --limit 200 --json name -q '.[].name' 2>/dev/null || true)
  if printf '%s\n' "$have" | grep -qx "$status"; then
    others=$(printf '%s\n' $STAGES | grep -vx "$status" | paste -sd, -)
    if gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$others" --add-label "$status" >/dev/null 2>&1; then
      log "ラベルを $status にした"
    else
      log "ラベル更新に失敗（続行）"
    fi
  fi
fi

# --- 3. 承認導線 ---
if [ "$status" = "PDH-ticket-human-review" ]; then word="🤖 承認"; else word="🤖 クローズ承認"; fi
if [ "$gate" -eq 1 ] && ! printf '%s' "$report" | grep -qF "$word"; then
  report="$report

### 回答のしかた
この Issue にコメントで返してください: 承認は \`$word\`、直してほしい点は \`🤖 修正して: …\`、差し戻しは \`🤖 差し戻す: …\`。板を HTML で出している場合は「回答をコピー」の貼り戻し文を 🤖 付きで貼ってください。"
  log "承認導線を足した（agent の報告に無かった）"
fi

# --- 4. 待ち行 ---
if [ "$gate" -eq 1 ] && [ -f "$note" ]; then
  if ! awk '/^## Checklist/{f=1;next} /^## /{f=0} f' "$note" | grep -q '^- \[ \].*発行先:'; then
    url="https://github.com/$REPO/issues/$ISSUE"; [ -n "$CID" ] && url="$url#issuecomment-$CID"
    line="- [ ] $status: 回答待ち。発行先: ${url}（答えを ticket へ反映した手で [x]）"
    tmp=$(mktemp)
    awk -v line="$line" '
      /^## Checklist/ {print; f=1; next}
      f && /^## / {print line; print ""; f=0}
      {print}
      END {if (f) print line}
    ' "$note" > "$tmp" && mv "$tmp" "$note"
    log "note の Checklist に待ち行を足した（agent は書いていなかった）"; changed=1
  fi
fi

# --- commit / push（1〜4 でファイルが変わったとき） ---
if [ "$changed" -eq 1 ]; then
  git add "$dir/progress.md" "$note" 2>/dev/null
  if git -c user.name="pdh-hooks" -c user.email="pdh-hooks@users.noreply.github.com" commit -q -m "chore(pdh-hooks): progress.md / 待ち行を補う（issue #${ISSUE}）" 2>/dev/null; then
    git push -q origin "$BRANCH" 2>/dev/null || log "push に失敗（ローカルには commit 済み）"
  fi
fi

# --- 5. progress の削除行 ---
base=$(awk -F'"' '/^default_branch:/{print $2}' .ticket-config.yaml 2>/dev/null); base=${base:-main}
if git rev-parse --verify -q "origin/$base" >/dev/null 2>&1; then
  del=$(git log "origin/$base..HEAD" -p --format= -- "$dir/progress.md" 2>/dev/null | grep -c '^-[^-]' || true)
  if [ "${del:-0}" -gt 0 ]; then
    report="$report

⚠ \`$dir/progress.md\` を削る commit が branch にあります（削除行 ${del}）。progress は追記のみです。"
  fi
fi

# --- 6. 導入検査 ---
setup=$(setup_check "$REPO")
if [ -n "$setup" ]; then
  report="$report

### ⚠ 導入検査で要追加
$setup"
fi

printf '%s' "$report"
