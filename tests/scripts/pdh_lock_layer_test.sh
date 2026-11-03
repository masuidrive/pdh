#!/usr/bin/env bash
# 任意の layer（coding-bot など）を、導入した repo だけ lock する契約を偽の上流で検査する。
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
excludes() { [[ "$output" != *"$1"* ]] || fail "出力に $1 が混入しました: $output"; }
commit() { must git add .; must git -c commit.gpgsign=false commit -qm "$1"; }
lock() { bash scripts/pdh-lock.sh "$@"; }
maps=$TMP_DIR/maps
write_lock() { lock write --upstream "$TMP_DIR/upstream" --map "$maps/lock-map.tsv"; }
installed() { lock installed --map "$maps/lock-map.bot.tsv"; }
local_changes() { lock local-changes --upstream "$TMP_DIR/upstream" --map "$maps/lock-map.bot.tsv"; }
rows() { tail -n +2 .pdh-lock | cut -f1 | tr '\n' ' '; }
install_bot() {
  must mkdir -p .github/workflows .github/coding-bot .claude/skills/pdh-gh-pull
  printf 'name: coding-bot\n' > .github/workflows/coding-bot.yml
  must cp "$TMP_DIR/upstream/bot/_pdh.md" .github/coding-bot/_pdh.md
  must cp "$TMP_DIR/upstream/bot/pdh-gh-pull/SKILL.md" .claude/skills/pdh-gh-pull/SKILL.md
}

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR=
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME='検査用' GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
must mkdir -p "$TMP_DIR/upstream/bot/pdh-gh-pull" "$TMP_DIR/repo/scripts" "$maps"
must git -C "$TMP_DIR/upstream" init -q -b main
printf 'core\n' > "$TMP_DIR/upstream/core.md"
printf 'pdh mode\n' > "$TMP_DIR/upstream/bot/_pdh.md"
printf 'skill\n' > "$TMP_DIR/upstream/bot/pdh-gh-pull/SKILL.md"
must cd "$TMP_DIR/upstream"
commit 上流
first_sha=$(git rev-parse HEAD)
printf 'core.md\tcore.md\n' > "$maps/lock-map.tsv"
printf '# installed-by: .github/workflows/coding-bot.yml\nbot/_pdh.md\t.github/coding-bot/_pdh.md\nbot/pdh-gh-pull/\t.claude/skills/pdh-gh-pull/\n' > "$maps/lock-map.bot.tsv"
must cd "$TMP_DIR/repo"
must git init -q -b main
must cp "$ROOT_DIR/scripts/pdh-lock.sh" scripts/
must cp "$TMP_DIR/upstream/core.md" core.md

# 未導入: layer を lock せず、check も通る。
expect 1 '未導入の layer は installed で 1' installed
expect 0 '未導入の layer を飛ばして write する' write_lock
contains 'lock-map.bot.tsv: 未導入のため lock しない（.github/workflows/coding-bot.yml が無い）'
[ "$(rows)" = 'core.md ' ] || fail "未導入の layer を lock した: $(rows)"
expect 0 '未導入なら check が通る' lock check
# layer のファイルが在るだけでは導入と読まない。判定は installed-by だけで行う。
must mkdir -p .github/coding-bot
printf '手元の版\n' > .github/coding-bot/_pdh.md
expect 1 'layer のファイルだけでは導入と読まない' installed
must rm -r .github/coding-bot

# 既存の導入を更新する: layer の行が無い lock から、導入済みの layer を登録する。
install_bot
# Codex CLI 用の symlink（導入先では .agents/skills/）と同じく、lock の外から layer の dir を指す。
must mkdir -p links
must ln -s ../.claude/skills/pdh-gh-pull links/pdh-gh-pull
expect 0 'installed-by があれば導入済み' installed
expect 0 '既存の導入の layer を lock へ登録する' write_lock
excludes '未導入'
[ "$(rows)" = '.claude/skills/pdh-gh-pull/SKILL.md .github/coding-bot/_pdh.md core.md ' ] || fail "layer の行が違う: $(rows)"
[ "$(grep -F .claude/skills/pdh-gh-pull/SKILL.md .pdh-lock | cut -f4)" = 'dir:.claude/skills/pdh-gh-pull' ] || fail 'layer の dir 行が違う'
must cp .pdh-lock "$TMP_DIR/bot-lock"

# 正常一致: lock の外にある symlink は検査を乱さない。
expect 0 '一致する check' lock check
expect 0 '一致する diff' lock diff --upstream "$TMP_DIR/upstream"
expect 0 '上流と同じなら local-changes は 0' local_changes

# 1 行の改変: 検出し、lock の更新で正解として登録しない。
printf '個別の追記\n' >> .github/coding-bot/_pdh.md
expect 1 '改変を検出する' lock check
contains '.github/coding-bot/_pdh.md: lock と sha256 が違う'
expect 1 '改変を残したまま write できない' write_lock
must cmp .pdh-lock "$TMP_DIR/bot-lock"
expect 1 '上書き前に改変を挙げる' local_changes
contains '.github/coding-bot/_pdh.md: 上流のどの版とも違う'
must cp "$TMP_DIR/upstream/bot/_pdh.md" .github/coding-bot/_pdh.md

