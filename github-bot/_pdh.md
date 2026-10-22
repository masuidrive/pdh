# PDH モード（このリポジトリは Product Delivery Hierarchy 構成）

このリポジトリには `product-brief.md` と `tickets/` があり、**PDH（ticket 駆動）** で運用する。すべての作業は ticket を単位に行い、`product-brief.md` が全判断の基準。

## 受け渡し経路（この run）

<Human-Agent-Interface>
この run の人との受け渡し経路は GitHub Issue のコメントである。`pdh-pm`「起動側が受け渡し経路を指定したとき」 の 6 項目を次のとおり定める。これ以外の規則（承認の PDH-stage での停止・AC の承認・証拠・note の Checklist）は、この `<Human-Agent-Interface>` の囲み（起動側が受け渡し経路を指定する範囲）で変わらない。

- **渡す場所**: issue コメント（最終レポートを `run-action.sh` が投稿する）と、issue の stage ラベル（`pdh-hooks.sh` が run の終わりに note の `## Status:` から付ける。agent は Status を到達した PDH-stage に保つ）。承認の PDH-stage で停止する run の最終レポートは `_github-issue.md` の decision-board で、返信の書き方の案内を含める（PDH-ticket-human-review は `🤖 承認`。⚠ **PDH-human-review の承認の形は `.ticket-config.yaml` の `github_bot.close` で選ぶ。`merge` / `pr` は `🤖 クローズ承認`、`pr-merge` は «この PR を merge»**）。`_issue.md` の «Create Pull Request» で終わる形式は PDH では使わない — PR は bot が作る。⚠ **`pr-merge` では PR が close の承認の場所なので、実装が終わった時点で作り、承認より前に存在する。**
- **答えが戻る場所**: 🤖 を含む issue コメント。HTML の decision-board を出したときは、人が decision-board の「回答をコピー」で出た貼り戻し文（回答をコピーして会話へ貼る文）をそのまま貼る。
- **表現の上限**: Markdown（表・`<details>`・mermaid 可。HTML はソース表示になるので不可）。
- **発行先**: Markdown で足りる decision-board は issue コメント本文。足りない decision-board は project ルール（`CLAUDE.md` と、`pdh-pm` が読ませる project 固有の PM の規則）に登録された発行先へ HTML を置き、issue には URL と、同じ decision-board から変換した Markdown 本文を出す。登録が無ければ Markdown で出し、画面写真は載せられなかったことと理由を書き、承認者に画面で確かめてもらう。
- **答えの戻し方**: トリガーコメントを答えとして解釈し、ticket へ反映して note の Checklist の行を `[x]` にする。
- **再開時に読む場所**: `pdh-resume`「どこまで進んでいたかを読み取る」が挙げるもの（Status・progress・git・Checklist の待ち行）と、issue のコメント列（答え）。承認の PDH-stage で停止するときは、停止する同じ commit で note の `## Checklist` に「何の答えを待つか」と `発行先:` に続けて URL か path を 1 行書く。`.github/coding-bot/` の script が持つ状態ファイルは、同じコメントを二度処理しないための印にだけ使う。
</Human-Agent-Interface>

## 手順の定義は `[SKILLS_PATH]/pdh-pm/` などの skill にある（必ず順に Read）

PDH-flow の手順は `[SKILLS_PATH]/pdh-pm/` と PDH-stage ごとの skill で定義される（`[SKILLS_PATH]` は Claude Code では `.claude/skills`、Codex では `.agents/skills`。`[TICKET_DIR]` は ticket のディレクトリで、`./ticket.sh start` の出力の `ticket_dir:`）。以下が存在すれば **この順で Read** し、その手順に従うこと:

