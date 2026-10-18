#!/usr/bin/env bash
# review 区間と起票の証拠を、一時 repo の履歴・文書だけで検査する。
# 上流 masuidrive/pdh の scripts/test-pdh-ticket-checks.sh を、この repo の scripts/ に配置した写しへ向けたもの。
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
status() {
  printf '## Status: %s\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 承認の回答を待つ 発行先: /board\n' "$1" > tickets/sample/note.md
}
gate() { printf 'review-sha: %s\nclose-gate-sha: %s\n' "$1" "$1" > tickets/sample/progress.md; }

# 呼び出し元の git 設定・index・hook が一時 repo の履歴に干渉しないようにする。
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GITHUB_BASE_REF GITHUB_HEAD_REF TICKET_BASE_BRANCH GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR=
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME='検査用' GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_DATE='2026-01-01T00:00:00Z'
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
must mkdir -p "$TMP_DIR/repo/scripts" "$TMP_DIR/repo/tickets/sample"
must cp "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/repo/scripts/"
install_stage_fixture "$TMP_DIR/repo"
must cd "$TMP_DIR/repo"
must git init -q -b main
printf '初期値\n' > code.txt
printf '### Why\n区間を検査する\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/sample/ticket.md
status PDH-human-review
: > tickets/sample/progress.md
commit 初期状態
must git checkout -qb feature
printf 'review 済み\n' >> code.txt
commit review対象
anchor=$(git rev-parse HEAD)
gate "$anchor"
expect 0 '記録直後' bash scripts/check-pdh-ticket.sh
printf '追加したコード\n' >> code.txt
commit gate後のコード
own=$(git rev-parse HEAD)
expect 1 'gate 後の変更' bash scripts/check-pdh-ticket.sh
contains "$anchor"
contains '1 ファイル・追加 1 行・削除 0 行'
contains 'もう一度 close 前 review'
expect 0 '区間の commit' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --commits
[ "$output" = "$own gate後のコード" ] || fail "対象 commit が違います: $output"
must cd tickets/sample
expect 0 '子ディレクトリからの commit 区間' bash ../../scripts/pdh-review-range.sh . --from close-gate --commits
[ "$output" = "$own gate後のコード" ] || fail "cwd で対象 commit が変わりました: $output"
expect 0 '子ディレクトリからの行数集計' bash ../../scripts/pdh-review-range.sh . --from close-gate --stat
[ "$output" = '1 ファイル・追加 1 行・削除 0 行' ] || fail "cwd で集計が変わりました: $output"
expect 1 '子ディレクトリからの gate 検査' bash ../../scripts/check-pdh-ticket.sh
contains '1 ファイル・追加 1 行・削除 0 行'
must cd ../..
gate "$own"
printf '記録だけを追加\n' >> tickets/sample/progress.md
commit ticket記録だけ
expect 0 'tickets だけの commit' bash scripts/check-pdh-ticket.sh
expect 3 '空区間の prompt' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --prompt
contains '区間に ticket 自身の commit が無い'

must git checkout -q main
printf 'main の変更\n' > main.txt
commit main側の変更
main_sha=$(git rev-parse HEAD)
must git checkout -q feature
must git -c commit.gpgsign=false merge --no-ff -qm mainの取り込み main
expect 0 'main の merge だけ' bash scripts/check-pdh-ticket.sh
gate "$anchor"
expect 0 'main を除いた prompt' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --prompt
contains "$own gate後のコード"
excludes "$main_sha"
contains 'git show <sha>'
contains '既存コードと組み合わさって起こす欠陥'
printf '\n- review-sha: %s 説明\n' "${own:0:7}" >> tickets/sample/progress.md
expect 0 '後の review を選ぶ' bash scripts/pdh-review-range.sh tickets/sample --from last-review --commits
[ -z "$output" ] || fail "最新の review が起点になっていません: $output"
printf '\n- close-gate-sha: %s 説明\n' "$anchor" >> tickets/sample/progress.md
expect 0 '後の close gate を選ぶ' bash scripts/pdh-review-range.sh tickets/sample --from last-review --commits
contains "$own"

