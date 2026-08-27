#!/bin/sh
set -eu

usage() {
  echo 'usage: build.sh --body <fragment> --out <html> [--kit <dir>] [--lang <lang>] [--layout document|deck] [--title <title>]' >&2
  exit 2
}

body=
out=
kit=
lang=ja
layout=document
title=
title_set=false

while [ "$#" -gt 0 ]; do
  case $1 in
    --body|--out|--kit|--lang|--layout|--title)
      [ "$#" -ge 2 ] || usage
      case $1 in
        --body) body=$2 ;;
        --out) out=$2 ;;
        --kit) kit=$2 ;;
        --lang) lang=$2 ;;
        --layout) layout=$2 ;;
        --title) title=$2; title_set=true ;;
      esac
      shift 2
      ;;
    *) echo "build.sh: ERROR: unknown argument: $1" >&2; usage ;;
  esac
done

[ -n "$body" ] && [ -n "$out" ] || usage
case $layout in document|deck) ;; *) echo 'build.sh: ERROR: layout must be document or deck' >&2; exit 2 ;; esac

case $0 in */*) script_parent=${0%/*} ;; *) script_parent=. ;; esac
script_dir=$(CDPATH= cd -- "$script_parent" && pwd)
[ -n "$kit" ] || kit=$script_dir/../kit
case $body in */*) asset_dir=${body%/*} ;; *) asset_dir=. ;; esac

tmp_base=${TMPDIR:-/tmp}/pdh-build.$$
manifest=$tmp_base.manifest
body_work=$tmp_base.body.0
document=$tmp_base.document
trap 'rm -f "$tmp_base".*' EXIT HUP INT TERM

# Mark relative image sources first. Encoding is done by the shell so file names
# never become awk command text.
if ! awk -v manifest="$manifest" -v token_prefix="__PDH_INLINE_IMAGE_$$_" '
  function tag_end(text, start,    i, c, quote) {
    quote = ""
    for (i = start; i <= length(text); i++) {
      c = substr(text, i, 1)
      if (quote != "") { if (c == quote) quote = "" }
      else if (c == "\"" || c == sprintf("%c", 39)) quote = c
      else if (c == ">") return i
    }
    return 0
  }
  function rewrite_img(tag,    low, rest, offset, found, quote, tail, stop, value, clean, ext, mime, token) {
    low = tolower(tag)
    rest = low
    offset = 0
    if (!match(rest, /[[:space:]]src[[:space:]]*=[[:space:]]*["\047]/)) return tag
    found = RSTART + RLENGTH - 1
    quote = substr(tag, offset + found, 1)
    tail = substr(tag, offset + found + 1)
    stop = index(tail, quote)
    if (!stop) return tag
    value = substr(tail, 1, stop - 1)
    if (value ~ /^[A-Za-z][A-Za-z0-9+.-]*:/ || value ~ /^\/\// || value ~ /^[\/#?]/) return tag
    clean = value
    sub(/[?#].*$/, "", clean)
    ext = tolower(clean)
    sub(/^.*\./, "", ext)
    if (ext == "png") mime = "image/png"
    else if (ext == "jpg" || ext == "jpeg") mime = "image/jpeg"
    else if (ext == "gif") mime = "image/gif"
    else if (ext == "svg") mime = "image/svg+xml"
    else if (ext == "webp") mime = "image/webp"
    else {
      print "build.sh: ERROR: unsupported relative image: " value > "/dev/stderr"
      failed = 1
      return tag
    }
    image_count++
    token = token_prefix image_count "__"
    print token "\t" clean "\t" mime >> manifest
    return substr(tag, 1, offset + found) token substr(tail, stop)
  }
  {
    source = source $0 "\n"
  }
  END {
    rest = source
    output = ""
    while (match(tolower(rest), /<img([[:space:]>])/)) {
      start = RSTART
      finish = tag_end(rest, start)
      if (!finish) break
      output = output substr(rest, 1, start - 1) rewrite_img(substr(rest, start, finish - start + 1))
      rest = substr(rest, finish + 1)
    }
    printf "%s", output rest
    if (failed) exit 1
  }
' "$body" > "$body_work"; then
  exit 1
fi

[ -f "$manifest" ] || : > "$manifest"
tab=$(printf '\t')
image_index=0
while IFS="$tab" read -r token relative mime; do
  [ -n "$token" ] || continue
  asset=$asset_dir/$relative
  if [ ! -f "$asset" ] || [ ! -r "$asset" ]; then
    echo "build.sh: ERROR: cannot read image: $asset" >&2
    exit 1
  fi
  payload=$tmp_base.payload
  # BSD (macOS) の base64 はファイル名の位置引数を取らない（-i が要る）。
  # stdin から読めば GNU / BSD のどちらでも同じに動く。
  if ! base64 < "$asset" > "$payload"; then
    echo "build.sh: ERROR: cannot encode image: $asset" >&2
    exit 1
  fi
  image_index=$((image_index + 1))
  next_body=$tmp_base.body.$image_index
  # The encoded image is read from a file, never passed as an argument. A single
  # argv string is capped well below the size of an encoded screenshot (Linux
  # MAX_ARG_STRLEN is 128 KiB, far under ARG_MAX), and passing it as one made the
  # replacement fail once the image grew. awk joins the wrapped base64 lines and
  # matches the token literally, so regex metacharacters cannot change the match.
  if ! awk -v token="$token" -v prefix="data:$mime;base64," -v payload="$payload" '
    BEGIN {
      while ((getline line < payload) > 0) data = data line
      close(payload)
      data = prefix data
      width = length(token)
    }
    {
      out = ""
      while ((at = index($0, token)) > 0) {
        out = out substr($0, 1, at - 1) data
        $0 = substr($0, at + width)
      }
      print out $0
    }
  ' "$body_work" > "$next_body"; then
    echo "build.sh: ERROR: cannot inline image: $asset" >&2
    exit 1
  fi
  # A surviving token means the image was not inlined. Stopping here keeps a body
  # that lost its images from reaching the output, where nothing else detects it:
  # the static check only inspects the images a document still has.
  if grep -qF "$token" "$next_body"; then
    echo "build.sh: ERROR: image token survived inlining: $asset" >&2
    exit 1
  fi
  body_work=$next_body
  rm -f "$payload"
done < "$manifest"

for required in tokens.css board.css board.js; do
  [ -r "$kit/$required" ] || { echo "build.sh: ERROR: cannot read kit file: $kit/$required" >&2; exit 1; }
done
if [ "$layout" = document ]; then
  [ -r "$kit/page.js" ] || { echo "build.sh: ERROR: cannot read kit file: $kit/page.js" >&2; exit 1; }
  css_files='tokens.css board.css'
  js_files='page.js board.js'
else
  for required in deck.css deck.js; do
    [ -r "$kit/$required" ] || { echo "build.sh: ERROR: cannot read kit file: $kit/$required" >&2; exit 1; }
  done
  css_files='tokens.css board.css deck.css'
  js_files='deck.js board.js'
fi

if [ "$title_set" = false ]; then
  title=$(awk '
    { source = source $0 "\n" }
    END {
      low = tolower(source)
      if (!match(low, /<h1([[:space:]>])/)) exit
      text = substr(source, RSTART)
      start = index(text, ">")
      if (!start) exit
      text = substr(text, start + 1)
      low = tolower(text)
      stop = index(low, "</h1>")
      if (stop) text = substr(text, 1, stop - 1)
      gsub(/<[^>]*>/, "", text)
      gsub(/[[:space:]]+/, " ", text)
      sub(/^ /, "", text); sub(/ $/, "", text)
      printf "%s", text
    }
  ' "$body")
  [ -n "$title" ] || title='判断ボード'
fi

escaped_lang=$(printf '%s' "$lang" | awk '{ gsub(/&/, "\\&amp;"); gsub(/"/, "\\&quot;"); printf "%s", $0 }')
if [ "$title_set" = true ]; then
  escaped_title=$(printf '%s' "$title" | awk '{ gsub(/&/, "\\&amp;"); gsub(/</, "\\&lt;"); gsub(/>/, "\\&gt;"); printf "%s", $0 }')
else
  escaped_title=$title
fi

{
  printf '<!doctype html>\n<html lang="%s">\n<head>\n' "$escaped_lang"
  printf '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  printf '<title>%s</title>\n' "$escaped_title"
  for name in $css_files; do
    printf '<style data-inline-source="%s">\n' "$name"
    awk '{ print }' "$kit/$name"
    printf '</style>\n'
  done
  printf '</head>\n<body>\n'
  awk '{ print }' "$body_work"
  for name in $js_files; do
    printf '<script data-inline-source="%s">\n' "$name"
    awk '{ print }' "$kit/$name"
    printf '</script>\n'
  done
  printf '</body>\n</html>\n'
} > "$document"

if ! sed -n '1,$p' "$document" > "$out"; then
  echo "build.sh: ERROR: cannot write output: $out" >&2
  exit 1
fi

echo "inline: $(printf '%s %s' "$css_files" "$js_files" | sed 's/ /, /g')" >&2
if [ "$image_index" -eq 0 ]; then
  echo 'data URI images: （なし）' >&2
else
  echo "data URI images: $image_index embedded" >&2
fi