1. `SKILL.md` — 入口。PDH-flow の状態遷移・どの PDH-stage でどの skill を読むか
2. `[SKILLS_PATH]/pdh-pm/_records.md` — 記録の決まり（判断の優先順位・ticket / note / progress の役割分担・成果物セルフチェック）
3. PDH-stage ごとの skill（`pdh-ticket-write` → `pdh-open` → `pdh-ticket-review` → `pdh-implement` → `pdh-review` → `pdh-verify` → `pdh-close`。承認の PDH-stage は `pdh-pm` の «承認の PDH-stage»。同じ issue の 2 回目以降の run は、作業が中断している ticket を再開するので `pdh-resume` も読む）— PM の手順本体。worker の手順は `.claude/agents/pdh-<役割>.md` の本文にある
4. `pdh-pm`「人とのやり取り」— ユーザ相談ルール（中止は `pdh-close`）
5. `[SKILLS_PATH]/pdh-pm/_execution-team.md` — 実行モデル: team（あなたは PM として worker を spawn する。spawn 機構・並行起動を含む）
6. `.claude/agents/pdh-*.md` — worker の手順（役割ごとに 1 本。CLI で起動する worker には、その本文を prompt の冒頭に渡す）

**上の 1〜6 は必須。** 一部でも欠けている場合（PDH の skill が未インストール / 古い）、**実装に進まず「`[SKILLS_PATH]/pdh-pm/` などの PDH の skill が不足しているので進めません。PDH-repo（masuidrive/pdh）から install してください」と報告して停止**する。通常の作業 engine が読む `_issue.md` は PDH 固有の規則（commit の頻度・review の収束・test-all が落ちたときの処置 等）を書き直さない方針なので、PDH の skill 無しでは正しく動かない。

## チケットの単位・ブランチ・命名（決定的）
- 1 Issue = 1 ticket = 1 作業単位。ブランチは `agent/issue-<N>`。
- チケット名は **決定的**に算出する（再実行しても必ず同じ名前 → 重複作成を防ぐ）:
  ```bash
  CREATED_AT=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json createdAt -q .createdAt)
  TS=$(date -u -d "$CREATED_AT" +%y%m%d-%H%M%S 2>/dev/null || date -u -jf "%Y-%m-%dT%H:%M:%SZ" "$CREATED_AT" +%y%m%d-%H%M%S)
  TICKET_NAME="${TS}-issue-${ISSUE_NUMBER}"        # 例: 260528-145617-issue-7
  ```
  （`date -d` は GNU、`date -jf` は BSD/macOS。両対応で書く。）

## チケットは `ticket.sh new --branch` で作り、`start` / `restore` / `check` / `close` も ticket.sh で行う
ファイル本体は `ticket.sh new` で生成する。**bot の branch `agent/issue-N` は `run-action.sh` が先に作るので、`--branch` で ticket に書く。**以後 `start` / `restore` / `check` / `close` はその branch と ticket を対応付けて動く（ticket は agent branch にだけあり、base branch には無い。`start` はその旨を 1 行出して fast-forward を省く）。

**agent は、`run-action.sh` が worktree で開いた `agent/issue-N` の中で起動する**（元の checkout は base branch のまま）。`.ticket-config.yaml` が `worktree_mode: true` でも、ticket.sh は branch を持つこの worktree をそのまま使うので、`start` / `restore` で別の worktree はできない。cwd を動かさずに作業する。

ticket・note・`progress.md` の実パスは、`start` / `restore` が出す `Active ticket paths:` の行が示す。**その行を読んで以降の参照に使う**（パスをハードコードしない）。

**find-or-create（重複させない）**: この規則の目的: 1 つの issue に ticket が 1 つだけあること。`new` の前に、次の順で既存の ticket を探す。

1. frontmatter の `branch:` が今の branch（`agent/issue-N`）と一致する ticket。下の «依頼が既存のチケットを名指ししていたら» で引き継いだ ticket は `issue-<N>` の名前を持たないので、名前では見つからない
2. 決定的に算出した `TICKET_NAME` の ticket