: > tickets/sample/progress.md
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 承認の回答を待つ 発行先: /board\n' > tickets/sample/note.md
status PDH-close
expect 1 'close の記録欠落' bash scripts/check-pdh-ticket.sh
contains 'close 前 review を回していない'
status PDH-human-review
expect 0 'human review の記録欠落は承認前の状態として許す' bash scripts/check-pdh-ticket.sh
expect 2 '区間の起点欠落' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --commits
gate deadbee
expect 1 '解決できない SHA' bash scripts/check-pdh-ticket.sh
contains deadbee
gate "$anchor"
commit PR用の記録
feature_tip=$(git rev-parse HEAD)
must git checkout -q main
must git -c commit.gpgsign=false merge --no-ff -qm PRのmerge参照 feature
expect 0 'PR の第 2 親から区間を取る' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --commits
[ "$output" = "$own gate後のコード" ] || fail "PR の対象 commit が違います: $output"
expect 0 'PR の prompt に tip を出す' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --prompt
contains "tip: $feature_tip"
expect 1 'PR の head 側の未 review 変更' bash scripts/check-pdh-ticket.sh
contains '1 ファイル・追加 1 行・削除 0 行'
must git clone -q --depth=1 "file://$TMP_DIR/repo" "$TMP_DIR/shallow"
must cd "$TMP_DIR/shallow"
expect 0 'shallow の未解決 SHA' env GITHUB_HEAD_REF=features/sample bash scripts/check-pdh-ticket.sh
contains 'shallow clone なので確かめられなかった'
must cd "$TMP_DIR/repo"
gate "$(git rev-parse HEAD)"
printf '置換後\n' > code.txt
printf '別のファイル\n' > other.txt
commit 複数ファイルを変更
printf '同じファイルを再変更\n' >> code.txt
commit 同じファイルへ追加
expect 0 'commit ごとの行数と重複しないファイル数' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --stat
[ "$output" = '2 ファイル・追加 3 行・削除 3 行' ] || fail "区間の集計が違います: $output"
printf '\nclose-gate-sha: invalid\n' >> tickets/sample/progress.md
expect 2 '最後の不正な記録を過去の記録で代用しない' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --commits

# 履歴を書き換えず、別の枝にだけ存在する SHA で rebase / amend 後の関係を作る。
must git checkout -qb old-history
printf '古い履歴\n' > old-history.txt
commit 古い起点
old_anchor=$(git rev-parse HEAD)
must git checkout -q main
gate "$old_anchor"
for mode in --commits --stat --prompt; do
  expect 2 '起点が tip の祖先でない' bash scripts/pdh-review-range.sh tickets/sample --from close-gate "$mode"
  contains '起点が tip の履歴に無い（rebase か amend）'
  contains 'close 前 review を回し直し、progress.md に新しい SHA を追記する'
done
expect 1 'gate 検査も祖先でない起点を拒否する' env GITHUB_HEAD_REF=features/sample bash scripts/check-pdh-ticket.sh

