#!/usr/bin/env bash
# PDH の上書き対象が、同期済みの上流の内容を保っているかを検査する。
set -euo pipefail
export LC_ALL=C

usage() {
  cat <<'EOF'
Usage: pdh-lock.sh write --upstream <checkout> --map <map.tsv>
       pdh-lock.sh check [--paths-from <git range>]
       pdh-lock.sh diff --upstream <checkout>
       pdh-lock.sh installed --map <layer map>
       pdh-lock.sh local-changes --upstream <checkout> --map <map.tsv>
       pdh-lock.sh -h

Map: <upstream path or dir/> TAB <local path or dir/>
Paths are repository-relative; tabs, newlines, symlink traversal and overlapping
local mappings are not supported. Both directory paths must end in /.
Empty upstream directories are rejected (there is no file to lock).
Layer map: <map>.<layer>.tsv next to a --map <map>.tsv is an optional layer.
Its first line is "# installed-by: <local path>". The layer is installed when
that path exists, or when the existing lock already has a row of the layer;
the presence of the layer's own files is not used. write locks installed
layers like the main map and reports skipped ones.
Lock: # upstream: masuidrive/pdh@<40-character HEAD SHA>
      <local path> TAB <upstream path> TAB <sha256> [TAB dir:<local dir>]
Directory rows record their mapped local root, without the trailing /.
Rows are sorted by local path. Hashes cover file bytes, including Based on lines.
write refuses dirty mapped upstream paths, mismatches, missing and extra local
files, preserving an existing lock.
check compares the working tree; --paths-from limits failures to changed paths
(including deleted/renamed paths); other mismatches are warnings.
diff compares locked local paths with the current upstream working tree.
installed exits 0 when the layer is installed and 1 otherwise.
local-changes lists mapped local files, and extra files in mapped dirs, that
match neither the upstream commit in .pdh-lock nor the current upstream working
tree; missing local files are not listed. Run it before overwriting.
EOF
}
die() { printf '%s: %s\n' "$1" "$2" >&2; exit 2; }
valid_path() {
  case "$1" in
    ''|/*|*/|.|..|./*|../*|*/./*|*/../*|*/.|*/..|*//*|*$'\t'*|*$'\n'*) return 1 ;;
  esac
}
# 親ディレクトリの symlink も辿らない。
no_symlink() {
  local root=$1 path=$2
  while :; do
    [ ! -L "$root/$path" ] || return 1
    [[ "$path" == */* ]] || break
    path=${path%/*}
  done
}
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum < "$1" | awk '{print $1}'
  else
    shasum -a 256 < "$1" | awk '{print $1}'
  fi
}

command_name=${1:--h}
[ "$#" -eq 0 ] || shift
upstream='' map='' paths_from=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --upstream|--map|--paths-from)
      [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1" '引数がありません'
      case "$1" in
        --upstream) upstream=$2 ;;
        --map) map=$2 ;;
        --paths-from) paths_from=$2 ;;
      esac
      shift 2 ;;
    *) die "$1" '不明な引数です' ;;
  esac
done
case "$command_name" in
  -h|--help) usage; exit 0 ;;
  write) [ -n "$upstream" ] && [ -n "$map" ] && [ -z "$paths_from" ] || die write '必要な引数: --upstream <checkout> --map <map.tsv>' ;;
  check) [ -z "$upstream$map" ] || die check '使える引数: --paths-from <git range>' ;;
  diff) [ -n "$upstream" ] && [ -z "$map$paths_from" ] || die diff '必要な引数: --upstream <checkout>' ;;
  installed) [ -n "$map" ] && [ -z "$upstream$paths_from" ] || die installed '必要な引数: --map <layer map>' ;;
  local-changes) [ -n "$upstream" ] && [ -n "$map" ] && [ -z "$paths_from" ] || die local-changes '必要な引数: --upstream <checkout> --map <map.tsv>' ;;
  *) die "$command_name" '不明なコマンドです（-h で使い方を表示）' ;;
esac
[ -z "$map" ] || [[ "$map" == /* ]] || map=$PWD/$map
if [ -n "$upstream" ]; then
  upstream=$(cd "$upstream" && pwd -P) || die "$upstream" '上流 checkout がありません'
fi
cd "$(dirname "$0")/.."
repo=$(pwd -P)
lock=.pdh-lock
if [ "$command_name" = check ] && [ -n "$paths_from" ] &&
   git cat-file -e "${paths_from%%..*}:.pdh-lock" 2>/dev/null &&
   ! git cat-file -e HEAD:.pdh-lock 2>/dev/null; then
  printf '.pdh-lock: base にあった .pdh-lock が HEAD にありません\n' >&2
  exit 1
fi
if { [ "$command_name" = check ] || [ "$command_name" = diff ]; } && [ ! -f "$lock" ]; then
  if [ "$command_name" = check ] && [ -n "$paths_from" ] &&
     git cat-file -e "${paths_from%%..*}:.pdh-lock" 2>/dev/null; then
    printf '.pdh-lock: base にあった .pdh-lock が削除されています\n' >&2
    exit 1
  fi
  printf '.pdh-lock: 未導入のため検査対象なし（成功）。pdh-update が導入する\n'
  exit 0
fi
tmp=$(mktemp -d "${TMPDIR:-/tmp}/pdh-lock.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
: > "$tmp/drifts"

add_row() {
  local source=$1 target=$2 marker=$3 digest
  valid_path "$source" && valid_path "$target" || die "$target" 'map の path が不正です'
  no_symlink "$upstream" "$source" && [ -f "$upstream/$source" ] || die "$target" '上流に通常ファイルがありません（symlink は辿らない）'
  digest=$(hash_file "$upstream/$source")
  printf '%s\t%s\t%s' "$target" "$source" "$digest" >> "$tmp/rows"
  [ -z "$marker" ] || printf '\tdir:%s' "$marker" >> "$tmp/rows"
  printf '\n' >> "$tmp/rows"
}
# layer map の 1 行目が指す、layer の導入を示す path。
layer_marker() {
  local first=''
  IFS= read -r first < "$1" || true
  case "$first" in
    '# installed-by: '*) first=${first#'# installed-by: '} ;;
    *) die "$1" 'layer map の 1 行目は "# installed-by: <path>" です' ;;
  esac
  valid_path "$first" || die "$1" 'installed-by の path が不正です'
  printf '%s\n' "$first"
}
# layer 自身のファイルの有無では判定しない。消えたファイルを «未導入» と読まないため。
layer_installed() {
  local layer=$1 marker source target extra
  marker=$(layer_marker "$layer") || exit 2
  [ ! -e "$marker" ] && [ ! -L "$marker" ] || return 0
  [ -f "$lock" ] || return 1
  while IFS=$'\t' read -r source target extra || [ -n "$source$target$extra" ]; do
    case "$source" in ''|'#'*) continue ;; esac
    target=${target%/}
    if awk -F '\t' -v t="$target" 'NR > 1 && ($1 == t || $4 == "dir:" t) {found = 1; exit} END {exit !found}' "$lock"; then
      return 0
    fi
  done < "$layer"
  return 1
}
# map の行を path の対で返す。dir の対は末尾 / を残す。
map_pairs() {
  local map=$1 skip=$2 source target extra
  while IFS=$'\t' read -r source target extra || [ -n "$source$target$extra" ]; do
    if [ -n "$skip" ]; then skip=''; continue; fi
    [ -n "$source$target$extra" ] || continue
    [ -n "$source" ] && [ -n "$target" ] && [ -z "$extra" ] || die "$map" 'map は 2 列の TSV です'
    case "$source:$target" in
      */:*/) ;;
      */:*|*:*/) die "$target" 'dir の対応は両方に末尾 / が必要です' ;;
    esac
    valid_path "${source%/}" && valid_path "${target%/}" || die "$target" 'map の path が不正です'
    printf '%s\t%s\n' "$source" "$target"
  done < "$map"
}