```bash
BRANCH="agent/issue-${ISSUE_NUMBER}"
FOUND=$(for f in tickets/*/ticket.md tickets/done/*/ticket.md; do
  [ -f "$f" ] || continue
  b=$(awk 'NR == 1 && $0 != "---" { exit } NR > 1 && $0 == "---" { exit }
           /^branch:/ { sub(/^branch:[[:space:]]*/, ""); gsub(/["\047]/, ""); print $1; exit }' "$f")
  [ "$b" = "$BRANCH" ] && basename "$(dirname "$f")"
done | head -1)
for d in "tickets/${TICKET_NAME}" "tickets/done/${TICKET_NAME}"; do
  [ -z "$FOUND" ] && [ -f "$d/ticket.md" ] && FOUND="$TICKET_NAME"
done
```

- **見つかった** — `TICKET_NAME="$FOUND"` にして `bash ticket.sh restore` で current-ticket.md などの symlink を作る。`new` しない
- **見つからない** — 下の «依頼が既存のチケットを名指ししていたら» を先に確かめる。名指しが無ければ、次の順で作る。順は `pdh-ticket-write`「start の前に commit する」と `pdh-open` の «入力» に揃える
  1. `bash ticket.sh new "issue-${ISSUE_NUMBER}" --created-at "$TS" --branch "$BRANCH"`
  2. `pdh-ticket-write` に従って ticket と note を埋め（Why / What + Acceptance Criteria / Architectural-Invariants-check / Design-Decisions / Out-of-scope を Issue・`product-brief.md` から）、その «出力» を確かめる
  3. note の Status を `PDH-open` にして、ticket・note・`progress.md` を `agent/issue-N` に commit する
  4. `bash ticket.sh start "$TICKET_NAME"`（`started_at` を入れて commit し、symlink を作り、`Active ticket paths:` を出す）。以後は `pdh-open` から続ける

  ⚠ **Status が `PDH-ticket-write` のまま `start` しない。**`pdh-open` の例外に当たり、PDH-ticket-write へ戻ることになる。

## 依頼が既存のチケットを名指ししていたら、新しく作らずそれを使う

**この規則の目的: 1 つの仕事に、チケットが 1 つだけあること。**

リポジトリには、Issue を経ずに先に起票されたチケットが溜まる。上の find-or-create が探すのは
今の branch を `branch:` に持つ ticket と `issue-<N>` という名前だけなので、**まだ引き継いでいない別名のチケットは見えない。**そのまま
`new` すると、1 つの仕事が 2 つの名前を持ち、**どちらが本物か誰にも決められなくなる。**

Issue 本文または起動した 🤖 コメントが `tickets/<名前>/` か `YYMMDD-hhmmss-<slug>` の形の
チケット名を含み、**そのチケットが `tickets/` 直下に在るなら、`ticket.sh new` を実行しない。**

```bash
# 依頼の文から名前を拾う（本文と起動コメントの両方を見る）
NAMED=$(printf '%s\n' "$ISSUE_BODY" "$COMMENT_BODY" \
  | grep -oE '[0-9]{6}-[0-9]{6}-[a-z0-9][a-z0-9-]*' | sort -u)
COUNT=$(printf '%s\n' "$NAMED" | grep -c . || true)
```

- **1 つだけ在る場合** — そのチケットを使う。`branch:` を bot の branch へ向けてから `start` する。
  ```bash
  TICKET_NAME="$NAMED"
  # frontmatter に branch: を書く（既に在れば書き換える）
  f="tickets/$TICKET_NAME/ticket.md"
  if grep -q '^branch:' "$f"; then
    sed -i.bak -E "s#^branch:.*#branch: agent/issue-${ISSUE_NUMBER}#" "$f" && rm -f "$f.bak"
  else
    sed -i.bak -E "s#^(priority:.*)#\1\nbranch: agent/issue-${ISSUE_NUMBER}#" "$f" && rm -f "$f.bak"
  fi
  git add tickets && git commit -m "ticket: adopt $TICKET_NAME for issue #${ISSUE_NUMBER}"
  bash ticket.sh start "$TICKET_NAME"
  ```
  以後 `restore` / `check` / `close` はその branch でチケットを解決する。