# done へ移した後の feature HEAD、PR merge ref、base 取込み済みを比較する。
must mkdir -p "$TMP_DIR/done-repo/scripts" "$TMP_DIR/done-repo/tickets/sample"
must cp scripts/check-pdh-ticket.sh scripts/pdh-review-range.sh "$TMP_DIR/done-repo/scripts/"
install_stage_fixture "$TMP_DIR/done-repo"
must cd "$TMP_DIR/done-repo"
must git init -q -b main
printf '初期値\n' > code.txt
printf '### Why\n区間を検査する\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/sample/ticket.md
status PDH-implement
: > tickets/sample/progress.md
commit 初期状態
base_sha=$(git rev-parse HEAD)
must git checkout -qb feature
printf 'review 済み\n' >> code.txt
commit review対象
gate "$(git rev-parse HEAD)"
commit gate記録
printf '未 review\n' >> code.txt
commit gate後の変更
must mkdir tickets/done
must git mv tickets/sample tickets/done/sample
commit doneへ移動
done_tip=$(git rev-parse HEAD)
expect 1 'done の Status に依らず feature HEAD で検査する' bash scripts/check-pdh-ticket.sh
contains 'tickets/done/sample'
contains '1 ファイル・追加 1 行・削除 0 行'
expect 0 'done ディレクトリの区間' bash scripts/pdh-review-range.sh tickets/done/sample --from close-gate --commits
contains 'gate後の変更'
must cd tickets/done/sample
expect 1 'done の子ディレクトリから gate 検査' bash ../../../scripts/check-pdh-ticket.sh
contains '1 ファイル・追加 1 行・削除 0 行'
must cd ../../..
must git checkout -q --detach main
must git -c commit.gpgsign=false merge --no-ff -qm PRのmerge参照 feature
expect 1 'done の PR merge ref で検査する' bash scripts/check-pdh-ticket.sh
contains '1 ファイル・追加 1 行・削除 0 行'
must git checkout -q feature
: > tickets/done/sample/progress.md
commit gate記録を欠くdone
expect 1 'done の gate 行欠落は Status に依らず拒否' bash scripts/check-pdh-ticket.sh
contains 'close 前 review を回していない'
must rm tickets/done/sample/note.md
expect 1 'done の note 欠落でも gate 検査する' bash scripts/check-pdh-ticket.sh
contains 'close 前 review を回していない'
must git restore tickets/done/sample/note.md
must git checkout -q --detach main
must git -c commit.gpgsign=false merge --no-ff -qm 記録なしのPR feature
expect 1 'PR merge ref でも done の gate 行欠落を拒否' bash scripts/check-pdh-ticket.sh
contains 'close 前 review を回していない'
must git checkout -q main
must git merge -q --ff-only feature
expect 0 'done が base に入った main は対象外' bash scripts/check-pdh-ticket.sh
# remote 側で close 済みでも、local main だけ古い場合がある。
must git update-ref refs/remotes/origin/main HEAD
must git checkout -qb stale-main-feature
must git update-ref refs/heads/main "$base_sha"
expect 0 'local main が古くても remote の done は対象外' bash scripts/check-pdh-ticket.sh
must git update-ref refs/heads/main origin/main
must git update-ref -d refs/remotes/origin/main
# main から merge で入った done は、branch 自身の追加として数えない。
must git checkout -qb other-feature "$base_sha"
printf '別 branch\n' > other.txt
commit 別branchの変更
must git -c commit.gpgsign=false merge --no-ff -qm mainの取込み main
expect 0 'main を merge して入った done は対象外' bash scripts/check-pdh-ticket.sh
must git checkout -qb cancel "$done_tip"
must git mv tickets/done/sample tickets/done/260101-000000-CANCELED-sample
commit cancelへ変更
must git update-ref refs/heads/main "$base_sha"
expect 0 'cancel は done 検査の対象外' bash scripts/check-pdh-ticket.sh
must git checkout -q feature
# base の優先順位と、不在時に done を検査しないこと。
# ./ticket.sh close の pre_close_command から呼ばれると、merge 先が TICKET_BASE_BRANCH で渡る。
must git branch -f release feature
export TICKET_BASE_BRANCH=release
expect 0 'close が渡した TICKET_BASE_BRANCH を main より優先する' bash scripts/check-pdh-ticket.sh
export TICKET_BASE_BRANCH=missing
expect 1 'TICKET_BASE_BRANCH の branch が無ければ main を使う' bash scripts/check-pdh-ticket.sh
unset TICKET_BASE_BRANCH
must git branch -D -q release
must git update-ref refs/remotes/origin/release feature
export GITHUB_BASE_REF=release
expect 0 'origin の PR base を main より優先する' bash scripts/check-pdh-ticket.sh
# PR base が main より古くても、main を base にして done の追加を見落とさない。
saved_main=$(git rev-parse main)
must git update-ref refs/remotes/origin/release "$base_sha"
must git update-ref refs/heads/main HEAD
expect 1 '古い PR base を main に置き換えない' bash scripts/check-pdh-ticket.sh
must git update-ref refs/heads/main "$saved_main"
export GITHUB_BASE_REF=missing
expect 1 'PR base が無ければ main を使う' bash scripts/check-pdh-ticket.sh
must git branch -m main saved-main
must git update-ref refs/remotes/origin/main "$base_sha"
expect 1 'main が無ければ origin/main を使う' bash scripts/check-pdh-ticket.sh
must git update-ref -d refs/remotes/origin/main
expect 0 '候補の base が無ければ done は対象外' bash scripts/check-pdh-ticket.sh
unset GITHUB_BASE_REF
must git branch trunk "$base_sha"
for value in trunk '"trunk"' "'trunk'"; do
  printf 'default_branch: %s\n' "$value" > .ticket-config.yaml
  expect 1 'default_branch の trunk を base にする' bash scripts/check-pdh-ticket.sh
  contains 'close 前 review を回していない'
done
must git update-ref refs/remotes/origin/trunk HEAD
expect 0 '新しい origin/trunk を local trunk より優先する' bash scripts/check-pdh-ticket.sh
must cd tickets/done/sample
expect 0 '子ディレクトリから repo root の default_branch を読む' bash -c '
  source ../../../scripts/pdh-review-range.sh
  pdh_review_base_tip || exit 1
  printf "%s\n" "$pdh_review_base"
'
[ "$output" = origin/trunk ] || fail "設定した base が違います: $output"

