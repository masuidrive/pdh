#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo 'usage: check-static.sh <board.html>' >&2
  exit 2
fi

board=$1
[ -r "$board" ] || { echo "check-static.sh: ERROR: cannot read board: $board" >&2; exit 2; }

tmp_base=${TMPDIR:-/tmp}/pdh-static.$$
analysis=$tmp_base.analysis
images=$tmp_base.images
trap 'rm -f "$tmp_base".*' EXIT HUP INT TERM

if ! awk -v images="$images" '
  function trim(value) {
    sub(/^[[:space:]]+/, "", value)
    sub(/[[:space:]]+$/, "", value)
    return value
  }
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
  function has_attr(tag, name,    low, pattern) {
    low = tolower(tag)
    pattern = "(^|[[:space:]])" name "([[:space:]=>])"
    return match(substr(low, 2), pattern) != 0
  }
  function attr(tag, name,    low, pattern, start, rest, quote, stop) {
    low = tolower(tag)
    pattern = "[[:space:]]" name "[[:space:]]*=[[:space:]]*"
    if (!match(low, pattern)) return ""
    start = RSTART + RLENGTH
    rest = substr(tag, start)
    quote = substr(rest, 1, 1)
    if (quote == "\"" || quote == sprintf("%c", 39)) {
      rest = substr(rest, 2)
      stop = index(rest, quote)
      return stop ? substr(rest, 1, stop - 1) : rest
    }
    if (match(rest, /[[:space:]>]/)) return substr(rest, 1, RSTART - 1)
    return rest
  }
  function has_class(value, wanted,    n, parts, i) {
    n = split(value, parts, /[[:space:]]+/)
    for (i = 1; i <= n; i++) if (parts[i] == wanted) return 1
    return 0
  }
  function describe(tag, id, classes) {
    if (id != "") return tag "#" id
    if (classes != "") { split(classes, desc_parts, /[[:space:]]+/); return tag "." desc_parts[1] }
    return tag
  }
  function add_issue(kind, text) {
    if (issues[kind] == "") issues[kind] = text
    else issues[kind] = issues[kind] "; " text
  }
  function remove_comments(text,    out, start, tail, stop) {
    out = ""
    while ((start = index(text, "/*")) != 0) {
      out = out substr(text, 1, start - 1)
      tail = substr(text, start + 2)
      stop = index(tail, "*/")
      if (!stop) return out
      text = substr(tail, stop + 2)
    }
    return out text
  }
  function selectors_from(css,    out, last, i, c, candidate) {
    css = remove_comments(css)
    out = ""; last = 0
    for (i = 1; i <= length(css); i++) {
      c = substr(css, i, 1)
      if (c == "{") {
        candidate = trim(substr(css, last + 1, i - last - 1))
        if (substr(candidate, 1, 1) != "@") out = out "\n" candidate
        last = i
      } else if (c == "}") last = i
    }
    return out
  }
  function class_defined(name, selectors,    needle, pos, after) {
    needle = "." name
    while ((pos = index(selectors, needle)) != 0) {
      after = substr(selectors, pos + length(needle), 1)
      if (after == "" || after !~ /[A-Za-z0-9_-]/) return 1
      selectors = substr(selectors, pos + 1)
    }
    return 0
  }
  function mandatory(tag) {
    return !(tag ~ /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/ ||
      tag ~ /^(html|head|body|p|li|dt|dd|rt|rp|optgroup|option|colgroup|thead|tbody|tfoot|tr|td|th)$/)
  }
  function in_toc(    i) {
    for (i = depth; i >= 1; i--) if (has_class(stack_class[i], "toc")) return 1
    return 0
  }
  function wrapped_table(    i) {
    for (i = depth; i >= 1; i--) if (has_class(stack_class[i], "table-wrap") || has_class(stack_class[i], "tw")) return 1
    return 0
  }
  function pop_tag(tag,    i, j) {
    for (i = depth; i >= 1; i--) if (stack_tag[i] == tag) {
      for (j = i; j <= depth; j++) { delete stack_tag[j]; delete stack_class[j] }
      depth = i - 1
      return
    }
  }
  function scan_styles(source,    rest, low, start, finish, tail, stop) {
    rest = source
    while (match(tolower(rest), /<style([[:space:]>])/)) {
      start = RSTART
      finish = tag_end(rest, start)
      if (!finish) break
      tail = substr(rest, finish + 1)
      stop = index(tolower(tail), "</style>")
      if (!stop) break
      css_text = css_text substr(tail, 1, stop - 1) "\n"
      rest = substr(tail, stop + 8)
    }
  }
  function find_board(source,    rest, offset, low, start, finish, tag, classes, tail, stop) {
    rest = source; offset = 0
    while (match(tolower(rest), /<main([[:space:]>])/)) {
      start = RSTART
      finish = tag_end(rest, start)
      if (!finish) return ""
      tag = substr(rest, start, finish - start + 1)
      classes = attr(tag, "class")
      if (has_class(classes, "board")) {
        tail = substr(rest, finish + 1)
        stop = index(tolower(tail), "</main>")
        if (!stop) return substr(rest, start)
        return tag substr(tail, 1, stop + 6)
      }
      offset += finish
      rest = substr(rest, finish + 1)
    }
    return ""
  }
  function scan_body(body,    rest, low, start, finish, token, inside, closing, selfclose, name, classes, id, href, src, alt, desc, data, comma, n, parts, i, raw_tail, raw_stop) {
    rest = body
    while ((start = index(rest, "<")) != 0) {
      if (substr(rest, start, 4) == "<!--") {
        finish = index(substr(rest, start + 4), "-->")
        if (!finish) break
        rest = substr(rest, start + finish + 6)
        continue
      }
      finish = tag_end(rest, start)
      if (!finish) break
      token = substr(rest, start, finish - start + 1)
      inside = trim(substr(token, 2, length(token) - 2))
      if (inside ~ /^[!?]/) { rest = substr(rest, finish + 1); continue }
      closing = substr(inside, 1, 1) == "/"
      if (closing) inside = trim(substr(inside, 2))
      selfclose = inside ~ /\/[[:space:]]*$/
      name = tolower(inside); sub(/[[:space:]\/>].*$/, "", name)
      if (name !~ /^[a-z][a-z0-9:-]*$/) { rest = substr(rest, finish + 1); continue }

      if (closing) {
        if (mandatory(name)) ends[name]++
        pop_tag(name)
      } else {
        classes = attr(token, "class")
        id = attr(token, "id")
        desc = describe(name, id, classes)
        n = split(classes, parts, /[[:space:]]+/)
        for (i = 1; i <= n; i++) if (parts[i] != "") used_class[parts[i]] = 1
        if (id != "") { ids[id] = 1; id_tag[id] = name }
        if (has_attr(token, "data-q")) has_data_q = 1
        if (name == "a") {
          href = attr(token, "href")
          if (substr(href, 1, 1) == "#" && href != "#") {
            references[href] = desc
            if (in_toc()) toc_refs[href] = desc
          }
        }
        if (name == "img") {
          alt = trim(attr(token, "alt"))
          if (alt == "") add_issue("image", desc ": alt is empty")
          src = attr(token, "src")
          if (src ~ /^data:image\//) {
            comma = index(src, ",")
            if (!comma || tolower(substr(src, 1, comma - 1)) !~ /;base64$/) add_issue("image", desc ": data URI is not base64")
            else print desc "\t" substr(src, comma + 1) >> images
          }
        }
        if ((has_class(classes, "board") || has_class(classes, "deck")) && has_attr(token, "data-board-id") && trim(attr(token, "data-board-id")) != "")
          has_board_id = 1
        if (has_class(classes, "deck")) {
          has_deck = 1
          if (trim(attr(token, "id")) == "deck") deck_id_ok = 1
        }
        if (has_attr(token, "data-path")) has_path = 1
        if (has_attr(token, "data-host-input")) has_host_input = 1
        if (has_class(classes, "answer-choice")) {
          if (!has_attr(token, "data-q") || trim(attr(token, "data-q")) == "") add_issue("answer", desc ": data-q is missing")
          if (!has_attr(token, "data-label") || trim(attr(token, "data-label")) == "") add_issue("answer", desc ": data-label is missing")
        }
        if (name == "textarea" && has_attr(token, "data-answer-output")) has_output = 1
        if (has_class(classes, "answer-progress")) has_progress = 1
        if (has_attr(token, "data-copy-answer")) has_copy = 1
        if (has_attr(token, "data-copy-status")) has_copy_status = 1
        if (name == "table" && !wrapped_table()) add_issue("table", desc)
        if (mandatory(name)) starts[name]++
        if (!selfclose && name !~ /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/) {
          depth++; stack_tag[depth] = name; stack_class[depth] = classes
        }
      }
      rest = substr(rest, finish + 1)
      if (!closing && (name == "script" || name == "style" || name == "textarea")) {
        raw_tail = tolower(rest)
        raw_stop = index(raw_tail, "</" name ">")
        if (raw_stop) rest = substr(rest, raw_stop)
      }
    }
  }
  function emit(name, detail) {
    if (detail == "") print "PASS " name
    else print "FAIL " name " :: " detail
  }
  {
    source = source $0 "\n"
  }
  END {
    close(images)
    scan_styles(source)
    body = find_board(source)
    if (body == "") {
      print "FAIL タグの均衡 :: main.board range is missing"
      print "FAIL 未定義 class :: main.board range is missing"
      print "FAIL ページ内参照 :: main.board range is missing"
      print "__IMAGE__"
      print "FAIL 回答フォームの属性 :: main.board range is missing"
      print "FAIL 裸の表 :: main.board range is missing"
      exit
    }
    scan_body(body)
    for (tag in starts) {
      difference = starts[tag] - ends[tag]
      if (difference) add_issue("tag", tag " " (difference > 0 ? "+" : "") difference)
    }
    for (tag in ends) if (!(tag in starts)) add_issue("tag", tag " -" ends[tag])
    selectors = selectors_from(css_text)
    for (class_name in used_class) if (!class_defined(class_name, selectors)) add_issue("class", "." class_name)
    for (href in references) {
      target = substr(href, 2)
      if (!(target in ids)) add_issue("reference", references[href] " -> " href)
    }
    # 目次のアンカーが見出しを指すと、選択肢が宛先の中に入らず «判断のある節» の印が消える。
    for (href in toc_refs) {
      target = substr(href, 2)
      if (target in id_tag && id_tag[target] ~ /^h[1-6]$/)
        add_issue("reference", toc_refs[href] " -> " href " (目次の宛先は <section id> にする)")
    }
    if (has_data_q) {
      # board.js は [data-board-id] を起点に探す。無いと最初の 2 行で return するので、
      # 選択も進捗も貼り戻し文も «静かに» 動かない。属性が揃っていても死ぬ唯一の形。
      if (!has_board_id) add_issue("answer", "[data-board-id] is missing on the board root (board.js does nothing without it)")
      # deck.js は getElementById("deck") を前提にする。class だけでは動かない。
      if (has_deck && !deck_id_ok) add_issue("answer", ".deck needs id=\"deck\" (deck.js looks it up by id)")
      # host-setup は [data-host-input] が無いと確認 URL を作らず、path だけが残る。
      if (has_path && !has_host_input) add_issue("answer", "[data-path] exists but [data-host-input] is missing (the URL is never built)")
      if (!has_output) add_issue("answer", "textarea[data-answer-output] is missing")
      if (!has_progress) add_issue("answer", ".answer-progress is missing")
      if (!has_copy) add_issue("answer", "[data-copy-answer] is missing")
      if (!has_copy_status) add_issue("answer", "[data-copy-status] is missing")
    }
    emit("タグの均衡", issues["tag"])
    emit("未定義 class", issues["class"])
    emit("ページ内参照", issues["reference"])
    if (issues["image"] == "") print "__IMAGE__"
    else print "__IMAGE__ :: " issues["image"]
    emit("回答フォームの属性", issues["answer"])
    emit("裸の表", issues["table"])
  }