if [ "$command_name" = installed ]; then
  [ -f "$map" ] || die "$map" 'map がありません'
  layer_installed "$map" && exit 0
  exit 1
fi

if [ "$command_name" = local-changes ]; then
  [ -f "$map" ] || die "$map" 'map がありません'
  base=''
  if [ -f "$lock" ]; then
    header=$(head -n 1 "$lock")
    [[ "$header" =~ ^\#\ upstream:\ masuidrive/pdh@([0-9a-f]{40})$ ]] || die .pdh-lock '先頭の upstream SHA が不正です'
    base=${BASH_REMATCH[1]}
    git -C "$upstream" cat-file -e "$base^{commit}" 2>/dev/null || die "$base" '.pdh-lock の upstream commit が上流 checkout にありません'
  fi
  skip=''
  case "$(head -n 1 "$map")" in '#'*) skip=1 ;; esac
  map_pairs "$map" "$skip" > "$tmp/pairs"
  # 前回同期した版か今の上流の版と同じなら、ローカルの変更ではない。
  from_upstream() {
    local target=$1 source=$2
    no_symlink "$repo" "$target" && [ -f "$target" ] || return 1
    if no_symlink "$upstream" "$source" && [ -f "$upstream/$source" ] && cmp -s "$target" "$upstream/$source"; then
      return 0
    fi
    [ -n "$base" ] && git -C "$upstream" cat-file blob "$base:$source" 2>/dev/null | cmp -s - "$target"
  }
  while IFS=$'\t' read -r source target; do
    case "$target" in
      */)
        source=${source%/} target=${target%/}
        [ -e "$target" ] || [ -L "$target" ] || continue
        no_symlink "$repo" "$target" || { printf '%s\n' "$target" >> "$tmp/drifts"; continue; }
        find "$target" \( -type f -o -type l \) -print > "$tmp/files"
        while IFS= read -r file; do
          from_upstream "$file" "$source/${file#"$target/"}" || printf '%s\n' "$file" >> "$tmp/drifts"
        done < "$tmp/files"
        ;;
      *)
        [ -e "$target" ] || [ -L "$target" ] || continue
        from_upstream "$target" "$source" || printf '%s\n' "$target" >> "$tmp/drifts"
        ;;
    esac
  done < "$tmp/pairs"
  [ -s "$tmp/drifts" ] || exit 0
  while IFS= read -r file; do
    printf '%s: 上流のどの版とも違う（上書きすると失われる）\n' "$file" >&2
  done < "$tmp/drifts"
  exit 1
