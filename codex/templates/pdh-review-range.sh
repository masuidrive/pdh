#!/usr/bin/env bash
# close 前 review と検査が、同じ ticket 自身の commit 区間を見るための入口。
set -uo pipefail

# 記録行ごとに、値の先頭の 7〜40 桁の 16 進並びだけを返す。
# 不正な値も空行で残すので、最後の起点が不正なら以前の SHA に戻らない。
pdh_review_sha_records() {
  local file=$1 kind=$2
  awk -v kind="$kind" '
    { sub(/^- /, "") }
    (kind == "last-review" && /^(review|close-gate)-sha:/) ||
    (kind == "review" && /^review-sha:/) ||
    (kind == "close-gate" && /^close-gate-sha:/) {
      sub(/^[^:]*:[[:space:]]*/, "")
      sha=""
      if (match($0, /^[0-9a-fA-F]+/) && RLENGTH >= 7 && RLENGTH <= 40)
        sha=tolower(substr($0, 1, RLENGTH))
      print sha
    }
  ' "$file"
}

pdh_review_tickets_dir() {
  local root value
  root=$(git rev-parse --show-toplevel) || return 2
  value=$(awk '/^tickets_dir:/ {sub(/^tickets_dir:[[:space:]]*/, ""); sub(/[[:space:]]+#.*/, ""); gsub(/["\047]/, ""); sub(/[[:space:]]+$/, ""); print; exit}' "$root/.ticket-config.yaml" 2>/dev/null)
  pdh_tickets=${value:-tickets}
  pdh_tickets=${pdh_tickets%/}
  pdh_tickets=${pdh_tickets#./}
}

# check-pdh-ticket.sh も同じ base と tip で done への移動を探す。
pdh_review_base_tip() {
  local ref other newest repo_root default_branch
  local candidates=()
  pdh_review_base=''
  pdh_review_exclude=''
  pdh_review_tip=$(git rev-parse HEAD) || return 2
  # PR の base（GITHUB_BASE_REF）があれば、それが merge 先なので新旧を比べずに使う。
  if [ -n "${GITHUB_BASE_REF:-}" ] &&
     git rev-parse --verify "origin/$GITHUB_BASE_REF^{commit}" >/dev/null 2>&1; then
    pdh_review_base=origin/$GITHUB_BASE_REF
  fi
  # ./ticket.sh close の pre_close_command から呼ばれると、merge 先の branch が渡る。
  if [ -z "$pdh_review_base" ] && [ -n "${TICKET_BASE_BRANCH:-}" ] &&
     git rev-parse --verify "$TICKET_BASE_BRANCH^{commit}" >/dev/null 2>&1; then
    pdh_review_base=$TICKET_BASE_BRANCH
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
  pdh_review_exclude=$pdh_review_base
  # HEAD が «base へ branch を merge した ref»（PR の merge ref）なら、第 2 親が ticket の tip で、
  # 第 1 親が merge 前の base である。第 2 親がすでに base に入っていて HEAD 自身は入っていないなら、
  # それは base を取り込み直した merge なので、tip は HEAD のまま。
  if [ -n "$pdh_review_base" ] &&
     git rev-parse --verify 'HEAD^2' >/dev/null 2>&1 &&
     git merge-base --is-ancestor 'HEAD^1' "$pdh_review_base" &&
     { git merge-base --is-ancestor HEAD "$pdh_review_base" ||
       ! git merge-base --is-ancestor 'HEAD^2' "$pdh_review_base"; }; then
    pdh_review_tip=$(git rev-parse 'HEAD^2') || return 2
    pdh_review_exclude=$(git rev-parse 'HEAD^1') || return 2
  fi
}
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

if [ "$#" -ne 4 ] || [ "$2" != --from ]; then
  printf '使い方: %s <ticket ディレクトリ> --from close-gate|last-review --commits|--stat|--prompt\n' "$0" >&2
  exit 64
fi
ticket_dir=$1
from=$3
mode=$4
case "$from:$mode" in
  close-gate:--commits|close-gate:--stat|close-gate:--prompt|last-review:--commits|last-review:--stat|last-review:--prompt) ;;
  *) printf 'pdh-review-range: 起点か出力モードが不正です\n' >&2; exit 64 ;;
