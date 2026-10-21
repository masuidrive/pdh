#!/usr/bin/env bash
# pdh-hooks.sh — github-bot 層の runner hook。PDH mode（product-brief.md と tickets/ がある repo）の
# ときだけ run-action.sh が最終レポートの投稿直前に呼ぶ。
#
# 人との受け渡し経路（GitHub Issue）で、agent の申告に依らず runner が保証するもの:
#   1. note の `## Status: PDH-*` を issue の stage ラベルに写す
#   2. Status が human gate なら、最終レポートにその gate の承認語（🤖 承認 / 🤖 クローズ承認）が無ければ導線を足す
#   3. Status が human gate なら、note の Checklist に «発行先:» + URL か path の未了行が無ければ足す
#      （URL は今回の gate コメント）
#   4. note の Checklist に «未了 + 発行先:» の行があれば awaiting-reply ラベルを付け、無ければ外す
#      （bot の PR が開いていれば Issue から外して PR にだけ付ける。PR が無ければ Issue に付ける）
#   5. 導入検査（ラベル・Actions の PR 作成許可）で要追加があれば報告に足す
#
# ⚠ awaiting-reply は run の «始め» と «終わり» の両方で動かす。終わりだけだと、人が答えて
# run が始まっても付いたままになり、«自分の番» を誤って言い続ける。engine が失敗した run では
# final が呼ばれないので、失敗側からも付ける（止まっていて人の手が要る、という意味は同じ）。
# ⚠ failed でも PR が開いていれば Issue から外して PR にだけ付ける。開始時は両方から外す。
#
# usage:
#   pdh-hooks.sh final <issue> <branch> <comment-id>   # stdin: 最終レポート → stdout: 補正後の本文
#   pdh-hooks.sh start <issue>                          # run の開始: awaiting-reply を外す
#   pdh-hooks.sh progress <issue>                       # 進捗コメント用の AC 一覧を stdout へ
#   pdh-hooks.sh failed <issue> <branch> <comment-id>   # engine 失敗: awaiting-reply を付ける
#   pdh-hooks.sh setup [owner/repo]                     # 導入検査だけ。要追加があれば exit 1
# 依存: bash / git / awk / grep / sed / gh。GITHUB_REPOSITORY を使う（setup は引数でも可）。
set -uo pipefail

# A dispatched PR instruction owns only its specified task, not ticket stages or labels.
if [ -n "${PR_INSTRUCTION:-}" ]; then exit 0; fi

REPO="${GITHUB_REPOSITORY:-}"
STAGES="PDH-ticket-write PDH-open PDH-ticket-review PDH-ticket-human-review PDH-implement PDH-review PDH-verify PDH-human-review PDH-close"
# ⚠ stage ラベルとは別系統。stage は «どこにいるか» しか言わないので、gate でない場所で
# 止まったとき（非収束での escalate・blocker・質問）に «自分の番か» が一覧から分からない。
# STAGES に入れてはならない — 入れると stage を付けるときに他として外される。
AWAITING_LABEL="awaiting-reply"

# Issue / PR の待ち印は表示だけに使う。起動の合図は 🤖 である。
# ⚠ AWAITING_PR は通知にも使うので、呼び手はこの関数をコマンド置換で実行しない。
AWAITING_PR=""
set_awaiting() {  # $1=add|remove  $2=issue  $3=branch  $4=理由
  local action="$1" issue="$2" branch="$3" reason="$4" issue_action="$1"
  AWAITING_PR=""
  if [ -n "$branch" ]; then
    AWAITING_PR=$(gh pr list --head "$branch" --state open --repo "$REPO" --json number --jq '.[0].number' 2>/dev/null || true)
    [ "$AWAITING_PR" = null ] && AWAITING_PR=""
  fi
  [ -z "$AWAITING_PR" ] || issue_action=remove
  gh issue edit "$issue" --repo "$REPO" "--${issue_action}-label" "$AWAITING_LABEL" >/dev/null 2>&1 \
    && log "$AWAITING_LABEL を Issue #$issue に ${issue_action} した（${reason}）" \
    || { [ "$issue_action" = remove ] || log "$AWAITING_LABEL を Issue #$issue に付けられない（ラベルが無いか権限不足。github-bot/INSTALL.md「3. stage ラベルを作る」）"; }
  if [ -n "$AWAITING_PR" ]; then
    gh issue edit "$AWAITING_PR" --repo "$REPO" "--${action}-label" "$AWAITING_LABEL" >/dev/null 2>&1 \
      && log "$AWAITING_LABEL を PR #$AWAITING_PR に ${action} した（${reason}）" \
      || { [ "$action" = remove ] || log "$AWAITING_LABEL を PR #$AWAITING_PR に付けられない（ラベルが無いか権限不足。github-bot/INSTALL.md「3. stage ラベルを作る」）"; }
  fi
}
log() { printf 'pdh-hooks: %s\n' "$*" >&2; }