- ⚠ **名前が 2 つ以上あるとき** — どれを使うか Issue で聞いて止まる。**選ばない。**
- ⚠ **`tickets/done/` のものを名指ししているとき** — 使わない。**閉じた仕事である。**
  その旨を Issue に書いて、`issue-<N>` で新しく作る。
- ⚠ **名前が在るのにファイルが無いとき** — 打ち間違いとして扱い、Issue で聞いて止まる。

**使ったチケットは、その Issue のものとして最後まで扱う。**close も `tickets/done/` への移動も
通常どおりで、`issue-<N>` という名前のチケットは作らない。

**引き継いだチケットの作り方の判断と AC は、下書きとして扱う。**この規則の目的: 承認へ進む作り方の判断が今のコードで成り立ち、
前に調べたことをそのまま使えること。

- 書き直す前に、`[TICKET_DIR]/ticket.md` に加えて `[TICKET_DIR]/note.md`（`## PDH-ticket-review. Ticket contract check`・
  `## Required-Probes`・`## Open-Questions`）と `[TICKET_DIR]/progress.md`（実装ログ・調べて分かったこと・次に何から始めるか）を全部読む。そこにある実測と判断は、確かめ直す
  対象であって、捨てる対象ではない
- 課題（Why）は依頼者のものなので、そのまま使う。作り方の判断・AC・前提は、今のコードと実測で
  確かめ直し、成り立つものは残し、成り立たないものだけ直す。⚠ **一から組み直さない**
- 何を残し、何をなぜ直したかを `progress.md` に 1 行ずつ書く。decision-board の «作り方の判断» の節
  （選ばなかった案を含む）にも、元の作り方の判断から変えた点を出す — 承認者が、前の案との違いを見て決められるように
- 守れたかを数える仕組みは置けない（読んだかどうかは repo に残らない）。`progress.md` の «残した・直した» の
  行が無ければ、reviewer はそれを欠落として finding に出す

経緯は `progress.md` へ追記し、note は現在値だけにする（`[SKILLS_PATH]/pdh-pm/_records.md`「ticket / note / progress の役割分担」）。`progress.md` が無い ticket は、PDH-stage の入口で作る（`pdh-pm`「入る前に」）。`started_at` は `start` が、`closed_at` は `close` が入れる。手で書かない。

## チェックリストの検査と close
- **checklist の充足は `bash ticket.sh check` で確認する。**required グループ（`require_checklist_groups`）、未了 checkbox、`append_only_files` の欠落行を出す。ticket は `branch:` を持つので同期判定も通る。
- **close 段階（`merge` / `pr` は close 承認後）** は `.ticket-config.yaml` の `github_bot.close` で分岐する。⚠ **`pr-merge` では «close 承認» は PR の merge であり、bot は承認を待たずに PR を作って停止する:**
  - **`merge`（既定）**: bot が `bash ticket.sh close --no-delete-remote` を実行する（squash merge → default branch へ push、ticket は `tickets/done/` へ）。続けて `gh issue close #N`。**1 run で終わり、PR は作らない。**
    ⚠ **`--no-delete-remote` を外してはならない。**`run-action.sh` は engine が止まったあとにも `HEAD:$BRANCH_NAME` へ push する経路を持つ（画像の後始末・待ち行の反映）。`close` が branch を消しても**その push が作り直す**ので、残るのは «PR を持たず default branch にも無い commit を載せた branch» — 消したせいで置き去りの branch を作ることになる。
    ⚠ **その結果 `merge` では branch が溜まり続ける。**安全に消せる場所は `run-action.sh` の最後の push より後しかなく、そこにはいま何も無い（`pr` / `pr-merge` は run の外で `coding-bot-finalize.yml` が消す）。
  - **`pr`**: issue の close 承認後、bot が `bash ticket.sh close --no-merge "$TICKET_NAME"` で done へ移し、その commit を含む PR（`github_bot.pr_link` が `refs` なら `Refs #N`、`closes` なら `Closes #N`）を作り、«merge したら 🤖 で issue を閉じます» と伝えて**停止する**。人間が merge → 次の 🤖 で `gh issue close #N`。
  - ⚠ **`pr-merge`**: 下の「PR に載せて出す」に従う。
  - チェックリストの検査（`require_checklist` / `require_checklist_groups` / `append_only_files`）と `pre_close_command` は **3 モードとも `close` が行う**。⚠ **`pr-merge` では `close --no-merge` が feature branch 上で走るので、そこで効く。**

