#!/usr/bin/env bash
# 偽の上流と導入先の履歴で、同期前の lock 更新と close を拒否する契約を検査する。
set -uo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
TMP_DIR=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
must() { "$@" || fail "準備コマンドが失敗しました: $*"; }
# 他の検査条件を満たす skill の出力を置き、記録検査の各条件を個別に試す。
install_stage_fixture() {
  local repo=$1 st skill
  must cp "$ROOT_DIR/scripts/pdh-stage-checklist.sh" "$repo/scripts/"
  for st in ticket-write open ticket-review ticket-human-review implement review verify human-review close; do
    skill=$st
    case "$st" in ticket-human-review|human-review) skill=pm ;; esac
    must mkdir -p "$repo/.claude/skills/pdh-$skill"
    printf -- '- [ ] PDH-%s: 証拠がある\n' "$st" >> "$repo/.claude/skills/pdh-$skill/SKILL.md"
  done
}
checks=0
expect() {
  local expected=$1 label=$2 actual
  shift 2
  output=$("$@" 2>&1); actual=$?
  [ "$actual" -eq "$expected" ] || fail "$label: exit ${actual}（期待 ${expected}）: $output"
  checks=$((checks + 1))
}
contains() { [[ "$output" == *"$1"* ]] || fail "出力に $1 がありません: $output"; }
excludes() { [[ "$output" != *"$1"* ]] || fail "出力に $1 が混入しました: $output"; }
commit() { must git add .; must git -c commit.gpgsign=false commit -qm "$1"; }
lock() { bash scripts/pdh-lock.sh "$@"; }
write_lock() { lock write --upstream "$TMP_DIR/upstream" --map "$TMP_DIR/map.tsv"; }
status() { printf '## Status: %s\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 回答待ち 発行先: /board\n' "$1" > tickets/sample/note.md; }
gate() { printf 'review-sha: %s\nclose-gate-sha: %s\n' "$(git rev-parse HEAD)" "$(git rev-parse HEAD)" > tickets/sample/progress.md; }

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GITHUB_BASE_REF GITHUB_HEAD_REF GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR=
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME='検査用' GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_DATE='2026-01-01T00:00:00Z' GIT_COMMITTER_DATE='2026-01-01T00:00:00Z'
must mkdir -p "$TMP_DIR/upstream/skills/nested" "$TMP_DIR/repo/scripts"
must git -C "$TMP_DIR/upstream" init -q -b main
printf 'skill\n' > "$TMP_DIR/upstream/skills/SKILL.md"
printf 'space\n' > "$TMP_DIR/upstream/skills/nested/file name.md"
printf '\000\001\377' > "$TMP_DIR/upstream/guide.md"
must ln -s ../guide.md "$TMP_DIR/upstream/skills/link"
must ln -s nested "$TMP_DIR/upstream/skills/link-dir"
must cd "$TMP_DIR/upstream"
commit 上流
upstream_sha=$(git rev-parse HEAD)
must cd "$TMP_DIR/repo"
must git init -q -b main
must cp "$ROOT_DIR/scripts/pdh-lock.sh" "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" scripts/
install_stage_fixture "$PWD"
must mkdir -p local/nested
must cp "$TMP_DIR/upstream/skills/SKILL.md" local/SKILL.md
must cp "$TMP_DIR/upstream/skills/nested/file name.md" 'local/nested/file name.md'
must cp "$TMP_DIR/upstream/guide.md" z-guide.md
printf 'guide.md\tz-guide.md\nskills/\tlocal/\n' > "$TMP_DIR/map.tsv"