# 起票の検査は別の repo で行い、close gate の記録と切り離す。
must mkdir -p "$TMP_DIR/intake-repo/scripts" "$TMP_DIR/intake-repo/tickets/sample"
must cp "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/intake-repo/scripts/"
install_stage_fixture "$TMP_DIR/intake-repo"
must cd "$TMP_DIR/intake-repo"
must git init -q -b main
printf '### Why\n起票の根拠を検査する\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/sample/ticket.md
: > tickets/sample/progress.md
note=tickets/sample/note.md
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [x] 起票: 問題 → missing\n' > "$note"
expect 1 '実在しない起票先' bash scripts/check-pdh-ticket.sh
contains "$note:12: - [x] 起票: 問題 → missing"
contains 'ticket を作ってから名前を書く（./ticket.sh new）'
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: 問題 → \n' > "$note"
expect 1 '起票先が空' bash scripts/check-pdh-ticket.sh
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: 問題 → 260101-000000-name/child\n' > "$note"
expect 1 'slash を含む起票先は拒否' bash scripts/check-pdh-ticket.sh
contains 'ticket 名の形ではない'
for name in done README 260101-000000-empty; do
  must mkdir -p "tickets/$name"
  : > "tickets/$name.md"
  # 名前の形が不正なときは、ticket.md があっても通さない。
  if [ "$name" != 260101-000000-empty ]; then
    : > "tickets/$name/ticket.md"
    : > "tickets/$name/progress.md"
  else
    must rm "tickets/$name.md"
  fi
  printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: 問題 → %s\n' "$name" > "$note"
  expect 1 '名前の形または ticket.md が無い' bash scripts/check-pdh-ticket.sh
  must rm -rf "tickets/$name" "tickets/$name.md"
done
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n' > "$note"
for form in directory flat; do
  self=260101-000000-self
  if [ "$form" = directory ]; then
    must mkdir -p "tickets/$self"
    printf '### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n' > "tickets/$self/ticket.md"
    : > "tickets/$self/progress.md"
    self_note="tickets/$self/note.md"
  else
    : > "tickets/$self.md"
    self_note="tickets/$self-note.md"
  fi
  printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: 問題 → %s\n' "$self" > "$self_note"
  if [ "$form" = directory ]; then
    expect 1 'note を持つ ticket 自身への起票' bash scripts/check-pdh-ticket.sh
    contains 'note を持つ ticket 自身は起票先にできない'
  else
    expect 0 'flat note の自己参照は対象外' bash scripts/check-pdh-ticket.sh
  fi
  must rm "$self_note"
done
for row in '  - [ ] 起票: 問題 → missing' '* [x] 起票: 問題 → missing' '- [X] 起票： 問題 → missing' '- [ ] 起票: の扱いを確認する'; do
  printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n%s\n' "$row" > "$note"
  expect 1 'checkbox 直後の起票行を検査' bash scripts/check-pdh-ticket.sh
done
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 本文に起票: を含む todo\n' > "$note"
expect 0 '本文にある起票は対象外' bash scripts/check-pdh-ticket.sh
for root in tickets tickets/done; do
  must mkdir -p "$root/260101-000000-CANCELED-empty"
  printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: 問題 → 260101-000000-empty\n' > "$note"
  expect 1 'cancel でも ticket.md のないディレクトリは拒否' bash scripts/check-pdh-ticket.sh
  for form in directory flat canceled-directory canceled-flat; do
    name="260101-000000-$form"
    case "$form" in
      directory) must mkdir -p "$root/$name"; printf '### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n' > "$root/$name/ticket.md"; : > "$root/$name/progress.md" ;;
      flat) : > "$root/$name.md" ;;
      canceled-directory) must mkdir -p "$root/260101-000000-CANCELED-$form"; printf '### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n' > "$root/260101-000000-CANCELED-$form/ticket.md"; : > "$root/260101-000000-CANCELED-$form/progress.md" ;;
      canceled-flat) : > "$root/CANCELED-$name.md" ;;
    esac
    printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [X] 起票: 問題 → `%s` 説明\n' "$name" > "$note"
    expect 0 "$root の $form" bash scripts/check-pdh-ticket.sh
    if [ "$form" = canceled-flat ]; then
      printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: 問題 → CANCELED-%s\n' "$name" > "$note"
      expect 0 "$root の cancel 済み flat ticket の現在名" bash scripts/check-pdh-ticket.sh
    fi
    for prefix in '  - [ ] 起票:' '* [x] 起票:' '- [X] 起票：'; do
      printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n%s 問題 → %s\n' "$prefix" "$name" > "$note"
      expect 0 '起票行の表記が違っても実在先は通る' bash scripts/check-pdh-ticket.sh
    done
    case "$form" in
      directory) must rm "$root/$name/ticket.md" "$root/$name/progress.md"; must rmdir "$root/$name" ;;
      flat) must rm "$root/$name.md" ;;
      canceled-directory) must rm "$root/260101-000000-CANCELED-$form/ticket.md" "$root/260101-000000-CANCELED-$form/progress.md"; must rmdir "$root/260101-000000-CANCELED-$form" ;;
      canceled-flat) must rm "$root/CANCELED-$name.md" ;;
    esac
  done