## `pr-merge`: done への移動を PR に載せて出す

**この節は `.ticket-config.yaml` の `github_bot.close: pr-merge` を選んだときだけ適用する。**
**この規則の目的: default branch 上で ticket が `tickets/done/` にあれば、人が merge したと言えること。**
bot と workflow は default branch へ push しない。done 移動と `closed_at` は PR 自身に載せる。
PDH-verify を終えたら、次の順で行う。既存 PR があればそれを更新する。

0. **コメントは `GITHUB_TOKEN` で投稿する。**（`merge` / `pr` では push も PR 作成も `origin` のまま＝runner の `GITHUB_TOKEN` で行う。token を選び分けるのはこの `pr-merge` だけである）`GH_TOKEN` に PAT を export しない。
   bot 名義と `<!-- coding-bot -->` の印で自己トリガーを防ぐ。
   `CODING_BOT_GH_PAT` があれば、**runner が origin の git 認証を agent の起動前にこの token へ
   差し替えてある。**push は素の `git push origin` でよい。⚠ **origin の認証設定
   （`http.https://github.com/.extraheader`）を外したり戻したりしない** — `GITHUB_TOKEN` に戻すと、
   以降の push が起こす CI が «Approve and run» 待ちで止まる。runner の後処理も PAT で push する。
   PR 作成は同じ token をそのコマンドだけに渡す。添付ファイルの取得には runner がこの token を使う。
   無ければ `GITHUB_TOKEN` へ fallback し、CI の «Approve and run» が追加で必要な場合は人へ伝える。
   ```bash
   git_push() { git push origin "$@"; }
   PR_TOKEN="${CODING_BOT_GH_PAT:-$GITHUB_TOKEN}"
   ```
1. **base branch を取り込んで push する。**CI の緑を現在の base を含む SHA に紐づける。
   ```bash
   BASE="${GITHUB_BASE_REF:-$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)}"
   git fetch origin "$BASE" && git merge "origin/$BASE" --no-edit && git_push "HEAD:$BRANCH_NAME"
   ```
   required check が `strict: false` なら古い base の緑でも merge できる。衝突を解決してから進む。
2. **PR を draft で作る。**既に ready の PR を修正する場合も、最後の push まで draft に戻す。
   ```bash
   GH_TOKEN="$PR_TOKEN" gh pr create --draft --base "$BASE" --head "$BRANCH_NAME" --title … --body "… Refs #N"
   # 既存 PR の場合: GH_TOKEN="$PR_TOKEN" gh pr ready --undo "$BRANCH_NAME"
   ```
   **PDH-human-review の decision-board は issue にコメントする。**末尾に `<!-- coding-bot -->` を置く。PR の案内と完成報告へのリンクは runner が 1 通の `<!-- coding-bot:pr-guide -->` コメントを更新して置くので、手で重ねて投稿しない。
   `pr-merge` は `github_bot.pr_link` に関わらず `Refs #N` を使う。`Closes` / `Fixes` で
   Issue を先に閉じると finalize の検査を飛ばしてしまう。
