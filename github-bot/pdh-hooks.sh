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
#      （ただし bot の PR が開いていれば、issue には付けず PR にだけ付ける。待っているのは Merge なので）
#   5. 導入検査（ラベル・Actions の PR 作成許可）で要追加があれば報告に足す
#
# ⚠ awaiting-reply は run の «始め» と «終わり» の両方で動かす。終わりだけだと、人が答えて
# run が始まっても付いたままになり、«自分の番» を誤って言い続ける。engine が失敗した run では
# final が呼ばれないので、失敗側からも付ける（止まっていて人の手が要る、という意味は同じ）。
#
# usage:
#   pdh-hooks.sh final <issue> <branch> <comment-id>   # stdin: 最終レポート → stdout: 補正後の本文
#   pdh-hooks.sh start <issue>                          # run の開始: awaiting-reply を外す
#   pdh-hooks.sh progress <issue>                       # 進捗コメント用の AC 一覧を stdout へ
#   pdh-hooks.sh failed <issue> <branch> <comment-id>   # engine 失敗: awaiting-reply を付ける
#   pdh-hooks.sh setup [owner/repo]                     # 導入検査だけ。要追加があれば exit 1
# 依存: bash / git / awk / grep / sed / gh。GITHUB_REPOSITORY を使う（setup は引数でも可）。
set -uo pipefail

REPO="${GITHUB_REPOSITORY:-}"
STAGES="PDH-open PDH-ticket-review PDH-ticket-human-review PDH-implement PDH-review PDH-verify PDH-human-review PDH-close"
# ⚠ stage ラベルとは別系統。stage は «どこにいるか» しか言わないので、gate でない場所で
# 止まったとき（非収束での escalate・blocker・質問）に «自分の番か» が一覧から分からない。
# STAGES に入れてはならない — 入れると stage を付けるときに他として外される。
AWAITING_LABEL="awaiting-reply"

# ⚠ 待ち印は Issue と PR の «両方» に付ける。
#
# coding-robot.yml は «この印が付いている間は 🤖 無しのコメントでも起動する» を、
# その event の label で判定する。ところが PR へのコメントは issue_comment として飛び、
# github.event.issue は **PR 自身** を指すので、Issue に付けた印は見えない。
# 片方だけに付けると、依頼者がいちばん迷う close gate（板は PR にある）で効かない。
#
# ⚠ 触るのは AWAITING_LABEL だけにする。人が PR に付けた他の label には触れない。
awaiting_label_on_pr() {  # $1=add|remove  $2=branch
  local action="$1" branch="${2:-}" pr
  [ -n "$branch" ] || return 0
  pr=$(gh pr list --head "$branch" --state open --repo "$REPO" --json number --jq '.[0].number' 2>/dev/null || true)
  [ -n "$pr" ] && [ "$pr" != "null" ] || return 0
  gh issue edit "$pr" --repo "$REPO" "--${action}-label" "$AWAITING_LABEL" >/dev/null 2>&1 \
    && log "$AWAITING_LABEL を PR #$pr にも ${action} した"
}
log() { printf 'pdh-hooks: %s\n' "$*" >&2; }

setup_check() {
  # 出力: 要追加の行（無ければ空）。exit code は呼び手が判断する。
  local repo="$1" missing="" have
  have=$(gh label list --repo "$repo" --limit 200 --json name -q '.[].name' 2>/dev/null || echo "__gh_failed__")
  if [ "$have" = "__gh_failed__" ]; then
    printf '%s\n' "- stage ラベルを確認できない（gh label list が失敗）"
  else
    for s in $STAGES $AWAITING_LABEL; do
      printf '%s\n' "$have" | grep -qx "$s" || missing="$missing $s"
    done
    [ -z "$missing" ] || printf '%s\n' "- ラベルが無い:$missing（github-bot/INSTALL.md「3. stage ラベルを作る」）"
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
  local issue="$1" dir="" d lines total done_n
  for d in tickets/*-issue-"$issue"; do
    [ -d "$d" ] && [ -f "$d/ticket.md" ] && { dir="$d"; break; }
  done
  [ -n "$dir" ] || return 0
  lines=$(awk '
    /^#+ .*Acceptance Criteria/ {f=1; next}
    f && /^#+ / {exit}
    f && /^- \[[ x]\]/ {print}
  ' "$dir/ticket.md" | head -12)
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
  [ -n "${CODING_ROBOT_NOTIFY_FILE:-}" ] || return 0
  local key value
  {
    for key in issue kind stage comment_id pr; do
      value="${1:-}"; shift
      value="${value//$'\n'/}"; value="${value//$'\r'/}"; value="${value//=/}"
      printf '%s=%s\n' "$key" "$value"
    done
  } > "$CODING_ROBOT_NOTIFY_FILE" || log '通知ファイルを書けない（続行）'
}

read_status() {
  local note="$1" status=""
  if [ -f "$note" ]; then
    status=$(grep -m1 '^## Status:' "$note" | sed -E 's/^## Status:[[:space:]]*(PDH-[a-z-]+).*/\1/')
    [ -n "$status" ] || status=$(awk '/^## Status[[:space:]]*$/{getline; while ($0 ~ /^[[:space:]]*$/ || $0 ~ /^<!--/) getline; print; exit}' "$note" | sed -E 's/.*(PDH-[a-z-]+).*/\1/')
    case "$status" in PDH-*) ;; *) status="" ;; esac
  fi
  printf '%s' "$status"
}