# 欠落: lock の行が残るので、ファイルが消えても «未導入» と読まない。
must rm .claude/skills/pdh-gh-pull/SKILL.md
expect 1 '欠落を検出する' lock check
contains '.claude/skills/pdh-gh-pull/SKILL.md: ローカルに通常ファイルが無い'
expect 1 '欠落を残したまま write できない' write_lock
must cmp .pdh-lock "$TMP_DIR/bot-lock"
expect 0 '欠落は local-changes に挙げない' local_changes
must rm -r .github/coding-bot .github/workflows
expect 0 'workflow ごと消えても lock の行で導入済みと読む' installed
expect 1 '全部消えても write は layer を外さない' write_lock
must cmp .pdh-lock "$TMP_DIR/bot-lock"
install_bot

# 追加ファイル: 上流のどの版にも無いファイルを上書き前に挙げる。
printf '手元の追加\n' > .claude/skills/pdh-gh-pull/notes.md
expect 1 'layer dir の追加ファイルを検出する' lock check
contains '.claude/skills/pdh-gh-pull/notes.md: lock に無いファイル'
expect 1 '追加ファイルを local-changes に挙げる' local_changes
contains '.claude/skills/pdh-gh-pull/notes.md: 上流のどの版とも違う'
must rm .claude/skills/pdh-gh-pull/notes.md

# 上流が進んだ: lock の commit の版のままのファイルは、ローカルの変更ではない。
printf 'pdh mode v2\n' > "$TMP_DIR/upstream/bot/_pdh.md"
must git -C "$TMP_DIR/upstream" add .
must git -C "$TMP_DIR/upstream" -c commit.gpgsign=false commit -qm 上流の更新
expect 0 '前回同期した版は local-changes に挙げない' local_changes
printf '個別の追記\n' >> .github/coding-bot/_pdh.md
expect 1 'どの版とも違えば挙げる' local_changes
must cp "$TMP_DIR/upstream/bot/_pdh.md" .github/coding-bot/_pdh.md
expect 0 '今の上流の版は local-changes に挙げない' local_changes
expect 0 '上流の版へ揃えたら lock を進められる' write_lock
[ "$(head -n 1 .pdh-lock)" != "# upstream: masuidrive/pdh@$first_sha" ] || fail 'lock の upstream SHA が進まない'
printf '# upstream: masuidrive/pdh@%s\n' "$(printf '0%.0s' $(seq 40))" > "$TMP_DIR/unknown-head"
tail -n +2 .pdh-lock >> "$TMP_DIR/unknown-head"
must cp .pdh-lock "$TMP_DIR/current-lock"
must cp "$TMP_DIR/unknown-head" .pdh-lock
expect 2 '上流 checkout に無い lock の commit を通さない' local_changes
contains '.pdh-lock の upstream commit が上流 checkout にありません'
must cp "$TMP_DIR/current-lock" .pdh-lock

# 取り外し: layer の行だけを消すと、core の行と改変の検出が残る。
must rm -r .github/coding-bot .github/workflows .claude/skills/pdh-gh-pull links
grep -vF -e .github/coding-bot/ -e .claude/skills/pdh-gh-pull/ .pdh-lock > "$TMP_DIR/core-lock" || fail 'core の行がありません'
must cp "$TMP_DIR/core-lock" .pdh-lock
[ "$(rows)" = 'core.md ' ] || fail "core の行が変わった: $(rows)"
expect 1 '行を消した layer は未導入' installed
expect 0 'core の行だけで check が通る' lock check
printf '個別の追記\n' >> core.md
expect 1 'layer を外した後も core の改変を検出する' lock check
contains 'core.md: lock と sha256 が違う'
# lock 全体を消すと、write が止まった後の check は core の改変を通す。
must rm .pdh-lock
expect 1 'core が上流と違えば write は止まる' write_lock
expect 0 'lock が無いと check は改変を通す' lock check
contains '未導入のため検査対象なし'
must cp "$TMP_DIR/upstream/core.md" core.md
expect 0 'lock を作り直すと取り外した layer を外す' write_lock
[ "$(rows)" = 'core.md ' ] || fail "取り外した layer が残った: $(rows)"

# 壊れた layer map と、core と重なる layer を拒否する。
must cp "$maps/lock-map.bot.tsv" "$TMP_DIR/bot-map"
printf 'bot/_pdh.md\t.github/coding-bot/_pdh.md\n' > "$maps/lock-map.bot.tsv"
expect 2 'installed-by の無い layer map を拒否する' write_lock
contains 'layer map の 1 行目は'
printf '# installed-by: core.md\nbot/_pdh.md\tcore.md\n' > "$maps/lock-map.bot.tsv"
expect 2 'core と重なる layer を拒否する' write_lock
contains 'local の map が重複しています'
must cp "$TMP_DIR/bot-map" "$maps/lock-map.bot.tsv"

printf 'pdh_lock_layer_test: %s checks passed\n' "$checks"