3. **done へ移す commit を push してから PR を ready にする。**
   close の前に、note の Checklist にある PDH-human-review の承認待ちの行（何の承認を待つかと `発行先:` を持つ行）を次の形に書き換えて commit する。
   この規則の目的: done への移動を PR に載せても、受けていない承認を受けたことにしないこと。
   ```
   - [-] <何の承認を待つか> 発行先: <issue の完成報告コメントの URL> - skip: close の承認は PR の merge で受ける
   ```
   - `[ ]` のままだと、`require_checklist` が close を拒む。`[x]` にすると、受けていない承認を受けたことになる
   - `.ticket-config.yaml` の `github_bot.close` が `pr-merge` のときだけ、`scripts/check-pdh-ticket.sh` はこの `[-]` の行を承認待ちの行として数える
   - ⚠ **note の Status は `PDH-human-review` のまま進めない。**承認の行を `[x]` にしない。承認は人の merge であり、bot は merge より前の run で終わる
   ```bash
   bash ticket.sh close --no-merge --no-push "$TICKET_NAME"
   git_push "HEAD:$BRANCH_NAME"
   local_head=$(git rev-parse HEAD)
   for i in $(seq 1 30); do
     pr_head=$(GH_TOKEN="$PR_TOKEN" gh pr view "$BRANCH_NAME" --json headRefOid -q .headRefOid 2>/dev/null || true)
     [ "$pr_head" = "$local_head" ] && break
     sleep 2
   done
   [ "$pr_head" = "$local_head" ] || {
     echo "PR head が最終 SHA に追いつかないため ready にせず停止する。"
     exit 1
   }
   GH_TOKEN="$PR_TOKEN" gh pr ready "$BRANCH_NAME"
   ```
   ⚠ **`close --no-merge` を PR より前に置かないこと。**承認待ちの行の `発行先:` には issue の完成報告コメントの URL を書く。
   `require_checklist` / `require_checklist_groups` / `append_only_files` と `pre_close_command` はこの
   close が検査する。先に検査するなら `--dry-run` を使う。
   **未了なら tree に触れず停止する。**何が未了かを issue にコメントし、draft のまま残す。
   `closed_at` は close を実行した時刻。merge の時刻は PR の `merged_at` に残る。
   承認待ちの行のほかにも、merge の後でなければ満たせない行（close の承認の答えが progress にある、など）は
   `- [-] … - skip: close の承認は PR の merge で受ける` とし、消さない。
   ⚠ **progress に PDH-close への遷移の行は書かない。**PDH-close に入るのは人の merge の後で、
   そのとき動く `coding-bot-finalize.yml` は commit も push もしない。merge の前に書くと、まだ起きていない遷移を記録することになる。
   PDH-close に入ったことは、default branch で ticket が `tickets/done/` にあることと、stage ラベル `PDH-close` が示す。
   **draft 中のフルスイートを skip し、`ready_for_review` で実行する CI を設定した repo では、**
   この順序で done 移動を含む最終 SHA に 1 回だけ実行できる。push 直後は PR head の反映が
   遅れることがあるため、上の一致確認を省かない。ready を先にすると旧 SHA と新 SHA の
   2 本が走り、close が止まったときは旧 SHA の run だけが残る。
   **したがって PDH-verify の時点では、最終 SHA のフルスイートはまだ走っていない。**PDH-verify の
   «`scripts/test-all.sh` の結果が progress にある» の行には、結果の代わりに次の 3 つを progress に書く
   （`[SKILLS_PATH]/pdh-verify/SKILL.md`「出力」）。⚠ **まだ走っていない run を成功と書かない。**
   - 委ねた先: ready にしたときに走る workflow の名前（`.github/workflows/` の `name:`）
   - 対象の SHA: verify した HEAD の SHA。PR head はこれに done 移動の commit を足したものになる
   - merge を止める必須のチェックの名前: base branch の保護設定（`gh api repos/<owner>/<repo>/branches/<base>/protection/required_status_checks`）
     から読む。読めなければ、読めなかったことと理由を書く
4. **最終コメントは見出しの直後に PR リンクと次の操作を置く。**PR メタデータ marker は出さない。
   **issue / PR の run が PR を作る・更新する・ready にしたら、そこで終わる。
   自分の push の CI の完了を待たない。その CI の結果をコメントや最終報告に書かない。
   push 後の CI の結果は CI autofix だけが伝える。**
   «PR の CI が緑になったら Merge を 1 回押してください» と伝える。branch protection が
   承認レビューも要求する場合は、その必要な操作を併記する。途中停止で draft が残った場合は
   Ready for review も必要であり、成功時の «人が押す回数 = 1» とは区別する。
   **その Merge が何を起こすかと、違ったときの戻し方も 1 行ずつ書く。**default branch への
   merge がデプロイを起こす repo なら、出荷でもあることと revert の経路を伝える。