cmd="${1:-}"
case "$cmd" in
  setup)
    repo="${2:-$REPO}"; [ -n "$repo" ] || { log "owner/repo が要る"; exit 2; }
    out=$(setup_check "$repo")
    if [ -n "$out" ]; then printf '%s\n' "$out"; exit 1; fi
    echo "pdh-hooks setup: ok（ラベル 8 段・PR 作成許可）"; exit 0 ;;
  progress)
    issue="${2:-}"; [ -n "$issue" ] || exit 0
    ac_progress_block "$issue"; exit 0 ;;
  start|failed)
    issue="${2:-}"; branch="${3:-}"
    [ -n "$issue" ] && [ -n "$REPO" ] || { log "$cmd: issue / GITHUB_REPOSITORY が要る"; exit 2; }
    if [ "$cmd" = start ]; then
      # run が始まった＝bot の番。人が答えたかどうかに関係なく、いま待ってはいない。
      gh issue edit "$issue" --repo "$REPO" --remove-label "$AWAITING_LABEL" >/dev/null 2>&1 \
        && log "$AWAITING_LABEL を外した（run 開始）"
      awaiting_label_on_pr remove "$branch"
    else
      # engine が失敗した＝止まっていて人の手が要る（認証・quota・環境）。final は呼ばれない。
      gh issue edit "$issue" --repo "$REPO" --add-label "$AWAITING_LABEL" >/dev/null 2>&1 \
        && log "$AWAITING_LABEL を付けた（engine 失敗）"
      awaiting_label_on_pr add "$branch"
      status=""
      for d in tickets/*-issue-"$issue" tickets/done/*-issue-"$issue"; do
        [ -f "$d/note.md" ] && { status=$(read_status "$d/note.md"); break; }
      done
      pr=$(gh pr list --head "$branch" --state open --repo "$REPO" --json number --jq '.[0].number' 2>/dev/null || true)
      [ "$pr" = null ] && pr=""
      write_notify "$issue" failed "$status" "${4:-}" "$pr"
    fi
    exit 0 ;;
  final) ;;
  *) log "usage: pdh-hooks.sh final <issue> <branch> <comment-id> | start <issue> [branch] | failed <issue> [branch] [comment-id] | progress <issue> | setup [owner/repo]"; exit 2 ;;
esac

ISSUE="${2:-}"; BRANCH="${3:-}"; CID="${4:-}"
[ -n "$ISSUE" ] && [ -n "$BRANCH" ] && [ -n "$REPO" ] || { log "final: issue / branch / GITHUB_REPOSITORY が要る"; cat; exit 1; }
report=$(cat)

# --- ticket dir（done/ は対象外） ---
dir=""
for d in tickets/*-issue-"$ISSUE"; do [ -d "$d" ] && [ -f "$d/ticket.md" ] && { dir="$d"; break; }; done
if [ -z "$dir" ]; then
  # ⚠ ticket dir が無いのは 2 通りあり、扱いが逆になる。
  #   done 済み  : tickets/done/*-issue-N が在る。ラベルは補正しない（PR の Merge 待ちも含む）
  #   未作成     : どちらも無い。bot が «足りないことを聞く» 段で止まっている（_issue.md A0）
  # 後者でラベルを付けないと、依頼者の画面に «あなたの番» が 1 つも出ない。
  done_dir=""
  for d in tickets/done/*-issue-"$ISSUE"; do [ -d "$d" ] && { done_dir="$d"; break; }; done
  if [ -z "$done_dir" ]; then
    gh issue edit "$ISSUE" --repo "$REPO" --add-label "$AWAITING_LABEL" >/dev/null 2>&1 \
      && log "$AWAITING_LABEL を付けた（ticket 未作成のまま run が終わった＝人に聞いている）"
    awaiting_label_on_pr add "$BRANCH"
    pr=$(gh pr list --head "$BRANCH" --state open --repo "$REPO" --json number --jq '.[0].number' 2>/dev/null || true)
    [ "$pr" = null ] && pr=""
    write_notify "$ISSUE" question "" "$CID" "$pr"
  else
    log "issue #$ISSUE は done 済み。補正なし"
    status=$(read_status "$done_dir/note.md")
    if [ "$status" = "PDH-human-review" ]; then
      pr=$(gh pr list --head "$BRANCH" --state open --repo "$REPO" --json number --jq '.[0].number' 2>/dev/null || true)
      if [[ "$pr" =~ ^[0-9]+$ ]]; then
        write_notify "$ISSUE" close_gate "$status" "$CID" "$pr"
      fi
    fi
  fi
  printf '%s' "$report"; exit 0
fi
note="$dir/note.md"; changed=0

# --- Status ---
# ⚠ note の Status は 2 通りの書き方がある。両方を読む。
#   `## Status: PDH-implement`（見出しと同じ行。上流テンプレ）
#   `## Status` の次行に値（この repo の .ticket-config.yaml のテンプレ）
# 片方しか読まないと status が空になり、gate=0 になって **ラベルも承認導線も待ち行も
# 足されない**（2026-09-15、独立 review が検出）。
status=$(read_status "$note")
gate=0; case "$status" in PDH-ticket-human-review|PDH-human-review) gate=1 ;; esac

# --- 1. stage ラベル ---
if [ -n "$status" ] && printf '%s\n' $STAGES | grep -qx "$status"; then
  have=$(gh label list --repo "$REPO" --limit 200 --json name -q '.[].name' 2>/dev/null || true)
  if printf '%s\n' "$have" | grep -qx "$status"; then
    others=$(printf '%s\n' $STAGES | grep -vx "$status" | paste -sd, -)
    if gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$others" --add-label "$status" >/dev/null 2>&1; then
      log "ラベルを $status にした"
    else
      log "ラベル更新に失敗（続行）"
    fi
  fi
fi

# --- 2. 承認導線 ---
# close gate の答え方は `github_bot.close` で変わる。⚠ `pr-merge` では merge そのものが
# 承認なので、承認語を求めると承認が 2 回になる（コメント + merge）。
close_mode=$(awk '/^github_bot:/{f=1;next} /^[^ #]/{f=0} f && /^[[:space:]]*close:[[:space:]]*/{print $2; exit}' .ticket-config.yaml 2>/dev/null)
if [ "$status" = "PDH-ticket-human-review" ]; then
  word="🤖 承認"
  guide="この Issue にコメントで返してください: 承認は \`$word\`、直してほしい点は \`🤖 修正して: …\`、差し戻しは \`🤖 差し戻す: …\`。板を HTML で出している場合は「回答をコピー」の貼り戻し文を 🤖 付きで貼ってください。⚠ **返信には必ず 🤖 を付けてください** — 付いていないコメントは bot に届きません（この Issue では人同士の会話やメモも書かれるため、🤖 が唯一の合図です）。"
