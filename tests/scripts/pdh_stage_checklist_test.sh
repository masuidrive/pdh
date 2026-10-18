#!/usr/bin/env bash
# PDH-stage のチェックリスト: skill から取り出す・note へ写す・写し忘れを check-pdh-ticket.sh が落とす。
set -uo pipefail
ROOT_DIR=${PDH_TEST_ROOT:?test-distributed-scripts.sh が作る導入先を指定する}
TMP_DIR=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
must() { "$@" || fail "準備コマンドが失敗しました: $*"; }
checks=0
expect() {
  local expected=$1 label=$2 actual
  shift 2
  output=$("$@" 2>&1); actual=$?
  [ "$actual" -eq "$expected" ] || fail "$label: exit ${actual}（期待 ${expected}）: $output"
  checks=$((checks + 1))
}
contains() { [[ "$output" == *"$1"* ]] || fail "出力に $1 がありません: $output"; }

# この repo の skill: 既知の PDH-stage はすべて、チェックリストの行を持つ。
for st in PDH-ticket-write PDH-open PDH-ticket-review PDH-ticket-human-review PDH-implement PDH-review PDH-verify PDH-human-review PDH-close; do
  expect 0 "$st の行を出す" bash "$ROOT_DIR/scripts/pdh-stage-checklist.sh" "$st"
  [ -n "$output" ] || fail "$st のチェックリストが skill に無い"
  printf '%s\n' "$output" | grep -qv "^- \[ \] $st: " && fail "$st 以外の行が混ざった: $output"
done
expect 2 '知らない PDH-stage' bash "$ROOT_DIR/scripts/pdh-stage-checklist.sh" PDH-foo

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GITHUB_BASE_REF GITHUB_HEAD_REF
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TEMPLATE_DIR=
export GIT_AUTHOR_NAME='検査用' GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_DATE='2026-04-01T00:00:00Z' GIT_COMMITTER_DATE='2026-04-01T00:00:00Z'
r="$TMP_DIR/repo"
must mkdir -p "$r/scripts" "$r/.claude/skills/pdh-implement" "$r/.claude/skills/pdh-review"
must cp "$ROOT_DIR/scripts/pdh-stage-checklist.sh" "$ROOT_DIR/scripts/check-pdh-ticket.sh" "$ROOT_DIR/scripts/pdh-review-range.sh" "$r/scripts/"
printf '# x\n\n`- [ ] PDH-implement:` で始まる行は説明\n\n- [ ] PDH-implement: 仮定を測った\n- [ ] PDH-implement: test-all が通った\n- [ ] PDH-review: これは別の stage\n' > "$r/.claude/skills/pdh-implement/SKILL.md"
printf '# y\n' > "$r/.claude/skills/pdh-review/SKILL.md"
must cd "$r"
must git init -q -b main
printf 'default_branch: main\nbranch_prefix: features/\n' > .ticket-config.yaml
must git add . ; must git -c commit.gpgsign=false commit -qm 初期状態
expect 0 '説明の行と別の stage の行を拾わない' bash scripts/pdh-stage-checklist.sh PDH-implement
[ "$output" = $'- [ ] PDH-implement: 仮定を測った\n- [ ] PDH-implement: test-all が通った' ] || fail "取り出した行が違う: $output"

n=tickets/260401-000001-a/note.md
must mkdir -p "${n%/*}"
printf '# a\n### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 結果を読める\nAC-approved: ebdc012f008a4f1d\n' > "${n%/*}/ticket.md"
: > "${n%/*}/progress.md"
printf '## Status: PDH-implement\n\n## Checklist\n<!-- c -->\n- [ ] 頼まれたこと\n- [x] PDH-open: 開けた\n\n## Open-Questions\n- [ ] 未決\n' > "$n"
expect 0 '写す' bash scripts/pdh-stage-checklist.sh PDH-implement --enter "$n"
[ "$(cat "$n")" = $'## Status: PDH-implement\n\n## Checklist\n<!-- c -->\n- [ ] 頼まれたこと\n- [x] PDH-open: 開けた\n- [ ] PDH-implement: 仮定を測った\n- [ ] PDH-implement: test-all が通った\n\n## Open-Questions\n- [ ] 未決' ] || fail "写した結果が違う: $(cat "$n")"
sed -e 's/^- \[ \] PDH-implement: 仮定を測った/- [x] PDH-implement: 仮定を測った/' \
    -e 's/^- \[ \] PDH-implement: test-all が通った/- [-] PDH-implement: test-all が通った - skip: 理由/' "$n" > "$n.t" && mv "$n.t" "$n"