# 呼び手はコマンド置換を使わず、TICKET_DIR / TICKET_STATE（active|done|空）を読む。
# active の名前 → active の frontmatter → done の名前 → done の frontmatter の順。
# 同じ優先度では各 dir の名前順で選ぶ。
find_ticket() {
  local issue="$1" root mode d matched
  local LC_ALL=C
  local -a candidates matches
  TICKET_DIR="" TICKET_STATE=""
  for root in tickets tickets/done; do
    for mode in name frontmatter; do
      matches=()
      if [ "$mode" = name ]; then
        candidates=("$root"/*-issue-"$issue")
      else
        candidates=("$root"/*)
      fi
      for d in "${candidates[@]}"; do
        [ -f "$d/ticket.md" ] || continue
        if [ "$mode" = frontmatter ]; then
          matched=$(awk -v issue="$issue" '
            NR == 1 {if ($0 != "---") exit; next}
            /^---[[:space:]]*$/ {exit}
            /^(branch|issue):[[:space:]]*/ {
              key=$0; sub(/:.*/, "", key)
              sub(/^(branch|issue):[[:space:]]*/, ""); sub(/[[:space:]]+#.*/, "")
              sub(/[[:space:]]+$/, "")
              if ($0 ~ /^".*"$/ || $0 ~ /^\047.*\047$/) $0=substr($0, 2, length($0)-2)
              if ((key == "branch" && $0 == "agent/issue-" issue) ||
                  (key == "issue" && $0 == issue)) { print "matched"; exit }
            }
          ' "$d/ticket.md")
          [ "$matched" = matched ] || continue
        fi
        matches+=("$d")
      done
      [ "${#matches[@]}" -gt 0 ] || continue
      TICKET_DIR="${matches[0]}"
      case "$TICKET_DIR" in tickets/done/*) TICKET_STATE=done ;; *) TICKET_STATE=active ;; esac
      if [ "${#matches[@]}" -gt 1 ]; then
        log "issue #$issue の ticket が複数（$mode 一致 ${#matches[@]} 件）。最初の $TICKET_DIR を使う"
      fi
      return 0
    done
  done
  return 0
}

setup_check() {
  # 出力: 要追加の行（無ければ空）。exit code は呼び手が判断する。
  local repo="$1" missing="" have
  have=$(gh label list --repo "$repo" --limit 200 --json name -q '.[].name' 2>/dev/null || echo "__gh_failed__")
  if [ "$have" = "__gh_failed__" ]; then
    printf '%s\n' "- stage ラベルを確認できない（gh label list が失敗）"
  else
    for s in $STAGES $AWAITING_LABEL; do
      grep -qx "$s" <<<"$have" || missing="$missing $s"
    done
    [ -z "$missing" ] || printf '%s\n' "- ラベルが無い:${missing}（github-bot/INSTALL.md「3. stage ラベルを作る」）"
  fi
  local perm
  perm=$(gh api "repos/$repo/actions/permissions/workflow" -q .can_approve_pull_request_reviews 2>/dev/null || echo "unknown")
  case "$perm" in
    true) ;;
    false) printf '%s\n' "- Actions が PR を作成できない設定（github-bot/INSTALL.md「Actions に PR 作成を許可する」）" ;;
    *) ;;  # 権限不足で読めないときは黙る（誤報しない）
  esac
}

# 進捗コメントに出す AC 一覧。⚠ AC の本当の状態は ticket.md にあるので、そこだけを読む。
# agent に別ファイルを書かせると «書き忘れ» と «実体とのズレ» の 2 つを新しく抱える。
ac_progress_block() {
  local issue="$1" dir lines total done_n
  find_ticket "$issue"
  [ "$TICKET_STATE" = active ] || return 0
  dir="$TICKET_DIR"
  lines=$(awk '
    /^#+[[:space:]]+(What([[:space:]]|$)|.*Acceptance Criteria)/ {f=1; next}
    f && /^#+[[:space:]]/ {exit}
    f && /^- \[[ x]\]/ {print}
  ' "$dir/ticket.md" | awk 'NR <= 12')
  [ -n "$lines" ] || return 0
  total=$(printf '%s\n' "$lines" | grep -c '^- \[')
  done_n=$(printf '%s\n' "$lines" | grep -c '^- \[x\]')
  printf '**AC %s/%s**\n' "$done_n" "$total"
  # ⚠ `- [ ]` のまま出すと GitHub が «押せる checkbox» として描く。押しても次の更新で
  # 上書きされて消えるだけなので、押せない記号にする。
  printf '%s\n' "$lines" | sed -E 's/^- \[x\][[:space:]]*/✅ /; s/^- \[ \][[:space:]]*/⬜ /'
}

# ⚠ host へ渡すのはデータだけ。ローカル実行では通知先ファイルを作らない。
write_notify() {  # issue kind stage comment_id pr
  [ -n "${CODING_BOT_NOTIFY_FILE:-}" ] || return 0
  local key value
  {
    for key in issue kind stage comment_id pr; do
      value="${1:-}"; shift
      value="${value//$'\n'/}"; value="${value//$'\r'/}"; value="${value//=/}"
      printf '%s=%s\n' "$key" "$value"
    done
  } > "$CODING_BOT_NOTIFY_FILE" || log '通知ファイルを書けない（続行）'
}

read_status() {
  local note="$1" status=""
  if [ -f "$note" ]; then
    status=$(grep -m1 '^## Status:' "$note" | sed -E 's/^## Status:[[:space:]]*(PDH-[a-z-]+).*/\1/')
    case "$status" in PDH-*) ;; *) status="" ;; esac
  fi
  printf '%s' "$status"
}

