#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
distribution_set="${1:?usage: test-ticket-template-drift.sh <claude|codex>}"
CHECK="$ROOT_DIR/$distribution_set/templates/check-ticket-template-drift.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_run() {
  local expected="$1" status=0
  shift
  bash "$CHECK" "$@" > "$tmp_dir/output" 2>&1 || status=$?
  if [[ "$status" != "$expected" ]]; then
    cat "$tmp_dir/output" >&2
    fail "expected exit $expected, got $status"
  fi
}

assert_output() {
  grep -Fq -- "$1" "$tmp_dir/output" || fail "output does not contain: $1"
}

cat > "$tmp_dir/upstream.yaml" <<'YAML'
setting: upstream
note_content: |
  # note

  # indented comment
  last note line

# top-level comment
default_content: |
  # ticket

  last ticket line

other: upstream
YAML
sed 's/: upstream$/: local/; s/# top-level comment/# different comment/' \
  "$tmp_dir/upstream.yaml" > "$tmp_dir/local.yaml"
assert_run 0 --upstream-file "$tmp_dir/upstream.yaml" --local-file "$tmp_dir/local.yaml"
assert_output 'note_content: 0 差分行'
assert_output 'default_content: 0 差分行'

for key in note_content default_content; do
  case "$key" in note_content) word=note ;; default_content) word=ticket ;; esac
  sed "s/last $word line/changed $word line/" "$tmp_dir/local.yaml" > "$tmp_dir/changed.yaml"
  assert_run 1 --upstream-file "$tmp_dir/upstream.yaml" --local-file "$tmp_dir/changed.yaml"
  assert_output "$key: 2 差分行"
  assert_output "--- upstream/$key"
  assert_output "+++ local/$key"
  assert_output "-  last $word line"
  assert_output "+  changed $word line"

  sed "/^$key: |$/d" "$tmp_dir/upstream.yaml" > "$tmp_dir/missing.yaml"
  assert_run 2 --upstream-file "$tmp_dir/missing.yaml" --local-file "$tmp_dir/local.yaml"
  assert_output "ERROR: $tmp_dir/missing.yaml: $key: |"
  assert_run 2 --upstream-file "$tmp_dir/upstream.yaml" --local-file "$tmp_dir/missing.yaml"
  assert_output "ERROR: $tmp_dir/missing.yaml: $key: |"
done

# 空行も差分として数える。本文のコメントは抽出を終わらせない。
sed '/^$/d' "$tmp_dir/local.yaml" > "$tmp_dir/no-blanks.yaml"
assert_run 1 --upstream-file "$tmp_dir/upstream.yaml" --local-file "$tmp_dir/no-blanks.yaml"
assert_output 'note_content: 2 差分行'
assert_output 'default_content: 2 差分行'
sed 's/indented comment/changed comment/' "$tmp_dir/local.yaml" > "$tmp_dir/comment.yaml"
assert_run 1 --upstream-file "$tmp_dir/upstream.yaml" --local-file "$tmp_dir/comment.yaml"
assert_output 'note_content: 2 差分行'

assert_run 2 --upstream-file "$tmp_dir/absent.yaml" --local-file "$tmp_dir/local.yaml"
assert_output 'ERROR: ファイルを読めません'
assert_run 2 --upstream-file
assert_output 'path が必要です'

assert_run 2 pinned-ref --upstream-file "$tmp_dir/upstream.yaml" --local-file "$tmp_dir/local.yaml"
assert_output "ref と --upstream-file は同時に指定できません"

# curl の失敗をオフラインで再現し、ローカルへの代替で成功しないことを確かめる。
mkdir "$tmp_dir/bin"
printf '#!/usr/bin/env bash\nexit 22\n' > "$tmp_dir/bin/curl"
chmod +x "$tmp_dir/bin/curl"
PATH="$tmp_dir/bin:$PATH" assert_run 2 pinned-ref --local-file "$tmp_dir/local.yaml"
assert_output 'ERROR: 上流の取得に失敗しました'
assert_output '/pinned-ref/claude/templates/.ticket-config.yaml'
PATH="$tmp_dir/bin:$PATH" assert_run 2 pinned-ref --set codex --local-file "$tmp_dir/local.yaml"
assert_output '/pinned-ref/codex/templates/.ticket-config.yaml'
assert_run 2 --set other --local-file "$tmp_dir/local.yaml"
assert_output '--set には claude か codex を指定してください'

echo "test-ticket-template-drift.sh ($distribution_set): PASS"