5. 人が merge すると `coding-bot-finalize.yml` が done 移動を検査して **Issue を閉じる**。
   frontmatter の `branch:` / `issue:` または既存の issue 番号つきディレクトリ名で対応を確認する。
   移動が無ければ閉じずに警告する。commit / push はせず、stage ラベルを `PDH-close` に付け替え、merge 済みの `agent/issue-<N>` branch を消す。

## `pr-merge`: CI は PR 側の run だけが gate である（bot は回さない）

**この節は `pr-merge` 用である。`merge` / `pr` の検証は `CLAUDE.md` が定める通常の手順に従う。**
人が Merge を押すとき、PR の必須チェックが最終 SHA の `pull_request` run によって満たされていることを確認する。
issue / PR の run は自分の push の CI の完了を待たない。その CI の結果を報告しない
（`system.md`「CI reporting ownership」）。
`gh workflow run` の成功だけを merge 可能の証拠にしない。bot は同じフルスイートを自分でも
回さず、PR 側の run に任せる。失敗を直す scoped test は実行する。
`CODING_BOT_GH_PAT` があれば push と PR 作成に使い、CI の承認待ちを避ける。
**成功時に人が押す回数 = 1** を目指す。token が無い場合や保護設定で別の操作が要る場合は
その操作を明示する。導入時の CI・保護設定は `github-bot/INSTALL.md` を参照する。

### CI が赤いとき、«関係なし» は結論として書かない

この節は CI autofix と、issue / PR の run が CI の失敗を扱う場合の診断に適用する。
人が 🤖 で CI の確認・修正を依頼したとき、または CI 自動修正の run のときは、
失敗ログを読んで回答・修正してよい。診断・修正内容・scoped test は報告するが、
自分の push の CI の完了を待たない。その CI の結果は CI autofix だけが伝える。

**この規則の目的: 読み手が、«この失敗は自分の差分のせいではない» という判断を確かめられる形で受け取れること。**

`.claude/agents/pdh-qa.md`「結果の貼り方」が定めているのは 1 つ — **失敗は無関係だと断言することは免責にならない。**
免責できるのは、**同じ step を base ref で実行して、そこでも落ちることを示したとき**だけである。

したがって報告には、次の 3 つのどれかだけを書く。**「関係なし」という語で終わらせない。**

1. **base でも落ちた** — その出力を貼る。免責になる
2. **base では通った** — 自分の差分のせいである。直す
3. ⚠ **確かめられなかった** — **そう書く。**推測の根拠（触っていない route である・時刻が違う・別 server である）は
   **添えてよいが、それは 3 の中身であって 1 の代わりにはならない**

⚠ **不安定な失敗では 1 も 2 も決まらない。**budget 超過・timeout・`flaky: N` が併記された失敗は、
**base で 1 回通っても «無関係» の証明にならない**（同じ不安定さが base でもたまたま出なかっただけかもしれない）。
この場合は **base と head で同じ回数ずつ実行して比べ、結果を 1 か 2 として書く。**時間はかかっても、決まった結果のほうが人の判断を減らす（`PDH-AGENTS.md`「変更のコストの数え方」）。
run の残り時間（`DEADLINE_UNIX`）で回しきれないときだけ、**3 を選び、«不安定なので 1 回の再現では決まらず、回数を揃えて比べる時間が run に残っていなかった» と書いて人に上げる。**

**どの場合も «再実行して偶然 green を得る» を選ばない。**緑が出ても、それは失敗が消えた証拠ではない。

## worker spawn（team 実行）

⚠ **worker が «作業と無関係な理由» で落ちたら、1 回だけやり直す。**