set_stage_label() {
  local status="$1" issue="$2" have others
  if [ -n "$status" ] && grep -qx "$status" <<<"${STAGES// /$'\n'}"; then
    have=$(gh label list --repo "$REPO" --limit 200 --json name -q '.[].name' 2>/dev/null || true)
    if grep -qx "$status" <<<"$have"; then
      others=$(printf '%s\n' $STAGES | grep -vx "$status" | paste -sd, -)
      if gh issue edit "$issue" --repo "$REPO" --remove-label "$others" --add-label "$status" >/dev/null 2>&1; then
        log "ラベルを $status にした"
      else
        log "ラベル更新に失敗（続行）"
      fi
    fi
  fi
}

# active ticket の無い run は、閉じた issue だけ回答待ちを外す。
# 状態が読めない・空のときも、依頼者の «あなたの番» を消さない。
finalize_without_active_ticket() {
  local issue_state
  issue_state=$(gh issue view "$ISSUE" --repo "$REPO" --json state -q .state 2>/dev/null) || issue_state=""
  if [ "$issue_state" = CLOSED ]; then
    set_awaiting remove "$ISSUE" "$BRANCH" "active ticket の無い issue を閉じた"
  else
    set_awaiting add "$ISSUE" "$BRANCH" "active ticket の無いまま run が終わった＝人に聞いている"
    write_notify "$ISSUE" question "" "$CID" "$AWAITING_PR"
  fi
}

cmd="${1:-}"
case "$cmd" in
  setup)
    repo="${2:-$REPO}"; [ -n "$repo" ] || { log "owner/repo が要る"; exit 2; }
    out=$(setup_check "$repo")
    if [ -n "$out" ]; then printf '%s\n' "$out"; exit 1; fi
    echo "pdh-hooks setup: ok（ラベル 9 段・PR 作成許可）"; exit 0 ;;
  progress)
    issue="${2:-}"; [ -n "$issue" ] || exit 0
    ac_progress_block "$issue"; exit 0 ;;
  start|failed)
    issue="${2:-}"; branch="${3:-}"
    [ -n "$issue" ] && [ -n "$REPO" ] || { log "$cmd: issue / GITHUB_REPOSITORY が要る"; exit 2; }
    if [ "$cmd" = start ]; then
      # run が始まった＝bot の番。人が答えたかどうかに関係なく、いま待ってはいない。
      set_awaiting remove "$issue" "$branch" "run 開始"
    else
      # engine が失敗した＝止まっていて人の手が要る（認証・quota・環境）。final は呼ばれない。
      set_awaiting add "$issue" "$branch" "engine 失敗"
      status=""
      find_ticket "$issue"
      [ -z "$TICKET_DIR" ] || status=$(read_status "$TICKET_DIR/note.md")
      write_notify "$issue" failed "$status" "${4:-}" "$AWAITING_PR"
    fi
    exit 0 ;;
  final) ;;
  *) log "usage: pdh-hooks.sh final <issue> <branch> <comment-id> | start <issue> [branch] | failed <issue> [branch] [comment-id] | progress <issue> | setup [owner/repo]"; exit 2 ;;