esac
[ -f "$ticket_dir/progress.md" ] || {
  printf 'pdh-review-range: %s/progress.md がありません\n' "$ticket_dir" >&2
  exit 2
}
start=$(pdh_review_sha_records "$ticket_dir/progress.md" "$from" | awk 'END { print }') || exit 2
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
pdh_review_tickets_dir || exit 2
# 記録の範囲は skill pdh-review「記録だけの差分」に従い、各 ticket のディレクトリ全体を除く。
paths=(':(top)**' ":(top,exclude)$pdh_tickets")
if ! git merge-base --is-ancestor "$start" "$tip"; then
  printf 'pdh-review-range: 起点が tip の履歴に無い（rebase か amend）。close 前 review を回し直し、progress.md に新しい SHA を追記する（起点: %s / tip: %s）\n' "$start" "$tip" >&2
  exit 2
fi
# base から届く commit を除けば、base の取り込みで入った変更だけが外れ、sub-branch を merge して
# 入った ticket 自身の commit は残る。（diff の基点を渡す形 `--base` などは HEAD との merge-base を
# 取るので、base を取り込み直した branch ではこの区間にならない。）base が分からないときと、base の上で直接作業しているとき
# （tip が base に含まれる）だけは first-parent で近似する。
if [ -n "$pdh_review_exclude" ] && ! git merge-base --is-ancestor "$tip" "$pdh_review_exclude"; then
  commits=$(git log --no-merges --format='%H %s' "$start..$tip" --not "$pdh_review_exclude" -- "${paths[@]}") || exit 2
  merges=$(git log --merges --format='%H' "$start..$tip" --not "$pdh_review_exclude") || exit 2
else
  commits=$(git log --first-parent --no-merges --format='%H %s' "$start..$tip" -- "${paths[@]}") || exit 2
  merges=$(git log --first-parent --merges --format='%H' "$start..$tip") || exit 2
fi
# 通常 commit と同じ到達範囲の merge を調べ、子 branch 内の競合解消も review に含める。
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  # 3 親以上の merge は --remerge-diff が黙って何も出さないので、常に含める。
  if ! git rev-parse -q --verify "$sha^3" >/dev/null &&
     delta=$(git show --remerge-diff --format= "$sha" -- "${paths[@]}" 2>/dev/null); then
    [ -n "$delta" ] || continue
  fi
  row=$(git show -s --format='%H %s' "$sha") || exit 2
  commits="${commits:+$commits
}$row"
done <<< "$merges"
case "$mode" in
  --commits)
    [ -z "$commits" ] || printf '%s\n' "$commits"
    ;;
  --stat)
    # rename 表記によるパスの揺れを避け、各 commit の追加・削除を合計する。
    # バイナリはファイル数だけに含める。
    while read -r sha subject; do
      [ -n "$sha" ] || continue
      if git rev-parse -q --verify "$sha^3" >/dev/null; then
        git diff --numstat --no-renames "$sha^1" "$sha" -- "${paths[@]}" || exit 2
      elif git rev-parse --verify "$sha^2" >/dev/null 2>&1; then
        git show --remerge-diff --format= --numstat --no-renames "$sha" -- "${paths[@]}" 2>/dev/null ||
          git diff --numstat --no-renames "$sha^1" "$sha" -- "${paths[@]}" || exit 2
      else
        git show --format= --numstat --no-renames "$sha" -- "${paths[@]}" || exit 2
      fi
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
    printf '%s\n' 'これらの commit だけを `git show <sha>` で読んで review する。merge commit は `git show --remerge-diff <sha>`（未対応なら `git diff <sha>^1 <sha>`）で競合解消を読む。一覧に無い commit（main から merge で入った変更を含む）は review の対象にしない。各 commit の変更が、ticket の既存コードと組み合わさって起こす欠陥も見る。'
    ;;
esac
exit 0