elif [ "$close_mode" = "pr-merge" ]; then
  # ⚠ 単語 `merge` で判定すると、説明文に一度出ただけで導線追加が抑止される。
  # 導線そのものの文を目印にする。
  word="merge が close 承認です"
  # ⚠ 人のクリック数は ATTACHMENTS_TOKEN の有無で変わる。案内も変える。
  # 有り: PR の作者が人になるので CI が自動で走る → 押すのは Merge の 1 回だけ
  # 無し: GITHUB_TOKEN が作った PR なので workflow が承認待ちになる → «Approve and run» が要る
  if [ -n "${ATTACHMENTS_TOKEN:-}" ]; then
    guide="**この PR の CI が緑になったら Merge を 1 回押してください。それが close 承認です。**CI は自動で走っています。直してほしい点があれば、merge せずに \`🤖 修正して: …\` とコメントしてください。"
  else
    guide="**この PR で 2 つ押してください。**① Checks タブの **«Approve and run»**（bot が作った PR なので workflow が承認待ちで止まっています）② 緑になったら **Merge**。⚠ **merge が close 承認です。**直してほしい点があれば、merge せずに \`🤖 修正して: …\` とコメントしてください（修正後はもう一度 «Approve and run» が要ります）。⚠ **`ATTACHMENTS_TOKEN` を設定すると、この ① が要らなくなります**（`github-bot/INSTALL.md`）。"
  fi