esac

ISSUE="${2:-}"; BRANCH="${3:-}"; CID="${4:-}"
[ -n "$ISSUE" ] && [ -n "$BRANCH" ] && [ -n "$REPO" ] || { log "final: issue / branch / GITHUB_REPOSITORY が要る"; cat; exit 1; }
report=$(cat)

# --- ticket dir（active / done / 未作成） ---
find_ticket "$ISSUE"
dir="$TICKET_DIR"
if [ "$TICKET_STATE" != active ]; then
  # active ticket が無いとき、done の PDH-human-review かつ open PR があれば Merge 待ち。
  # それ以外は未作成・done とも質問への回答待ちとして扱う。
  # done の古い ticket が残る再依頼でも、依頼者に «あなたの番» を表示する。
  if [ -z "$TICKET_STATE" ]; then
    finalize_without_active_ticket
  else
    log "issue #$ISSUE は done 済み。note の Status をラベルへ反映する"
    status=$(read_status "$dir/note.md")
    if [ "$status" = "PDH-human-review" ]; then
      pr=$(gh pr list --head "$BRANCH" --state open --repo "$REPO" --json number --jq '.[0].number' 2>/dev/null || true)
      if [[ "$pr" =~ ^[0-9]+$ ]]; then
        set_stage_label "$status" "$ISSUE"
        set_awaiting add "$ISSUE" "$BRANCH" "close gate: PR #$pr の Merge 待ち"
        write_notify "$ISSUE" close_gate "$status" "$CID" "$pr"
      else
        finalize_without_active_ticket
      fi
    else
      finalize_without_active_ticket
    fi
  fi
  printf '%s' "$report"; exit 0
fi
note="$dir/note.md"; changed=0

# --- Status ---
# note の Status は «## Status: PDH-stage» の行から読む。
status=$(read_status "$note")
gate=0; case "$status" in PDH-ticket-human-review|PDH-human-review) gate=1 ;; esac

set_stage_label "$status" "$ISSUE"

# --- 2. 承認導線 ---
if [ "$gate" -eq 1 ]; then report="$report