fi

lock_map() {
  local map=$1 skip=$2 source target directory dirty prior file suffix
  map_pairs "$map" "$skip" > "$tmp/pairs"
  while IFS=$'\t' read -r source target; do
    directory=''
    case "$target" in
      */) directory=${target%/}; source=${source%/}; target=$directory ;;
    esac
    # header の SHA と digest が、同じ commit の内容を指すことを保つ。
    dirty=$(git -C "$upstream" status --porcelain --untracked-files=all --ignored -- "$source")
    [ -z "$dirty" ] || die "$source" 'map の対象に未 commit・未追跡の変更があります'
    # dir と個別 file の重複も拒否する。lock の dir 検査に例外を持ち込まない。
    while IFS= read -r prior; do
      case "$target/" in "$prior/"*) die "$target" 'local の map が重複しています' ;; esac
      case "$prior/" in "$target/"*) die "$target" 'local の map が重複しています' ;; esac
    done < "$tmp/roots"
    printf '%s\n' "$target" >> "$tmp/roots"
    if [ -n "$directory" ]; then
      no_symlink "$upstream" "$source" && [ -d "$upstream/$source" ] || die "$target" '上流に通常ディレクトリがありません'
      find "$upstream/$source" -type f -print > "$tmp/files"
      [ -s "$tmp/files" ] || die "$target" '上流 dir に lock できるファイルがありません'
      while IFS= read -r file; do
        suffix=${file#"$upstream/$source/"}
        add_row "$source/$suffix" "$target/$suffix" "$directory"
      done < "$tmp/files"
    else
      add_row "$source" "$target" ''
    fi
  done < "$tmp/pairs"
}
if [ "$command_name" = write ]; then
  [ -f "$map" ] || die "$map" 'map がありません'
  sha=$(git -C "$upstream" rev-parse --verify HEAD)
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "$upstream" 'HEAD は 40 桁の SHA である必要があります'
  : > "$tmp/rows"
  : > "$tmp/roots"
  lock_map "$map" ''
  for layer in "${map%.tsv}".*.tsv; do
    [ -f "$layer" ] || continue
    if layer_installed "$layer"; then
      lock_map "$layer" 1
    else
      printf '%s: 未導入のため lock しない（%s が無い）\n' "${layer##*/}" "$(layer_marker "$layer")"
    fi
  done
  { printf '# upstream: masuidrive/pdh@%s\n' "$sha"; sort "$tmp/rows"; } > "$tmp/lock"
  lock=$tmp/lock