expect 0 'help' lock -h
contains 'dir:<local dir>'
expect 0 'lock 無し' lock check
contains '未導入のため検査対象なし（成功）'
printf '未同期\n' > local/SKILL.md
expect 1 '初回の不一致では lock を作らない' write_lock
contains 'local/SKILL.md: lock と sha256 が違う'
[ ! -e .pdh-lock ] || fail '不一致の lock が生成された'
must cp "$TMP_DIR/upstream/skills/SKILL.md" local/SKILL.md
expect 0 '一致時に lock を書く' write_lock
must cp .pdh-lock "$TMP_DIR/old-lock"
[ "$(head -n 1 .pdh-lock)" = "# upstream: masuidrive/pdh@$upstream_sha" ] || fail 'upstream SHA が違う'
[ "$(wc -l < .pdh-lock | tr -d ' ')" = 4 ] || fail 'symlink を lock に含めた'
[ "$(sed -n '2p' .pdh-lock | cut -f1,4)" = $'local/SKILL.md\tdir:local' ] || fail 'local 順か dir の記録が違う'
expected_hash=$({ sha256sum < "$TMP_DIR/upstream/guide.md" 2>/dev/null || shasum -a 256 < "$TMP_DIR/upstream/guide.md"; } | awk '{print $1}')
[ "$(tail -n 1 .pdh-lock | cut -f3)" = "$expected_hash" ] || fail '上流のバイト列の hash ではない'
expect 0 '一致する check' lock check
expect 0 '一致する diff' lock diff --upstream "$TMP_DIR/upstream"
# macOS と同じく sha256sum が無い PATH でも shasum で同じ lock を作る。
must mkdir "$TMP_DIR/bsd-path"
for tool in dirname mktemp rm git awk find head tail cut sort grep shasum cp chmod mv; do
  tool_path=$(command -v "$tool") || fail "必要なコマンドがありません: $tool"
  must ln -s "$tool_path" "$TMP_DIR/bsd-path/$tool"
done
expect 0 'shasum で write できる' env PATH="$TMP_DIR/bsd-path" "$BASH" scripts/pdh-lock.sh write --upstream "$TMP_DIR/upstream" --map "$TMP_DIR/map.tsv"
must cmp .pdh-lock "$TMP_DIR/old-lock"
expect 0 'shasum で check できる' env PATH="$TMP_DIR/bsd-path" "$BASH" scripts/pdh-lock.sh check
printf '未同期\n' > local/SKILL.md
expect 1 'ローカル変更を検出する' lock check
contains 'local/SKILL.md: lock と sha256 が違う'
expect 1 '不一致の write は既存 lock を保つ' write_lock
must cmp .pdh-lock "$TMP_DIR/old-lock"
expect 1 'diff で変更を一覧する' lock diff --upstream "$TMP_DIR/upstream"
contains 'local/SKILL.md: 上流と内容が違う'
must cp local/SKILL.md "$TMP_DIR/upstream/skills/SKILL.md"
expect 0 'diff は lock の hash ではなく現在の上流と比べる' lock diff --upstream "$TMP_DIR/upstream"
must git -C "$TMP_DIR/upstream" restore skills/SKILL.md
must cp "$TMP_DIR/upstream/skills/SKILL.md" local/SKILL.md
printf '追加\n' > local/nested/extra.md
expect 1 'dir の追加ファイルを検出する' lock check
contains 'local/nested/extra.md: lock に無いファイル'
expect 1 '追加ファイルを残したまま write できない' write_lock
must cmp .pdh-lock "$TMP_DIR/old-lock"
must rm local/nested/extra.md
must mv local/nested "$TMP_DIR/local-nested"
must ln -s "$TMP_DIR/local-nested" local/nested
expect 1 'ローカルの親 symlink を辿らない' lock check
contains 'local/nested/file name.md: ローカルに通常ファイルが無い'
must rm local/nested
must mv "$TMP_DIR/local-nested" local/nested
must rm z-guide.md
expect 1 '削除を検出する' lock check
contains 'z-guide.md: ローカルに通常ファイルが無い'
must cp "$TMP_DIR/upstream/guide.md" z-guide.md
commit 導入先
base=$(git rev-parse HEAD)
must git checkout -qb features/sample
printf '別の変更\n' > other.txt
commit 対象外
printf '未同期\n' > local/SKILL.md
expect 0 '範囲外は warning にする' lock check --paths-from "$base..HEAD"
contains 'local/SKILL.md: warning:'
expect 2 '不正な git range を無視しない' lock check --paths-from missing..HEAD
contains 'git diff の範囲を解決できません'
commit 共有ファイルを変更
expect 1 '範囲内の変更を拒否する' lock check --paths-from "$base..HEAD"
excludes 'warning:'
must mv local/SKILL.md local/renamed.md
commit 名前を変更
expect 1 'rename の旧 path の削除を検出する' lock check --paths-from HEAD^..HEAD
contains 'local/SKILL.md: ローカルに通常ファイルが無い'
contains 'local/renamed.md: lock に無いファイル'
must rm local/renamed.md
must cp "$TMP_DIR/upstream/skills/SKILL.md" local/SKILL.md