<!-- coding-bot:question -->"; fi
# close gate の答え方は `github_bot.close` で変わる。⚠ `pr-merge` では merge そのものが
# 承認なので、承認語を求めると承認が 2 回になる（コメント + merge）。
# 読み方は coding-bot-finalize.yml と同じ（引用符と行末コメントを許す）。
close_mode=$(awk '
  /^github_bot:[[:space:]]*(#.*)?$/ { section=1; next }
  section && /^[^[:space:]#]/ { section=0 }
  section && /^  close:/ {
    sub(/^  close:[[:space:]]*/, ""); sub(/[[:space:]]+#.*/, "")
    gsub(/[\047\042[:space:]]/, ""); print; exit
  }' .ticket-config.yaml 2>/dev/null)
if [ "$status" = "PDH-ticket-human-review" ]; then
  word="🤖 承認"
  guide="このスレッドにコメントで返してください: 承認は \`$word\`、直してほしい点は \`🤖 修正して: …\`、差し戻しは \`🤖 差し戻す: …\`。decision-board を HTML で出している場合は「回答をコピー」の貼り戻し文を 🤖 付きで貼ってください。⚠ **返信には必ず 🤖 を付けてください** — 付いていないコメントは bot に届きません（このスレッドでは人同士の会話やメモも書かれるため、🤖 が唯一の合図です）。"
elif [ "$close_mode" = "pr-merge" ]; then
  # ⚠ 単語 `merge` で判定すると、説明文に一度出ただけで導線追加が抑止される。
  # 導線そのものの文を目印にする。
  word="merge が close 承認です"
  if [ -z "$AWAITING_PR" ]; then
    AWAITING_PR=$(gh pr list --head "$BRANCH" --state open --repo "$REPO" --json number --jq '.[0].number' 2>/dev/null || true)
  fi
  guide_pr_url="https://github.com/$REPO/pulls"
  if [[ "$AWAITING_PR" =~ ^[1-9][0-9]*$ ]]; then guide_pr_url="https://github.com/$REPO/pull/$AWAITING_PR"; fi
  # ⚠ 人のクリック数は CODING_BOT_GH_PAT の有無で変わる。案内も変える。
  # 有り: PR の作者が人になるので CI が自動で走る → 押すのは Merge の 1 回だけ
  # 無し: GITHUB_TOKEN が作った PR なので workflow が承認待ちになる → «Approve and run» が要る
  if [ -n "${CODING_BOT_GH_PAT:-}" ]; then
    guide="**[PR](${guide_pr_url}) の CI が緑になったら Merge を 1 回押してください。それが close 承認です。**CI は自動で走っています。直してほしい点があれば、merge せずに \`🤖 修正して: …\` とこのスレッドにコメントしてください。"
  else
    guide="**[PR](${guide_pr_url}) で 2 つ押してください。**① Checks タブの **«Approve and run»**（bot が作った PR なので workflow が承認待ちで止まっています）② 緑になったら **Merge**。⚠ **merge が close 承認です。**直してほしい点があれば、merge せずに \`🤖 修正して: …\` とこのスレッドにコメントしてください（修正後はもう一度 «Approve and run» が要ります）。⚠ **\`CODING_BOT_GH_PAT\` を設定すると、この ① が要らなくなります**（\`github-bot/INSTALL.md\`）。"
  fi
else
  word="🤖 クローズ承認"
  guide="このスレッドにコメントで返してください: 承認は \`$word\`、直してほしい点は \`🤖 修正して: …\`、差し戻しは \`🤖 差し戻す: …\`。decision-board を HTML で出している場合は「回答をコピー」の貼り戻し文を 🤖 付きで貼ってください。⚠ **返信には必ず 🤖 を付けてください** — 付いていないコメントは bot に届きません（このスレッドでは人同士の会話やメモも書かれるため、🤖 が唯一の合図です）。"
fi
# decision-board が backtick 付きの 🤖 回答手順を持つときは、別の承認語を追加しない。
has_answer_path() {
  grep -qF "$word" <<<"$report" && return 0
  [ "$status" = "PDH-ticket-human-review" ] || [ "$close_mode" != "pr-merge" ] || return 1
  grep -q '`🤖' <<<"$report"
}
if [ "$gate" -eq 1 ] && ! has_answer_path; then
  report="$report

### 回答のしかた
$guide"
  log "承認導線を足した（agent の報告に無かった）"
fi

# 内部文書へのリンク行を投稿前に除く。文中の語は下で観測するだけにする。
if [ "$gate" -eq 1 ]; then
  cut=$(printf '%s\n' "$report" | grep -nE '\]\([^)]*(\.claude/skills/|PDH-AGENTS\.md|tickets/)[^)]*\)' || true)
  if [ -n "$cut" ]; then
    printf '%s\n' "$cut" | while IFS= read -r l; do log "⚠ board から行を消した: $(printf '%s' "$l" | cut -c1-140)"; done
    report=$(printf '%s\n' "$report" | grep -vE '\]\([^)]*(\.claude/skills/|PDH-AGENTS\.md|tickets/)[^)]*\)')
  fi
fi

# 文中の process 語は数えてログに出すだけにする。自動置換で文意を変えない。
if [ "$gate" -eq 1 ]; then
  leak=0
  n=$(printf '%s' "$report" | grep -oE 'PDH-[A-Za-z-]+' | sort -u | paste -sd, - )
  [ -n "$n" ] && { log "⚠ board に process 語が漏れている: $n"; leak=1; }
  n=$(printf '%s' "$report" | grep -oE 'tickets/[A-Za-z0-9./-]+' | sort -u | paste -sd, - )
  [ -n "$n" ] && { log "⚠ board に ticket のパスが漏れている: $n"; leak=1; }
  n=$(printf '%s' "$report" | grep -oE '(SKILL\.md|PDH-AGENTS\.md|_flow\.md|pdh-pm|pdh-pm)' | sort -u | paste -sd, - )
  [ -n "$n" ] && { log "⚠ board に skill のファイルが漏れている: $n"; leak=1; }
  n=$(printf '%s' "$report" | grep -owE 'AC' | sort -u | paste -sd, - )
  [ -n "$n" ] && { log "⚠ board に AC という語が漏れている（依頼者の語ではない）"; leak=1; }
  [ "$leak" -eq 0 ] && log "board の process 語: 漏れなし"
fi

# note の Checklist に «未了 + 発行先:» の行があるか。PDH-AGENTS.md「受け渡し経路」が
# «待つものを出したらこの行を書く» と定めているので、これがそのまま «人の答え待ち» の印になる。
has_waiting_line() {
  [ -f "$note" ] || return 1
  awk '
    /^## Checklist[[:space:]]*$/ {f=1; next}
    /^##? / {f=0}
    f && /^- \[ \].*発行先:.*(https?:\/\/|\/)/ {found=1}
    END {exit !found}
  ' "$note"
}

# --- 3. 待ち行 ---
waiting_unwritten=0
if [ "$gate" -eq 1 ] && [ -f "$note" ]; then
  if ! has_waiting_line; then
    url="https://github.com/$REPO/issues/$ISSUE"; [ -n "$CID" ] && url="$url#issuecomment-$CID"
    line="- [ ] $status: 回答待ち。発行先: ${url}（答えを ticket へ反映した手で [x]）"
    tmp=$(mktemp)
    if awk -v line="$line" '
      /^## Checklist[[:space:]]*$/ {print; f=1; seen=1; next}
      f && /^##? / {print line; print ""; f=0}
      {print}
      END {if (f) print line; exit !seen}
    ' "$note" > "$tmp"; then
      mv "$tmp" "$note"
      log "note の Checklist に待ち行を足した（agent は書いていなかった）"; changed=1
    else
      rm -f "$tmp"
      # 足せなかったのに回答待ちのラベルを外すと、人の番であることが一覧から消える。
      log "note に «## Checklist» の見出しが無く、待ち行を足せなかった。回答待ちのまま扱う"
      waiting_unwritten=1
    fi
  fi
fi

# --- 4. 回答待ちラベル ---
# ⚠ 手順 3 が待ち行を足しうるので、必ずその後で判定する。
# gate かどうかを見ない — gate でない場所で止まったとき（非収束での escalate・blocker・質問）に
# こそ要る。実際に起きた: レビュー 3 巡目の escalate で止まったが、ラベルは
# PDH-review のままで «動いているのか待っているのか» が一覧から区別できなかった。
# 答えを反映した手で [x] にすると、次の run のこの節がラベルを外す（自動で戻る）。
if [ -f "$note" ]; then
  if has_waiting_line; then
    set_awaiting add "$ISSUE" "$BRANCH" "回答待ちの行がある"
  elif [ "$waiting_unwritten" -eq 1 ]; then
    set_awaiting add "$ISSUE" "$BRANCH" "gate で止まったが、待ち行を足せなかった"
  else
    set_awaiting remove "$ISSUE" "$BRANCH" "回答待ちの行が無い"
  fi
fi

# ⚠ 待ち行を補った後の状態を使い、ラベルと通知の理由を一致させる。
kind=""
if [ "$status" = PDH-ticket-human-review ]; then
  kind=ticket_gate
elif [ "$status" = PDH-human-review ] && [ -n "$AWAITING_PR" ]; then
  kind=close_gate
elif has_waiting_line; then
  kind=blocked
fi
[ -z "$kind" ] || write_notify "$ISSUE" "$kind" "$status" "$CID" "$AWAITING_PR"

# --- commit / push（待ち行を足したとき） ---
if [ "$changed" -eq 1 ]; then
  git add "$note" 2>/dev/null
  if git -c user.name="pdh-hooks" -c user.email="pdh-hooks@users.noreply.github.com" commit -q -m "chore(pdh-hooks): gate の待ち行を補う（issue #${ISSUE}）" 2>/dev/null; then
    git push --no-verify -q origin "$BRANCH" 2>/dev/null || log "push に失敗（ローカルには commit 済み）"
  fi
fi

# --- 4. 導入検査 ---
setup=$(setup_check "$REPO")
if [ -n "$setup" ]; then
  report="$report

### ⚠ 導入検査で要追加
$setup"
fi

printf '%s' "$report"