fi

# 壊れた lock を «一致» として扱わない。
header=$(head -n 1 "$lock")
[[ "$header" =~ ^\#\ upstream:\ masuidrive/pdh@[0-9a-f]{40}$ ]] || die .pdh-lock '先頭の upstream SHA が不正です'
awk -F '\t' 'NR > 1 {
  if ((NF != 3 && NF != 4) || length($3) != 64 || $3 ~ /[^0-9a-f]/ || seen[$1]++) exit 1
  if (NF == 4 && (substr($4, 1, 4) != "dir:" || index($1, substr($4, 5) "/") != 1)) exit 1
}' "$lock" || die .pdh-lock '列・sha256・dir または local path の重複が不正です'
cut -f1 "$lock" > "$tmp/tracked"
tail -n +2 "$lock" > "$tmp/entries"
while IFS=$'\t' read -r target source digest marker; do
  valid_path "$source" && valid_path "$target" || die .pdh-lock 'path が不正です'
  [ -z "$marker" ] || valid_path "${marker#dir:}" || die .pdh-lock 'dir が不正です'
  reason=''
  if ! no_symlink "$repo" "$target" || [ ! -f "$target" ]; then
    reason='ローカルに通常ファイルが無い（symlink は辿らない）'
  elif [ "$command_name" = diff ]; then
    if ! no_symlink "$upstream" "$source" || [ ! -f "$upstream/$source" ]; then
      reason='上流に通常ファイルが無い（symlink は辿らない）'
    elif ! cmp -s "$target" "$upstream/$source"; then
      reason='上流と内容が違う'
    fi
  elif [ "$(hash_file "$target")" != "$digest" ]; then
    reason='lock と sha256 が違う'
  fi
  [ -z "$reason" ] || printf '%s\t%s\n' "$target" "$reason" >> "$tmp/drifts"
done < "$tmp/entries"

if [ "$command_name" != diff ]; then
  awk -F '\t' 'NR > 1 && NF == 4 {print substr($4, 5)}' "$lock" | sort -u > "$tmp/dirs"
  while IFS= read -r directory; do
    no_symlink "$repo" "$directory" && [ -d "$directory" ] || continue
    find "$directory" \( -type f -o -type l \) -print > "$tmp/files"
    while IFS= read -r file; do
      if ! grep -qxF -- "$file" "$tmp/tracked"; then
        printf '%s\tlock に無いファイル\n' "$file" >> "$tmp/drifts"
      fi
    done < "$tmp/files"
  done < "$tmp/dirs"
fi

: > "$tmp/changed"
if [ -n "$paths_from" ]; then
  # rename の旧 path と新 path の両方を対象にする。
  git diff --no-renames --name-only -z "$paths_from" -- > "$tmp/changed-z" || die "$paths_from" 'git diff の範囲を解決できません'
  while IFS= read -r -d '' path; do printf '%s\n' "$path"; done < "$tmp/changed-z" > "$tmp/changed"
fi
failed=0
sort -u "$tmp/drifts" > "$tmp/sorted"
while IFS=$'\t' read -r target reason; do
  if [ -n "$paths_from" ] && ! grep -qxF -- "$target" "$tmp/changed"; then
    printf '%s: warning: %s（指定範囲外）\n' "$target" "$reason" >&2
  else
    printf '%s: %s\n' "$target" "$reason" >&2
    failed=1
  fi
done < "$tmp/sorted"
[ "$failed" -eq 0 ] || exit 1
if [ "$command_name" = write ]; then
  # 全件照合が済むまで既存 lock に触れない。同じ filesystem で rename する。
  pending=$(mktemp "$repo/.pdh-lock.XXXXXX")
  trap 'rm -rf "$tmp"; rm -f "$pending"' EXIT
  cp "$lock" "$pending"
  chmod 644 "$pending"
  mv -f "$pending" "$repo/.pdh-lock"
fi