done
printf '%s\n' '## Status: PDH-ticket-review' '## Checklist' '- [x] PDH-ticket-review: 証拠がある' '- [-] 起票: 除外 → missing' '<!--' '- [ ] 起票: 見本 → missing' '-->' '<!-- 閉じたコメント --><!-- - [x] 起票: 見本 → missing -->' '## 別の節' '- [ ] 起票: 対象外 → missing' > "$note"
expect 0 '除外した行と HTML コメント' bash scripts/check-pdh-ticket.sh
for inline in '`<!--`' '`` ` <!-- ``' '`<!--` <!-- 本物のコメント -->'; do
  printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n説明: %s\n- [ ] 起票: 問題 → 260101-000000-missing\n' "$inline" > "$note"
  expect 1 'inline code のコメント記号で後続行を消さない' bash scripts/check-pdh-ticket.sh
  contains "$note:13:"
done
# inline code を残してコメントだけ消す処理を、入口から観測する。
printf '%s\n' '## Status: PDH-ticket-review' '## Checklist' '- [x] PDH-ticket-review: 証拠がある' '前 `<!--` 後 <!-- コメント -->末尾' '`` ` <!-- `` <!-- コメント -->終端' '<!-- ` コメント' '続く -->' '- [ ] 起票: 問題 → 260101-000000-missing' > "$note"
expect 1 'inline code を保持し実際のコメントだけを除く' bash scripts/check-pdh-ticket.sh
contains "$note:8:"
# 次の正常経路に、拒否用の起票行を残さない。
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n' > "$note"
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: 問題 → missing\n' > tickets/old-note.md
expect 0 'flat note は対象外' bash scripts/check-pdh-ticket.sh
must cp tickets/old-note.md tickets/sample/progress.md
expect 0 'note 以外を無視する' bash scripts/check-pdh-ticket.sh
must rm tickets/old-note.md
expect 0 '起票の正常経路' bash scripts/check-pdh-ticket.sh

new_ticket=tickets/260201-000000-new/ticket.md
must mkdir -p "${new_ticket%/*}"
printf '### Why\n根拠なし\n' > "$new_ticket"
: > "${new_ticket%/*}/progress.md"
expect 1 'HEAD が無くても根拠なしを拒否' bash scripts/check-pdh-ticket.sh
contains $'Reproduction-or-measurement:\nWhy-not-fix-now:'
contains "$new_ticket"
contains '要望起点なら'
excludes 'Slack'
printf '### Why\nReproduction-or-measurement: 検査を実行して確認した\nWhy-not-fix-now: 別の問題で修正費用が大きい\n' > "$new_ticket"
expect 0 '根拠の 2 行がある' bash scripts/check-pdh-ticket.sh
# 守る対象を 1 つだけ壊す。Why の 2 行のうち理由だけを空にする。
printf '### Why\nReproduction-or-measurement: 検査を実行して確認した\nWhy-not-fix-now: \n' > "$new_ticket"
expect 1 '理由だけが空' bash scripts/check-pdh-ticket.sh
contains $'空です:\nWhy-not-fix-now:\n'
for heading in '### Why' '### Why / Intent'; do
  for prefix in '' '- ' '- [ ] ' '- [x] ' '- [X] '; do
    printf '%s\n  %sreproduction-or-measurement： 確認した結果\n  %sWHY-NOT-FIX-NOW: 該当なし\n' "$heading" "$prefix" "$prefix" > "$new_ticket"
    expect 0 "$heading と接頭辞 $prefix（大文字・小文字を区別しない）" bash scripts/check-pdh-ticket.sh
  done
done
printf '### Why\nReproduction-or-measurement: <!-- 見本 -->\nWhy-not-fix-now: 理由\n' > "$new_ticket"
expect 1 '再現だけが空（コメントは数えない）' bash scripts/check-pdh-ticket.sh
contains $'空です:\nReproduction-or-measurement:\n'
printf '%s\n' '### Why' 'Reproduction-or-measurement: `<!--` の表示を確認した' 'Why-not-fix-now: 別の問題' > "$new_ticket"
expect 0 'Why の inline code の後も根拠を読む' bash scripts/check-pdh-ticket.sh
printf '%s\n' '### Why' 'Reproduction-or-measurement: `<!--`' 'Why-not-fix-now: `` ` <!-- ``' > "$new_ticket"
expect 0 'inline code だけの値も空にしない' bash scripts/check-pdh-ticket.sh
for heading in '# 次の節' '## 次の節' '### 次の節'; do
  printf '### Why\n<!--\nReproduction-or-measurement: 見本\nWhy-not-fix-now: 見本\n-->\n%s\nReproduction-or-measurement: 節外\nWhy-not-fix-now: 節外\n' "$heading" > "$new_ticket"
  expect 1 'コメント内と Why の外は数えない' bash scripts/check-pdh-ticket.sh
  contains $'Reproduction-or-measurement:\nWhy-not-fix-now:'
