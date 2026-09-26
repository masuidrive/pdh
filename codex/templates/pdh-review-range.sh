#!/usr/bin/env bash
# close 前 review と検査が、同じ ticket 自身の commit 区間を見るための入口。
set -uo pipefail

# check-pdh-ticket.sh も同じ base と tip で done への移動を探す。
pdh_review_base_tip() {
  local ref other newest repo_root default_branch
  local candidates=()
  pdh_review_base=''
  pdh_review_tip=$(git rev-parse HEAD) || return 2
  # PR の base（GITHUB_BASE_REF）があれば、それが merge 先なので新旧を比べずに使う。
  if [ -n "${GITHUB_BASE_REF:-}" ] &&
     git rev-parse --verify "origin/$GITHUB_BASE_REF^{commit}" >/dev/null 2>&1; then
    pdh_review_base=origin/$GITHUB_BASE_REF
  fi
  repo_root=$(git rev-parse --show-toplevel) || return 2
  default_branch=''
  if [ -f "$repo_root/.ticket-config.yaml" ]; then
    default_branch=$(awk '
      /^default_branch:/ {
        sub(/^default_branch:[[:space:]]*/, "")
        gsub(/["\047]/, "")
        print $1
        exit
      }
    ' "$repo_root/.ticket-config.yaml") || return 2
  fi
  default_branch=${default_branch:-main}
  for ref in "origin/$default_branch" "$default_branch"; do
    [ -z "$pdh_review_base" ] || break
    if git rev-parse --verify "$ref^{commit}" >/dev/null 2>&1; then
      candidates+=("$ref")
    fi
  done
  [ -n "$pdh_review_base" ] || pdh_review_base=${candidates[0]:-}
  # ローカルとリモートの既定 branch は、もう一方を祖先に持つ（新しい）ほうを選ぶ。
  # 分岐していればリモートを採る（ローカルの未 push の commit よりリモートを base とみなす）。
  for ref in ${candidates[@]+"${candidates[@]}"}; do
    newest=1
    for other in "${candidates[@]}"; do
      if ! git merge-base --is-ancestor "$other" "$ref"; then
        newest=0
        break
      fi
    done
    if [ "$newest" -eq 1 ]; then
      pdh_review_base=$ref
      break
    fi
  done
  if [ -n "$pdh_review_base" ] &&
     git rev-parse --verify 'HEAD^2' >/dev/null 2>&1 &&
     git merge-base --is-ancestor 'HEAD^1' "$pdh_review_base"; then
    pdh_review_tip=$(git rev-parse 'HEAD^2') || return 2
  fi
}
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

if [ "$#" -ne 4 ] || [ "$2" != --from ]; then
  printf '使い方: %s <ticket ディレクトリ> --from close-gate|last-review --commits|--stat|--prompt\n' "$0" >&2
  exit 2
fi
ticket_dir=$1
from=$3
mode=$4
case "$from:$mode" in
  close-gate:--commits|close-gate:--stat|close-gate:--prompt|last-review:--commits|last-review:--stat|last-review:--prompt) ;;
  *) printf 'pdh-review-range: 起点か出力モードが不正です\n' >&2; exit 2 ;;
esac
[ -f "$ticket_dir/progress.md" ] || {
  printf 'pdh-review-range: %s/progress.md がありません\n' "$ticket_dir" >&2
  exit 2
}
start=$(awk -v from="$from" '
  { sub(/^- /, "") }
  /^close-gate-sha:/ || (from == "last-review" && /^review-sha:/) {
    sub(/^[^:]*:[[:space:]]*/, ""); sha = $1; found = 1
  }
  END { if (found) print sha }
' "$ticket_dir/progress.md") || exit 2
if [[ ! "$start" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  printf 'pdh-review-range: %s に %s の起点行が無いか、SHA が不正です（%s）\n' "$ticket_dir/progress.md" "$from" "$start" >&2
  exit 2
fi
if ! git cat-file -e "$start^{commit}" 2>/dev/null; then
  printf 'pdh-review-range: 起点 SHA %s を commit として解決できません\n' "$start" >&2
  exit 2
fi
pdh_review_base_tip || exit 2
tip=$pdh_review_tip
if ! git merge-base --is-ancestor "$start" "$tip"; then
  printf 'pdh-review-range: 起点が tip の履歴に無い（rebase か amend）。close 前 review を回し直し、progress.md に新しい SHA を追記する（起点: %s / tip: %s）\n' "$start" "$tip" >&2
  exit 2
fi
commits=$(git log --first-parent --no-merges --format='%H %s' "$start..$tip" -- ':(top)**' ':(top,exclude)tickets') || exit 2
case "$mode" in
  --commits)
    [ -z "$commits" ] || printf '%s\n' "$commits"
    ;;
  --stat)
    # rename 表記によるパスの揺れを避け、各 commit の追加・削除を合計する。
    # バイナリはファイル数だけに含める。
    while read -r sha subject; do
      [ -n "$sha" ] || continue
      git show --format= --numstat --no-renames "$sha" -- ':(top)**' ':(top,exclude)tickets' || exit 2
    done <<< "$commits" | awk -F '\t' '
      NF >= 3 { if (!seen[$3]++) files++; added += $1; deleted += $2 }
      END { printf "%d ファイル・追加 %d 行・削除 %d 行\n", files, added, deleted }
    ' || exit 2
    ;;
  --prompt)
    if [ -z "$commits" ]; then
      printf 'pdh-review-range: 区間に ticket 自身の commit が無い\n' >&2
      exit 3
    fi
    printf '起点 SHA: %s / tip: %s\n対象 ticket: %s\n対象 commit:\n%s\n\n' "$start" "$tip" "$ticket_dir" "$commits"
    printf '%s\n' 'これらの commit だけを `git show <sha>` で読んで review する。一覧に無い commit（main から merge で入った変更を含む）は review の対象にしない。各 commit の変更が、ticket の既存コードと組み合わさって起こす欠陥も見る。'
    ;;
esac
exit 0