else
  word="🤖 クローズ承認"
  guide="この Issue にコメントで返してください: 承認は \`$word\`、直してほしい点は \`🤖 修正して: …\`、差し戻しは \`🤖 差し戻す: …\`。板を HTML で出している場合は「回答をコピー」の貼り戻し文を 🤖 付きで貼ってください。⚠ **返信には必ず 🤖 を付けてください** — 付いていないコメントは bot に届きません（この Issue では人同士の会話やメモも書かれるため、🤖 が唯一の合図です）。"
fi
# ⚠ 板が自分で答え方を書いているなら、足さない。
# 実測 2026-09-19: 板は «`🤖 1で進めて` / `🤖 2で進めて`» と選択肢ごとの返し方を
# 書いていたのに、`🤖 承認` という語が無かったので hook が末尾に別の導線を足した。
# **読み手は 3 つの語（1で進めて / 2で進めて / 承認）を渡されて、どれで返すか分からない。**
# 案ごとの返し方は語が毎回変わるので、語では探せない — **backtick に囲まれた 🤖 の指示**が
# あるかどうかで見る。⚠ `pr-merge` の close gate だけは 🤖 の指示ではなく «merge を押す» なので、
# 従来どおり導線そのものの文で判定する。
has_answer_path() {
  printf '%s' "$report" | grep -qF "$word" && return 0
  [ "$status" = "PDH-ticket-human-review" ] || [ "$close_mode" != "pr-merge" ] || return 1
  printf '%s' "$report" | grep -q '`🤖'
}
if [ "$gate" -eq 1 ] && ! has_answer_path; then
  report="$report

### 回答のしかた
$guide"
  log "承認導線を足した（agent の報告に無かった）"
fi

# --- 2.4. 内部 process 文書へのリンクを含む行を消す ---
# ⚠ **消してよいのはこの 1 種だけである。**`.claude/skills/` 配下・`PDH-AGENTS.md`・
# `tickets/…` へのリンクは、`_github-issue.md` の «0 本 / 0 件» で**どんな板にも正当な用途が無い**。
# だから行ごと落としても読み手は何も失わない。⚠ **語の漏れ（`AC` / `PDH-…` が文の中に出る）は
# 消さない** — 文の一部なので、消すと文が途中で切れる。あちらは下の 2.5 で数えるだけにする。
# ⚠ 実測 2026-09-19: 同じ ticket の 4 run のうち 3 回、同じ定型文（«実装前で止める理由：… に従っています»）で
# 出た。規則を «0 件» と書き直しても止まらなかったので、機械側にも落とす口を作る。
if [ "$gate" -eq 1 ]; then
  cut=$(printf '%s\n' "$report" | grep -nE '\]\([^)]*(\.claude/skills/|PDH-AGENTS\.md|tickets/)[^)]*\)' || true)
  if [ -n "$cut" ]; then
    printf '%s\n' "$cut" | while IFS= read -r l; do log "⚠ board から行を消した: $(printf '%s' "$l" | cut -c1-140)"; done
    report=$(printf '%s\n' "$report" | grep -vE '\]\([^)]*(\.claude/skills/|PDH-AGENTS\.md|tickets/)[^)]*\)')
  fi
fi

# --- 2.5. process 語の漏れを数える ---
# ⚠ ここは直さない。数えて log に出すだけである。**守るのは «漏れたことが run のログから
# 分かること»** で、文の中の語を機械で書き換えると、削った跡が読み手に見えない形で文意を壊す。
# 規則は `_github-issue.md`「board から外すのは…」が持つ（`PDH-` 0 個 / `tickets/` 0 本 /
# skill のファイル 0 件）。⚠ 実測 2026-09-19: 板が 3 種すべて漏らしていた回がある。
if [ "$gate" -eq 1 ]; then
  leak=0
  n=$(printf '%s' "$report" | grep -oE 'PDH-[A-Za-z-]+' | sort -u | paste -sd, - )
  [ -n "$n" ] && { log "⚠ board に process 語が漏れている: $n"; leak=1; }
  n=$(printf '%s' "$report" | grep -oE 'tickets/[A-Za-z0-9./-]+' | sort -u | paste -sd, - )
  [ -n "$n" ] && { log "⚠ board に ticket のパスが漏れている: $n"; leak=1; }
  n=$(printf '%s' "$report" | grep -oE '(SKILL\.md|PDH-AGENTS\.md|_flow\.md|pdh-dev)' | sort -u | paste -sd, - )
  [ -n "$n" ] && { log "⚠ board に skill のファイルが漏れている: $n"; leak=1; }
  n=$(printf '%s' "$report" | grep -owE 'AC' | sort -u | paste -sd, - )
  [ -n "$n" ] && { log "⚠ board に AC という語が漏れている（依頼者の語ではない）"; leak=1; }
  [ "$leak" -eq 0 ] && log "board の process 語: 漏れなし"