done
printf '### What\n本文\n' > "$new_ticket"
expect 1 'Why 自体がない' bash scripts/check-pdh-ticket.sh
# flat ticket と note は日時にかかわらず対象外。
printf '### Why\nReproduction-or-measurement: 結果\nWhy-not-fix-now: 理由\n' > "$new_ticket"
printf '### Why\n本文\n' > tickets/260131-235959-old.md
expect 0 '古い日付の flat ticket は対象外' bash scripts/check-pdh-ticket.sh
must cp tickets/260131-235959-old.md tickets/260201-000001-new.md
expect 0 '新しい日付の flat ticket も対象外' bash scripts/check-pdh-ticket.sh
must cp tickets/260131-235959-old.md tickets/260201-000001-new-note.md
expect 0 'flat note は Why の対象外' bash scripts/check-pdh-ticket.sh
printf '### Why\n#### 詳細\nReproduction-or-measurement: 結果\nWhy-not-fix-now: 理由\n' > "$new_ticket"
expect 0 'Why の小見出し内の記入' bash scripts/check-pdh-ticket.sh
must cp "$new_ticket" tickets/260201-000001-new.md
expect 0 '2 検査を併用する正常経路' bash scripts/check-pdh-ticket.sh
# done の Why と note は未完了側の検査に含めない。
printf '### Why\nReproduction-or-measurement: 結果\nWhy-not-fix-now: 理由\n' > "$new_ticket"
must mkdir -p tickets/done/260401-000000-old
printf '### Why\n根拠なし\n' > tickets/done/260401-000000-old/ticket.md
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: 問題 → missing\n' > tickets/done/260401-000000-old/note.md
expect 0 'done の Why と起票行は対象外' bash scripts/check-pdh-ticket.sh

# done へ一緒に移した統合元の写しは、独立した close 済み ticket と数えない。
must mkdir -p "$TMP_DIR/merged-repo/scripts" "$TMP_DIR/merged-repo/tickets/sample/merged-old"
must cp "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/merged-repo/scripts/"
install_stage_fixture "$TMP_DIR/merged-repo"
must cd "$TMP_DIR/merged-repo"
must git init -q -b main
printf '初期値\n' > code.txt
printf '### Why\n区間を検査する\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/sample/ticket.md
must cp tickets/sample/ticket.md tickets/sample/merged-old/ticket.md
: > tickets/sample/merged-old/progress.md
status PDH-implement
: > tickets/sample/progress.md
commit 初期状態
must git checkout -qb feature
printf 'review 済み\n' >> code.txt
commit review対象
gate "$(git rev-parse HEAD)"
commit gate記録
must mkdir tickets/done
must git mv tickets/sample tickets/done/sample
commit 写しと一緒にdoneへ移動
expect 0 'done 配下の統合元の写しは検査しない' bash scripts/check-pdh-ticket.sh
excludes 'merged-old'
: > tickets/done/sample/progress.md
expect 1 'done 本体の gate 行欠落は拒否する' bash scripts/check-pdh-ticket.sh
contains 'tickets/done/sample は close 前 review を回していない'
excludes 'merged-old'

must mkdir -p "$TMP_DIR/no-git/scripts" "$TMP_DIR/no-git/tickets/sample"
must cp "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/no-git/scripts/"
install_stage_fixture "$TMP_DIR/no-git"
must cd "$TMP_DIR/no-git"
for environment in no-git no-head; do
  if [ "$environment" = no-head ]; then must git init -q -b main; fi
  printf '### Why\n本文\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/sample/ticket.md
  : > tickets/sample/progress.md
  status PDH-close
  expect 0 "$environment: close gate の git 検査だけを省く" bash scripts/check-pdh-ticket.sh
  must rm tickets/sample/progress.md
  expect 1 "$environment: progress の欠落は拒否" bash scripts/check-pdh-ticket.sh
  contains 'progress.md が無い'
  : > tickets/sample/progress.md
  printf '## Status: PDH-human-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n' > tickets/sample/note.md
  expect 1 "$environment: human gate の待ち行の欠落は拒否" bash scripts/check-pdh-ticket.sh
  contains '発行先:'
  status PDH-implement
  printf '%s\n' '- [ ] 起票: 問題 → 260101-000000-missing' >> tickets/sample/note.md
  expect 1 "$environment: 起票先の欠落は拒否" bash scripts/check-pdh-ticket.sh
  contains 'tickets/sample/note.md:13:'
done

