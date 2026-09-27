#!/usr/bin/env bash
# 非画像の添付を取得せず、本文への転記を依頼する runner の契約。
set -eu # run-action.sh と同じく、URL がない grep の結果は sort が吸収する
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
awk '/^FILE_URLS=/{copy=1} /^# システムプロンプト読み込み/{copy=0} copy' \
  github-bot/.github/coding-bot/run-action.sh > "$tmp/attachments.sh"
test -s "$tmp/attachments.sh"
# 取得を再導入したら、成功/失敗を握り潰していても検出する。
curl() { touch "$tmp/network-called"; return 1; }
export -f curl

ISSUE_BODY='画像だけ https://github.com/user-attachments/assets/example'
ALL_COMMENTS_JSON='[]'
source "$tmp/attachments.sh"
test -z "$FILES_SECTION"
echo 'PASS: 画像だけなら非画像の依頼なし'

ISSUE_BODY='[report.pdf](https://github.com/user-attachments/files/123/report.pdf)'
ALL_COMMENTS_JSON='[{"body":"https://github.com/user-attachments/files/123/report.pdf"},{"body":"https://github.com/user-attachments/files/124/log.txt"},{"body":null}]'
source "$tmp/attachments.sh"
test "$(printf '%s\n' "$FILE_LIST" | grep -c '^- report.pdf$')" = 1
printf '%s\n' "$FILE_LIST" | grep -qx -- '- log.txt'
printf '%s\n' "$FILES_SECTION" | grep -q '画像以外の添付は読めないので、中身を本文に貼ってほしい'
test ! -e "$tmp/network-called"
echo 'PASS: 本文・コメントのファイル名を重複なく案内し、取得しない'

ISSUE_BODY=''
ALL_COMMENTS_JSON='[]'
source "$tmp/attachments.sh"
test -z "$FILES_SECTION"
echo 'PASS: 添付なしなら依頼なし'
echo 'PASS: bot attachments (3 checks)'