' "$board" > "$analysis"; then
  echo 'check-static.sh: ERROR: HTML analysis failed' >&2
  exit 2
fi

# base64 の復号 flag は GNU が -d、BSD (macOS) が -D。使えるほうを 1 度だけ選ぶ。
if printf 'eA==' | base64 -d >/dev/null 2>&1; then b64_decode_flag=-d
elif printf 'eA==' | base64 -D >/dev/null 2>&1; then b64_decode_flag=-D
else
  echo "check-static.sh: ERROR: base64 の復号に -d も -D も使えません" >&2
  exit 2
fi

image_issues=
if [ -f "$images" ]; then
  tab=$(printf '\t')
  while IFS="$tab" read -r where payload; do
    [ -n "$where" ] || continue
    if ! printf '%s' "$payload" | base64 "$b64_decode_flag" >/dev/null 2>&1; then
      if [ -n "$image_issues" ]; then image_issues="$image_issues; $where: base64 decode failed"
      else image_issues="$where: base64 decode failed"
      fi
    fi
  done < "$images"
fi

failed=0
while IFS= read -r line; do
  case $line in
    __IMAGE__)
      if [ -n "$image_issues" ]; then line="FAIL 画像 :: $image_issues"
      else line='PASS 画像'
      fi
      ;;
    '__IMAGE__ :: '*)
      inline_issues=${line#'__IMAGE__ :: '}
      if [ -n "$image_issues" ]; then line="FAIL 画像 :: $inline_issues; $image_issues"
      else line="FAIL 画像 :: $inline_issues"
      fi
      ;;
  esac
  printf '%s\n' "$line"
  case $line in FAIL\ *) failed=1 ;; esac
done < "$analysis"

exit "$failed"