# anchor に → を含む起票行。
must mkdir -p "$TMP_DIR/edge-repo/scripts" "$TMP_DIR/edge-repo/tickets/sample" "$TMP_DIR/edge-repo/tickets/260101-000000-target"
must cp "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/edge-repo/scripts/"
install_stage_fixture "$TMP_DIR/edge-repo"
must cd "$TMP_DIR/edge-repo"
printf '### Why\n本文\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/sample/ticket.md
printf '### Why\n本文\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/260101-000000-target/ticket.md
: > tickets/sample/progress.md
: > tickets/260101-000000-target/progress.md
printf '## Status: PDH-implement\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 起票: A → B の変換 → 260101-000000-target\n' > tickets/sample/note.md
expect 0 'anchor に → を含む起票行は最後の → の後を名前にする' bash scripts/check-pdh-ticket.sh

# sub-branch を --no-ff で merge した commit、base を取り込み直した merge、sub-branch での done 移動。
must mkdir -p "$TMP_DIR/sub-repo/scripts" "$TMP_DIR/sub-repo/tickets/sample"
must cp "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/sub-repo/scripts/"
install_stage_fixture "$TMP_DIR/sub-repo"
must cd "$TMP_DIR/sub-repo"
must git init -q -b main
printf '初期値\n' > code.txt
printf '### Why\n区間を検査する\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/sample/ticket.md
status PDH-human-review
: > tickets/sample/progress.md
commit 初期状態
must git checkout -qb feature
printf 'review 済み\n' >> code.txt
commit review対象
gate "$(git rev-parse HEAD)"
commit gate記録
must git checkout -qb sub
printf 'sub で追加\n' >> code.txt
commit subの変更
must git checkout -q feature
must git -c commit.gpgsign=false merge --no-ff -qm subの取り込み sub
expect 0 'sub-branch の commit も区間に入る' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --commits
contains 'subの変更'
expect 1 'sub-branch の未 review 変更を拒否' bash scripts/check-pdh-ticket.sh
contains '1 ファイル・追加 1 行・削除 0 行'
gate "$(git rev-parse HEAD)"
commit gate記録2
must git checkout -q main
must git -c commit.gpgsign=false merge --no-ff -qm PRのmerge feature
printf 'main だけの変更\n' > main-only.txt
commit main自身の変更
must git checkout -q feature
must git -c commit.gpgsign=false merge --no-ff -qm mainの取り込み直し main
expect 0 'base の取り込み直しで tip を切り替えない' bash scripts/pdh-review-range.sh tickets/sample --from close-gate --commits
excludes 'main自身の変更'
expect 0 'base の取り込み直しは未 review 変更にしない' bash scripts/check-pdh-ticket.sh
must git checkout -qb sub-done
printf '未 review\n' >> code.txt
must mkdir -p tickets/done
must git mv tickets/sample tickets/done/sample
commit subでdoneへ移動
must git checkout -q feature
must git -c commit.gpgsign=false merge --no-ff -qm sub-doneの取り込み sub-done
expect 1 'sub-branch で done へ移した ticket も検査する' bash scripts/check-pdh-ticket.sh
contains 'tickets/done/sample'
must rm scripts/pdh-review-range.sh
expect 1 'pdh-review-range.sh の欠落を名指しする' bash scripts/check-pdh-ticket.sh
contains 'scripts/pdh-review-range.sh がありません'

# base に載った別の ticket の記録で、ほかの branch の検査を落とさない。
must mkdir -p "$TMP_DIR/owner-repo/scripts" "$TMP_DIR/owner-repo/tickets/x-ticket"
must cp "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/owner-repo/scripts/"
install_stage_fixture "$TMP_DIR/owner-repo"
must cd "$TMP_DIR/owner-repo"
must git init -q -b main
printf '初期値\n' > code.txt
printf '### Why\n本文\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/x-ticket/ticket.md
printf '## Status: PDH-human-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n- [ ] 承認の回答を待つ 発行先: /board\n' > tickets/x-ticket/note.md
: > tickets/x-ticket/progress.md
commit 初期状態
printf 'review-sha: %s\nclose-gate-sha: %s\n' "$(git rev-parse HEAD)" "$(git rev-parse HEAD)" > tickets/x-ticket/progress.md
commit xのgate記録
must git checkout -qb features/y-ticket
printf 'y の変更\n' >> code.txt
commit yの変更
expect 0 '別の branch の commit を base 上の ticket の変更と数えない' bash scripts/check-pdh-ticket.sh
expect 1 'その ticket の branch なら同じ状態で落とす' env GITHUB_HEAD_REF=features/x-ticket bash scripts/check-pdh-ticket.sh
contains 'tickets/x-ticket'
printf -- '---\nbranch: features/y-ticket\n---\n### Why\n本文\nReproduction-or-measurement: 検査用 fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > tickets/x-ticket/ticket.md
expect 1 'frontmatter の branch: が一致すれば検査する' bash scripts/check-pdh-ticket.sh
contains 'tickets/x-ticket'