# close 検査を実際の入口から回す。既存の review gate は先に満たしておく。
must mkdir -p tickets/sample
printf '### Why\n同期の検査\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/sample/ticket.md
status PDH-close
gate
commit ticketの記録
gate
expect 0 '同期済みなら close 検査が通る' bash scripts/check-pdh-ticket.sh
printf '未同期\n' > local/SKILL.md
commit close前の共有ファイル変更
gate
expect 1 'close 検査が同期前の変更を拒否する' bash scripts/check-pdh-ticket.sh
contains '上流へ同期して pdh-lock.sh write で lock を進めるか、上流の版に戻す'
excludes 'もう一度 close 前 review'
status PDH-human-review
expect 1 'human-review でも同期を検査する' bash scripts/check-pdh-ticket.sh
status PDH-implement
expect 0 '実装途中の変更は許す' bash scripts/check-pdh-ticket.sh
status PDH-close
must mv scripts/pdh-lock.sh "$TMP_DIR/pdh-lock.sh"
expect 0 'script 未導入の repo は従来どおり通る' bash scripts/check-pdh-ticket.sh
must mv "$TMP_DIR/pdh-lock.sh" scripts/pdh-lock.sh
must cp "$TMP_DIR/upstream/skills/SKILL.md" local/SKILL.md
commit 上流の版に戻す
gate
expect 0 '上流の版に戻すと close 検査が通る' bash scripts/check-pdh-ticket.sh

# base は固定の main ではなく、既存の review と同じ設定から解決する。
must git branch release HEAD
printf 'default_branch: release\nbranch_prefix: features/\n' > .ticket-config.yaml
printf '未同期\n' > local/SKILL.md
commit releaseからの変更
gate
expect 1 '設定した default_branch の範囲を検査する' bash scripts/check-pdh-ticket.sh
contains 'local/SKILL.md: lock と sha256 が違う'
must git update-ref refs/remotes/origin/release HEAD
expect 0 'base 側だけのずれは close を止めない' bash scripts/check-pdh-ticket.sh
contains 'local/SKILL.md: warning:'
printf 'default_branch: unknown\nbranch_prefix: features/\n' > .ticket-config.yaml
expect 1 'base 不明の close を素通りさせない' bash scripts/check-pdh-ticket.sh
contains 'ticket の base を解決できません'
expect 0 'PR の base を設定より優先する' env GITHUB_BASE_REF=release bash scripts/check-pdh-ticket.sh
contains 'local/SKILL.md: warning:'

# PR merge ref は、merge 前の第 1 親と HEAD の差分を検査する。
printf 'default_branch: main\nbranch_prefix: features/\n' > .ticket-config.yaml
commit PR用の設定
gate
commit reviewの記録
must git checkout -q --detach main
must git -c commit.gpgsign=false merge --no-ff -qm PRのmerge参照 features/sample
expect 1 'PR merge ref でも共有ファイルの変更を拒否する' bash scripts/check-pdh-ticket.sh
contains 'local/SKILL.md: lock と sha256 が違う'
excludes 'もう一度 close 前 review'

must cp "$TMP_DIR/old-lock" .pdh-lock
printf 'guide.md\tz-guide.md\nskills/\tlocal/\nskills/SKILL.md\tlocal/SKILL.md\n' > "$TMP_DIR/overlap.tsv"
expect 2 '重複する map を拒否する' lock write --upstream "$TMP_DIR/upstream" --map "$TMP_DIR/overlap.tsv"
must cmp .pdh-lock "$TMP_DIR/old-lock"
printf 'broken\n' > .pdh-lock
expect 2 '壊れた lock を通さない' lock check
must rm .pdh-lock
expect 0 'lock 導入前の repo を止めない' lock check --paths-from missing..HEAD

printf 'pdh_lock_test: %s checks passed\n' "$checks"
