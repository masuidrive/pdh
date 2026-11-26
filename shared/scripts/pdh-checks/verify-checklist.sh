#!/usr/bin/env bash
# 検査: ready で定性チェックの全項目が確認済みか対象外で、各判断の根拠が記録されているか。
# 理由: 未確認の項目や根拠のない判断を残して完了承認を求めるのを防ぐ。
set -euo pipefail
[[ ${PDH_PHASE:-ready} != test ]] || exit 0
file="$1/checklist.md"
fail() { echo "$file:${line_no:-1}: $*" >&2; exit 1; }
[[ -f $file && ! -L $file ]] || fail "checklist.md が必要です"

item='^- \[(x|-)\] [[:space:]]*[^[:space:]]'
basis='^  根拠: [[:space:]]*[^[:space:]]'
heading='^#{1,6} [^[:space:]]'
line_no=0
count=0
need_basis=0
while IFS= read -r line || [[ -n $line ]]; do
    ((line_no+=1))
    line=${line%$'\r'}
    if (( need_basis )); then
        [[ $line =~ $basis ]] || fail "直前の項目に「  根拠: 判断の理由」を書いてください"
        need_basis=0
    elif [[ $line == '- [ ] '* ]]; then
        fail "未チェックの項目があります"
    elif [[ $line =~ $item ]]; then
        ((count+=1))
        need_basis=1
    elif [[ $line =~ $heading || -z ${line//[[:space:]]/} ]]; then
        continue
    else
        fail "項目は「- [x] 確認事項」または「- [-] 対象外の事項」で書いてください"
    fi
done < "$file"
(( ! need_basis )) || fail "最後の項目に根拠がありません"
(( count )) || fail "チェック項目がありません"
git ls-files --error-unmatch -- "$file" >/dev/null 2>&1 &&
    git diff --quiet HEAD -- "$file" &&
    git diff --cached --quiet HEAD -- "$file" || fail "判断を commit してから ready を実行してください"