# AC の承認の記録（AC-approved:）。作成日時にかかわらず、実装以降では現在の AC と一致する値を求める。
must mkdir -p "$TMP_DIR/ac-repo/scripts" "$TMP_DIR/ac-repo/tickets/260301-000000-ac"
must cp "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$TMP_DIR/ac-repo/scripts/"
install_stage_fixture "$TMP_DIR/ac-repo"
must cd "$TMP_DIR/ac-repo"
must git init -q -b main
printf 'default_branch: main\nbranch_prefix: features/\n' > .ticket-config.yaml
commit 承認の欄のないテンプレート
export GIT_COMMITTER_DATE='2026-03-01T00:00:00Z'
printf 'template: |\n  AC-approved: \n' >> .ticket-config.yaml
commit 承認の欄を導入
ac=tickets/260301-000000-ac
printf '### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n### What / Acceptance Criteria\nこの ticket が終わると、利用者が一覧を見られる\n- [ ] AC 1: 一覧に名前が出る\n- [ ] AC 2: 空なら「なし」と出る\n### Out-of-scope\nなし\n' > "$ac/ticket.md"
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n' > "$ac/note.md"
: > "$ac/progress.md"
must git checkout -qb features/260301-000000-ac
expect 0 '承認前は記録が無くてよい' bash scripts/check-pdh-ticket.sh
excludes '検査対象の ticket なし'
printf '## Status: PDH-implement\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n' > "$ac/note.md"
expect 1 'PDH-implement 以降は記録が要る' bash scripts/check-pdh-ticket.sh
contains 'AC-approved:'
printf 'AC-approved: \n' >> "$ac/ticket.md"
expect 1 '空の値は記録に数えない' bash scripts/check-pdh-ticket.sh
expect 0 'ハッシュを出す' bash scripts/check-pdh-ticket.sh --ac-hash "$ac/ticket.md"
h=$output
[[ "$h" =~ ^[0-9a-f]{16}$ ]] || fail "ハッシュの形が違います: $h"
must cd "$ac"
expect 0 'ticket の dir から相対パスで出す' bash ../../scripts/check-pdh-ticket.sh --ac-hash ticket.md
[ "$output" = "$h" ] || fail "cwd でハッシュが変わりました: $output"
must cd "$TMP_DIR/ac-repo"
sed "s/^AC-approved: .*/AC-approved: $h/" "$ac/ticket.md" > "$ac/t" && mv "$ac/t" "$ac/ticket.md"
expect 0 '承認したときの AC のまま' bash scripts/check-pdh-ticket.sh
sed -e 's/- \[ \] AC/- [x] AC/' -e 's/一覧に名前が出る/一覧に名前が  出る/' "$ac/ticket.md" > "$ac/t" && mv "$ac/t" "$ac/ticket.md"
expect 0 'checkbox の印と空白の違いは数えない' bash scripts/check-pdh-ticket.sh
sed 's/空なら「なし」と出る/空なら何も出ない/' "$ac/ticket.md" > "$ac/t" && mv "$ac/t" "$ac/ticket.md"
expect 1 '承認の後に AC の文を変えた' bash scripts/check-pdh-ticket.sh
contains '承認の後に変わっています'
contains "$h"
printf '## Status: PDH-ticket-review\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n' > "$ac/note.md"
expect 1 '差し戻し後も古い値は残さない' bash scripts/check-pdh-ticket.sh
sed '/^AC-approved:/d' "$ac/ticket.md" > "$ac/t" && mv "$ac/t" "$ac/ticket.md"
printf '## Status: PDH-implement\n## Checklist\n- [x] PDH-ticket-write: 証拠がある\n- [x] PDH-open: 証拠がある\n- [x] PDH-ticket-review: 証拠がある\n- [x] PDH-ticket-human-review: 証拠がある\n- [x] PDH-implement: 証拠がある\n- [x] PDH-review: 証拠がある\n- [x] PDH-verify: 証拠がある\n- [x] PDH-human-review: 証拠がある\n- [x] PDH-close: 証拠がある\n' > "$ac/note.md"
must mv "$ac" tickets/260228-235959-ac
must git checkout -qb features/260228-235959-ac
expect 1 '導入前に作られた ticket も実装以降は記録を求める' bash scripts/check-pdh-ticket.sh
contains 'AC の承認の記録（AC-approved:）が無い'

must python3 "$ROOT_DIR/tests/scripts/pdh_script_regressions_test.py"
printf 'PASS: pdh ticket evidence checks (%s 件)\n' "$checks"