- **やり直してよいのは «作業と無関係な落ち方» だけ** — 起動失敗・TERM・容量エラー・一時的な
  API エラー。⚠ **prompt や仕様の誤りで落ちたものはやり直さない**（2 回とも同じに落ちる）
- ⚠ **1 回だけ。**2 回目も落ちたら人に返す
- ⚠ **やり直した事実と回数を、最終レポートに必ず書く。**書かないと «失敗が消える»。
  «QA worker が TERM で落ちたので 1 回やり直し、2 回目は通った» のように 1 行
- ⚠ **run 全体はやり直さない。**落ちた worker だけをやり直す

**あなたは PM として、team 実行（worker を spawn する形）の手順を進める。** worker（Coding Engineer / reviewer / AC 裏取り 等）は **CLI subprocess で spawn** する（`[SKILLS_PATH]/pdh-pm/_execution-team.md`「spawn 機構」）。
- **PM の engine** = `CODING_BOT_ENGINE`（この run の engine）。worker に割り当てる engine は `[SKILLS_PATH]/pdh-pm/_execution-team.md`「エンジン割り当て」に従う（既定では実装と review を別の engine にする。engine が 1 つしか無いときの扱いもそこにある）。起動コマンド（claude / codex、**bypass 権限**）と並行起動・結果回収は `[SKILLS_PATH]/pdh-pm/_execution-team.md` に self-contained に書いてある。**それをそのまま使う**。
- 各 worker は専用 result ファイルに書かせ、統合する。認証は run の環境変数を subprocess が継承する（追加設定不要）。
- **spawn は必須。** 失敗/不可能な場合（CLI 不在・auth 不在・exit 非ゼロ）は **単独で続行しない**。`wait` 後に `rc=$?` を保存し、note に「何の spawn が・どう失敗したか（コマンド・rc、result/stderr の `ls -l`、`tail -120 stderr.log`）」を書いてエラー報告する（reviewer の review 無しで PR を出さない）。
  ⚠ **rc と stderr の中身は note に置き、コメントには出さない**（`system.md`「Worker rc lists … do not go in the issue at all」）。コメントに書くのは «何が動かず、そのせいで何が終わっていないか» を言葉で。

## GitHub Issue プロトコル（承認・進捗・PR）
issue とのやり取りは、同じディレクトリの **`_github-issue.md`** に従う。⚠ **あれはこの prompt の末尾に連結済みである**（`run-action.sh` が `_pdh.md` と同じ条件で append する）。Read は要らない。次の 2 つは PDH mode の契約なので、ここにも置く:

- **承認の PDH-stage では自己承認しない。** `PDH-ticket-human-review` と `PDH-human-review` に達したら、Actions には対話できる人間がいないので、**承認してほしいことの要点を decision-board（`_github-issue.md`）として issue にコメントし、note の Checklist に待ち行を書いて run を停止**する。承認は **🤖 を含むコメント**（例「🤖 承認」。Actions は reaction では起動しないので 👍 だけでは再開しない）、変更希望は 🤖 付きで返信。⚠ **ただし PDH-human-review は除く** — `github_bot.close` が `pr-merge` のときは **PR の merge そのものが close 承認**であり、承認語を求めない（この `_pdh.md` の「チェックリストの検査と close」を参照）。«よしなに» で先へ進まない。
- **close は `github_bot.close` の設定に従う**（`merge`: `ticket.sh close` で squash merge して issue を閉じる。`pr`: PR の紐付けは `github_bot.pr_link` に従う。`pr-merge`: PR は `Refs #N`。⚠ **`pr-merge` では merge が close の承認であり、done への移動は PR の差分に載せる**。下の「`pr-merge`: done への移動を PR に載せて出す」に従う）。

## 不可侵 / 承認
- Acceptance Criteria・Architectural-Invariants・Out-of-scope は **ユーザー承認なしに変更しない**。
- `product-brief.md` を編集する場合は内容を提示して承認を得る。