expect 0 '2 回目に通るときは印を未了に戻し、重ねない' bash scripts/pdh-stage-checklist.sh PDH-implement --enter "$n"
[ "$(grep -c 'PDH-implement:' "$n")" -eq 2 ] || fail "行が重なった: $(cat "$n")"
grep -q '^- \[x\] PDH-implement' "$n" && fail "印が戻っていない: $(cat "$n")"
grep -q '^- \[x\] PDH-open: 開けた' "$n" || fail "別の stage の印を変えた: $(cat "$n")"
cp "$n" "$TMP_DIR/before"
expect 1 'skill に行の無い stage は表示でも失敗する' bash scripts/pdh-stage-checklist.sh PDH-review
contains 'PDH-review'
contains 'チェックリスト'
cmp -s "$n" "$TMP_DIR/before" || fail "note が変わった"
expect 1 'skill に行の無い stage は写せず、note を変えない' bash scripts/pdh-stage-checklist.sh PDH-review --enter "$n"
contains 'PDH-review'
contains 'チェックリスト'
cmp -s "$n" "$TMP_DIR/before" || fail "note が変わった"

# grep が途中まで出力してから失敗しても、その行を表示・転記しない。
must mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/grep" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = -E ]; then
  printf '%s\n' '- [ ] PDH-implement: 途中まで読めた行'
  exit 2
fi
exec "$PDH_TEST_REAL_GREP" "$@"
SH
must chmod +x "$TMP_DIR/bin/grep"
for mode in display enter; do
  args=(PDH-implement)
  [ "$mode" = enter ] && args+=(--enter "$n")
  expect 1 "grep の失敗を落とす（$mode）" env PATH="$TMP_DIR/bin:$PATH" PDH_TEST_REAL_GREP="$(command -v grep)" bash scripts/pdh-stage-checklist.sh "${args[@]}"
  contains 'PDH-implement'
  [[ "$output" != *'途中まで読めた行'* ]] || fail "失敗した grep の出力を使った: $output"
  cmp -s "$n" "$TMP_DIR/before" || fail "note が変わった"
done

# check-pdh-ticket.sh: 作成日時にかかわらず、チェックリストの写し忘れを落とす。
export GIT_COMMITTER_DATE='2026-04-01T00:00:00Z'
printf 'note_content: |\n  bash scripts/pdh-stage-checklist.sh <PDH-stage> --enter <この note>\n' >> .ticket-config.yaml
must git add .; must git -c commit.gpgsign=false commit -qm チェックリストの欄を導入
must git checkout -qb features/260401-000001-a
sed 's/^- \[ \] PDH-implement: test-all が通った/- [-] PDH-implement: test-all が通った - skip: 理由/' "$n" > "$n.t" && mv "$n.t" "$n"
expect 0 '写した note は通る（[-] skip の行も数える）' bash scripts/check-pdh-ticket.sh
must cp "$n" "$TMP_DIR/current-status"
for gap in '' '\n'; do
  sed "s/^## Status:.*/## Status\\n${gap}PDH-implement/" "$TMP_DIR/current-status" > "$n"
  expect 1 '旧形式の Status は stage として読まない' bash scripts/check-pdh-ticket.sh
  contains 'Status  のチェックリストを skill から取り出せない'
done
must cp "$TMP_DIR/current-status" "$n"
sed '/PDH-implement: 仮定を測った/d' "$n" > "$n.t" && mv "$n.t" "$n"
expect 1 '写し忘れた行を落とす' bash scripts/check-pdh-ticket.sh
contains '仮定を測った'
contains 'pdh-stage-checklist.sh PDH-implement --enter'

# Status の stage の行を skill から取り出せないときは、写し忘れの検査も失敗する。
must cp "$n" "$TMP_DIR/status-before"
for st in PDH-review PDH-verify PDH-foo; do
  sed "s/^## Status:.*/## Status: $st/" "$TMP_DIR/status-before" > "$n"
  expect 1 "$st の行を取り出せない ticket を落とす（空の skill・skill 不在・未知の stage）" bash scripts/check-pdh-ticket.sh
  contains "$st"
  contains 'チェックリスト'
  contains 'check-pdh-ticket: FAILED'
done
must cp "$TMP_DIR/status-before" "$n"
must cp scripts/pdh-stage-checklist.sh "$TMP_DIR/extractor-before"
printf '#!/usr/bin/env bash\nexit 0\n' > scripts/pdh-stage-checklist.sh
expect 1 '抽出 script が成功しても空の結果を落とす' bash scripts/check-pdh-ticket.sh
contains 'PDH-implement'
contains 'チェックリスト'
contains 'check-pdh-ticket: FAILED'
must cp "$TMP_DIR/extractor-before" scripts/pdh-stage-checklist.sh
must mv tickets/260401-000001-a tickets/260331-235959-a
must git checkout -qb features/260331-235959-a
expect 1 '導入前に作った ticket も写し忘れを落とす' bash scripts/check-pdh-ticket.sh
contains '仮定を測った'

printf 'PASS: pdh stage checklist (%s 件)\n' "$checks"
