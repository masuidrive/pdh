#!/usr/bin/env bash
# 上流とローカルのテンプレ本文を比較する。差分行数は追加行と削除行の合計。
# Usage: bash scripts/check-ticket-template-drift.sh [<ref>] [--set claude|codex] [--upstream-file <path>] [--local-file <path>]
# --set は取得する上流の配布セット（既定 claude）。pdh-update では --upstream-file tmp/pdh/<set>/templates/.ticket-config.yaml を渡す。
set -euo pipefail
trap 'echo "ERROR: テンプレ比較を実行できませんでした (line $LINENO)" >&2; exit 2' ERR

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
local_file="$ROOT_DIR/.ticket-config.yaml"
upstream_file=""
ref="main"
distribution_set="claude"
ref_given=false

fail() {
  echo "ERROR: $*" >&2
  exit 2
}

while (($#)); do
  case "$1" in
    --upstream-file|--local-file)
      (($# >= 2)) && [[ -n "$2" && "$2" != --* ]] || fail "$1 には path が必要です"
      if [[ "$1" == --upstream-file ]]; then upstream_file="$2"; else local_file="$2"; fi
      shift 2
      ;;
    --set)
      (($# >= 2)) && [[ "$2" == claude || "$2" == codex ]] || fail "--set には claude か codex を指定してください"
      distribution_set="$2"
      shift 2
      ;;
    -*) fail "未知のオプション: $1" ;;
    *)
      [[ "$ref_given" == false && -n "$1" ]] || fail "上流 ref は 1 つだけ指定してください"
      ref="$1"
      ref_given=true
      shift
      ;;
  esac
done

if [[ "$ref_given" == true && -n "$upstream_file" ]]; then
  fail "ref と --upstream-file は同時に指定できません"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
if [[ -z "$upstream_file" ]]; then
  upstream_file="$tmp_dir/upstream.yaml"
  url="https://raw.githubusercontent.com/masuidrive/pdh/$ref/$distribution_set/templates/.ticket-config.yaml"
  curl --fail --silent --show-error --location --connect-timeout 10 --max-time 60 \
    "$url" -o "$upstream_file" || fail "上流の取得に失敗しました: $url"
fi

extract_block() {
  local file="$1" key="$2" output="$3"
  [[ -f "$file" && -r "$file" ]] || fail "ファイルを読めません: $file"
  # トップレベルの行（コメントを含む）で終了し、本文内の空行は保持する。
  awk -v key="$key" '
    $0 == key ": |" { found = 1; active = 1; next }
    active && /^[^[:space:]]/ { exit }
    active { print }
    END { if (!found) exit 2 }
  ' "$file" > "$output" || fail "$file: $key: | の本文を抽出できません"
}

# 片方の差分があっても、別のキーの欠落を差分 (exit 1) に埋もれさせない。
for key in note_content default_content; do
  extract_block "$upstream_file" "$key" "$tmp_dir/$key.upstream"
  extract_block "$local_file" "$key" "$tmp_dir/$key.local"
done

result=0
for key in note_content default_content; do
  diff_status=0
  diff -u --label "upstream/$key" --label "local/$key" \
    "$tmp_dir/$key.upstream" "$tmp_dir/$key.local" > "$tmp_dir/diff" || diff_status=$?
  ((diff_status <= 1)) || fail "$key の diff に失敗しました (exit $diff_status)"
  count="$(awk '/^@@/ { hunk = 1; next } hunk && /^[+-]/ { n++ } END { print n+0 }' "$tmp_dir/diff")"
  printf '%s: %s 差分行（追加＋削除）\n' "$key" "$count"
  cat "$tmp_dir/diff"
  if ((diff_status == 1)); then result=1; fi
done
exit "$result"