fi

# note の Checklist に «未了 + 発行先:» の行があるか。PDH-AGENTS.md「Handover Routes」が
# «待つものを出したらこの行を書く» と定めているので、これがそのまま «人の答え待ち» の印になる。
has_waiting_line() {
  [ -f "$note" ] || return 1
  awk '/^## Checklist/{f=1;next} /^## /{f=0} f' "$note" | grep -Eq '^- \[ \].*発行先:.*(https?://|/)'
}

# --- 3. 待ち行 ---
if [ "$gate" -eq 1 ] && [ -f "$note" ]; then
  if ! has_waiting_line; then
    url="https://github.com/$REPO/issues/$ISSUE"; [ -n "$CID" ] && url="$url#issuecomment-$CID"
    line="- [ ] $status: 回答待ち。発行先: ${url}（答えを ticket へ反映した手で [x]）"
    tmp=$(mktemp)
    awk -v line="$line" '
      /^## Checklist/ {print; f=1; next}
      f && /^## / {print line; print ""; f=0}
      {print}
      END {if (f) print line}
    ' "$note" > "$tmp" && mv "$tmp" "$note"
    log "note の Checklist に待ち行を足した（agent は書いていなかった）"; changed=1
  fi
fi

# --- 4. 回答待ちラベル ---
# ⚠ 手順 3 が待ち行を足しうるので、必ずその後で判定する。
# gate かどうかを見ない — gate でない場所で止まったとき（非収束での escalate・blocker・質問）に
# こそ要る。2026-09-16 に実際に起きた: レビュー 3 巡目の escalate で止まったが、ラベルは
# PDH-review のままで «動いているのか待っているのか» が一覧から区別できなかった。
# 答えを反映した手で [x] にすると、次の run のこの節がラベルを外す（自動で戻る）。
open_pr=""
if [ -f "$note" ]; then
  # ⚠ bot が PR を作ったあとは、issue には付けない。人がすることは PR の Merge で、issue への返事では
  #   ない（close gate の答え方は Merge なので、Checklist の行は «答え待ち» のまま残る）。issue に
  #   «返事待ち» が付いていると、実態と合わない（2026-09-24 ユーザ指摘）。PR 側には付ける
  open_pr=""
  if [ -n "$BRANCH" ]; then
    open_pr=$(gh pr list --head "$BRANCH" --state open --repo "$REPO" --json number --jq '.[0].number' 2>/dev/null || true)
    [ "$open_pr" = "null" ] && open_pr=""
  fi
  if has_waiting_line && [ -n "$open_pr" ]; then
    gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$AWAITING_LABEL" >/dev/null 2>&1 \
      && log "$AWAITING_LABEL を issue から外した（PR #$open_pr が開いている＝待っているのは Merge）"
    awaiting_label_on_pr add "$BRANCH"
  elif has_waiting_line; then
    gh issue edit "$ISSUE" --repo "$REPO" --add-label "$AWAITING_LABEL" >/dev/null 2>&1 \
      && log "$AWAITING_LABEL を付けた（回答待ちの行がある）"
    awaiting_label_on_pr add "$BRANCH"
  else
    gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$AWAITING_LABEL" >/dev/null 2>&1 \
      && log "$AWAITING_LABEL を外した（回答待ちの行が無い）"
    awaiting_label_on_pr remove "$BRANCH"
  fi
fi

# ⚠ 待ち行を補った後の状態を使い、ラベルと通知の理由を一致させる。
kind=""
if [ "$status" = PDH-ticket-human-review ]; then
  kind=ticket_gate
elif [ "$status" = PDH-human-review ] && [ -n "$open_pr" ]; then
  kind=close_gate
elif has_waiting_line; then
  kind=blocked
fi
[ -z "$kind" ] || write_notify "$ISSUE" "$kind" "$status" "$CID" "$open_pr"

# --- commit / push（待ち行を足したとき） ---
if [ "$changed" -eq 1 ]; then
  git add "$note" 2>/dev/null
  if git -c user.name="pdh-hooks" -c user.email="pdh-hooks@users.noreply.github.com" commit -q -m "chore(pdh-hooks): gate の待ち行を補う（issue #${ISSUE}）" 2>/dev/null; then
    git push -q origin "$BRANCH" 2>/dev/null || log "push に失敗（ローカルには commit 済み）"
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
