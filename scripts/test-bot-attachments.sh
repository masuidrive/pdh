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

# 実際の token 定義と push 成功時の認証判定を実行する（ネットワーク不要）。
ra=github-bot/.github/coding-bot/run-action.sh
grep '^    ARTIFACTS_PUSH_TOKEN=' "$ra" > "$tmp/artifact-auth.sh"
awk '/^        ARTIFACT_PUSH_AUTH=pat$/ {copy=1}
     copy && /^      elif / {exit}
     copy {print}' "$ra" >> "$tmp/artifact-auth.sh"
for pat in test-pat '' unset; do
  (
    GITHUB_TOKEN=test-github
    CODING_BOT_GH_PAT=$pat
    expected_token=test-pat
    expected_auth=pat
    if [ "$pat" != test-pat ]; then
      expected_token=test-github
      expected_auth=github_token
    fi
    [ "$pat" != unset ] || unset CODING_BOT_GH_PAT
    source "$tmp/artifact-auth.sh"
    test "$ARTIFACTS_PUSH_TOKEN" = "$expected_token"
    test "$ARTIFACT_PUSH_AUTH" = "$expected_auth"
  )
done
echo 'PASS: artifact push token/auth (PAT set, empty, unset)'
