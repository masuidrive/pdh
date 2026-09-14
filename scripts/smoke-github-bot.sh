#!/usr/bin/env bash
# smoke-github-bot.sh — github-bot 層を実 repo で 1 ticket ぶん実走し、受け渡しの保証を外から確かめる。
#
# open → 実装前 gate → 承認 → 実装〜close gate → close 承認 → PR → merge → 🤖 → issue close の順に
# 人間役を自動で演じ、各 run の後に次を assert する:
#   - 実装前 gate: progress.md がある / note の Checklist に «発行先:» 付き未了行 / ラベル PDH-ticket-human-review / 承認導線
#   - close gate:  待ち行が [x] と新しい待ち行 / progress に削除行なし / ラベル PDH-human-review / 承認導線
#   - close 承認後: PR が Refs #N / tickets/done/ への移動が PR に含まれる
#   - merge 後:    issue CLOSED、main に tickets/done/<name>/progress.md
#
# Actions の分数と時間（engine により 30〜60 分）を使うので test-all.sh には入れない。
# usage: scripts/smoke-github-bot.sh <owner/repo> <claude|codex> [title-suffix]
# 依存: gh（対象 repo に issues/PR の write）。engine 変数を書き換えるので、終了時に元へ戻す。
set -uo pipefail
R="${1:?owner/repo}"; ENGINE="${2:?claude|codex}"; SUFFIX="${3:-$(date -u +%H%M)}"
fail=0; ok() { printf '  PASS %s\n' "$*"; }; ng() { printf '  FAIL %s\n' "$*"; fail=1; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

wait_run() {  # $1: after-timestamp → run id を返し、完了まで待つ
  local after="$1" id=""
  for _ in $(seq 1 90); do
    id=$(gh run list --repo "$R" --limit 5 --json databaseId,createdAt -q "[.[] | select(.createdAt > \"$after\")] | .[0].databaseId" 2>/dev/null)
    [ -n "$id" ] && [ "$id" != "null" ] && break; sleep 10
  done
  [ -n "$id" ] && [ "$id" != "null" ] || { echo "run が始まらない"; return 1; }
  gh run watch "$id" --repo "$R" --exit-status >/dev/null 2>&1; local rc=$?
  printf '  run %s: %s\n' "$id" "$(gh run view "$id" --repo "$R" --json conclusion -q .conclusion)"
  return $rc
}
file_on() { gh api "repos/$R/contents/$2?ref=$1" -q .content 2>/dev/null | base64 -d 2>/dev/null; }
labels() { gh issue view "$N" --repo "$R" --json labels -q '[.labels[].name]|join(",")'; }
last_comment() { gh issue view "$N" --repo "$R" --json comments -q '.comments[-1].body'; }

orig_engine=$(gh variable get CODING_ROBOT_ENGINE --repo "$R" 2>/dev/null || echo "")
gh variable set CODING_ROBOT_ENGINE --repo "$R" --body "$ENGINE"
trap '[ -n "$orig_engine" ] && gh variable set CODING_ROBOT_ENGINE --repo "$R" --body "$orig_engine" >/dev/null' EXIT

echo "== smoke ($ENGINE) on $R"
T=$(now)
# 要望は run ごとに新しい option 名にする。同じ要望を 2 度出すと bot が «実装済みの重複» と判断して ticket を作らない（正しい振る舞い）。
OPT="--mark-$SUFFIX"
gh issue create --repo "$R" --title "smoke $SUFFIX: greet に $OPT で末尾に [$SUFFIX] を付けたい 🤖" --body "$(printf '## 要望\n`%s` を付けると挨拶の末尾に ` [%s]` を付けてほしい。無ければ従来どおり。既存の言語・オプションと組み合わせても破綻しないこと。\n\nPython 標準ライブラリのみ・`src/greet.py` の 1 ファイルで。\n\n🤖' "$OPT" "$SUFFIX")" >/dev/null
N=$(gh issue list --repo "$R" --limit 1 --json number -q '.[0].number'); B="agent/issue-$N"
echo "issue #$N"

echo "-- run 1: open → 実装前 gate"; wait_run "$T" || ng "run 1 が失敗"
D=$(gh api "repos/$R/git/trees/$B?recursive=1" -q '.tree[].path' | grep -E "^tickets/[^/]+-issue-$N/ticket.md$" | sed 's#/ticket.md##' | head -1)
[ -n "$D" ] && ok "ticket dir $D" || ng "ticket dir が無い"
[ -n "$(file_on "$B" "$D/progress.md")" ] && ok "progress.md あり" || ng "progress.md が無い"
file_on "$B" "$D/note.md" | awk '/^## Checklist/{f=1;next} /^## /{f=0} f' | grep -Eq '^- \[ \].*発行先:.*(https?://|/)' && ok "待ち行（発行先: + URL）" || ng "待ち行が無い"
[ "$(labels)" = "PDH-ticket-human-review" ] && ok "ラベル PDH-ticket-human-review" || ng "ラベル: $(labels)"
last_comment | grep -q '🤖 承認' && ok "承認導線" || ng "承認導線が無い"

echo "-- run 2: 承認 → 実装 → close gate"; T=$(now); gh issue comment "$N" --repo "$R" --body "🤖 承認" >/dev/null
wait_run "$T" || ng "run 2 が失敗"
note=$(file_on "$B" "$D/note.md")
printf '%s' "$note" | grep -q '^- \[x\] PDH-ticket-human-review' && ! printf '%s' "$note" | grep -q '^- \[ \] PDH-ticket-human-review' && ok "実装前 gate の待ち行が [x]" || ng "実装前 gate の待ち行が [x] でない"
printf '%s' "$note" | awk '/^## Checklist/{f=1;next} /^## /{f=0} f' | grep -Eq '^- \[ \] PDH-human-review.*発行先:.*(https?://|/)' && ok "close gate の待ち行（URL 付き）" || ng "close gate の待ち行が無い"
[ "$(labels)" = "PDH-human-review" ] && ok "ラベル PDH-human-review" || ng "ラベル: $(labels)"
last_comment | grep -q '🤖 クローズ承認' && ok "close の承認導線" || ng "close の承認導線が無い"
del=$(gh api "repos/$R/compare/main...$B" -q '.files[] | select(.filename | endswith("progress.md")) | .deletions' | awk '{s+=$1} END{print s+0}')
[ "$del" = "0" ] && ok "progress に削除行なし" || ng "progress に削除行 $del"

echo "-- run 3: close 承認 → done 移動 → PR"; T=$(now); gh issue comment "$N" --repo "$R" --body "🤖 クローズ承認" >/dev/null
wait_run "$T" || ng "run 3 が失敗"
PR=$(gh pr list --repo "$R" --head "$B" --state open --json number -q '.[0].number')
[ -n "$PR" ] && ok "PR #$PR" || ng "PR が無い"
[ -n "$PR" ] && gh pr view "$PR" --repo "$R" --json body -q .body | grep -q "Refs #$N" && ok "PR 本文に Refs #$N" || ng "Refs #$N が無い"
[ -n "$PR" ] && gh pr view "$PR" --repo "$R" --json files -q '.files[].path' | grep -q "^tickets/done/" && ok "PR に tickets/done/ の移動を含む" || ng "PR に done 移動が無い"

echo "-- merge → run 4: issue close"
[ -n "$PR" ] && gh pr merge "$PR" --repo "$R" --merge --delete-branch=false >/dev/null && sleep 15
T=$(now); gh issue comment "$N" --repo "$R" --body "🤖 続行（PR を merge しました）" >/dev/null
wait_run "$T" || ng "run 4 が失敗"
[ "$(gh issue view "$N" --repo "$R" --json state -q .state)" = "CLOSED" ] && ok "issue CLOSED" || ng "issue が閉じていない"
gh api "repos/$R/git/trees/main?recursive=1" -q '.tree[].path' | grep -q "^tickets/done/[^/]*-issue-$N/progress.md$" && ok "main に tickets/done/…/progress.md" || ng "main に done が無い"

echo "== smoke ($ENGINE): $([ $fail -eq 0 ] && echo PASS || echo FAIL)"
exit $fail
