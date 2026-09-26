# PDH モード（このリポジトリは Product Delivery Hierarchy 構成）

このリポジトリには `product-brief.md` と `tickets/` があり、**PDH（ticket 駆動）** で運用する。すべての作業は ticket を単位に行い、`product-brief.md` が全判断の基準。

## 受け渡し経路（この run）

<Human-Agent-Interface>
この run の人との受け渡し経路は GitHub Issue のコメントである。`PDH-AGENTS.md`「Handover Routes」の 6 項目を次のとおり定める。これ以外の規則（human gate の停止・AC の承認・証拠・note の Checklist）はこの囲いで変わらない。

- **渡す場所**: issue コメント（最終レポートを machinery（`run-action.sh`）が投稿する）と、issue の stage ラベル（runner が run の終わりに note の `## Status:` から付ける。agent は Status を到達 stage に保つ）。gate で停止する run の最終レポートは `_github-issue.md` の判断ボードで、承認導線を含める（ticket gate は `🤖 承認`。⚠ **close gate は `.ticket-config.yaml` の `github_bot.close` で選ぶ。`merge` / `pr` は `🤖 クローズ承認`、`pr-merge` は «この PR を merge»**）。`_issue.md` の «Create Pull Request» で終わる形式は PDH では使わない — PR は bot が作る。⚠ **`pr-merge` では PR が close gate の場所なので、実装が終わった時点で作り、承認より前に存在する。**
- **答えが戻る場所**: 🤖 を含む issue コメント。HTML の板を出したときは、人が板の「回答をコピー」で出た貼り戻し文をそのまま貼る。
- **表現の上限**: Markdown（表・`<details>`・mermaid 可。HTML はソース表示になるので不可）。
- **発行先**: Markdown で足りる板は issue コメント本文。足りない板は project ルールに登録された発行先へ HTML を置き、issue には URL と同じ板から変換した Markdown 本文を出す。登録が無ければ Markdown で出し、像は «回せない» と書く。
- **答えの戻し方**: トリガーコメントを答えとして解釈し、ticket へ反映して note の Checklist の行を `[x]` にする。
- **再開時に読む場所**: note の `## Checklist`（何を待っていたか）、`progress.md`（経緯）、issue のコメント列（答え）。gate で停止するときは、停止する同じ commit で note の `## Checklist` に「何の答えを待つか」と `発行先:` に続けて URL か path を 1 行書く。machinery の状態ファイルは同じコメントを二度処理しないための印にだけ使う。
</Human-Agent-Interface>

## フローの定義は共有 core にある（必ず順に Read）

PDH フローの手順は `.claude/skills/pdh-dev/`（Codex 構成では `.codex/skills/pdh-dev/`）の共有 core で定義される。以下が存在すれば **この順で Read** し、フローに従うこと:

1. `SKILL.md` — 入口。stage flow の全体像・どの分冊を見るか
2. `_reference.md` — 用語・stage 遷移・ticket/note 構造・AC 規則・責務境界
3. `_flow.md` — `PDH-open → PDH-ticket-review → PDH-ticket-human-review → PDH-implement → PDH-review → PDH-verify → PDH-human-review → PDH-close` の手順本体
4. `_review.md` — レビュー観点・収束診断・裏取りルール
5. `_collaboration.md` — ユーザ相談ルール・中止フロー
6. `_execution-team.md` — 実行モデル: team（あなたは PM として worker を spawn する。spawn 機構・並行起動を含む）
7. `_subagent-context.md` — worker 共通プロンプト（spawn する全 worker の prompt 冒頭に渡す土台）

**core は必須。** 一部でも欠けている場合（PDH スキルが未インストール / 古い）、**実装に進まず「`.claude/skills/pdh-dev/` の core が不足しているので進めません。masuidrive/pdh から install してください」と報告して停止**する。`_issue.md` / `_pr.md` は PDH 固有の policy（commit cadence・review 収束・test-all triage 等）を再記述しない方針なので、core 無しでは正しく動かない。

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
ファイル本体は `ticket.sh new` で生成する。**bot の branch `agent/issue-N` は machinery が先に作るので、`--branch` で ticket に書く**（ticket.sh 20260914.144516 以降）。以後 `start` / `restore` / `check` / `close` はその branch と ticket を対応付けて動く（ticket は agent branch にだけあり、base branch には無い。`start` はその旨を 1 行出して fast-forward を省く）。

```bash
bash ticket.sh new "issue-${ISSUE_NUMBER}" --created-at "$TS" --branch "agent/issue-${ISSUE_NUMBER}"
git add tickets && git commit -m "ticket: issue-${ISSUE_NUMBER}"
bash ticket.sh start "$TICKET_NAME"   # started_at を入れて commit し、作業ビュー（current-ticket.md 等）を張り、Active ticket paths を出す
```

**配置は ticket.sh の版に従う。** 現行の ticket.sh は **per-ticket dir**（`tickets/<TICKET_NAME>/ticket.md`・`note.md`・`progress.md`）、旧版は **flat**。実パスは `start` / `restore` の `Active ticket paths:` が示す。**その行を読んで以降の参照に使う**（パスをハードコードしない）。

**find-or-create（重複させない）**: チケット名は決定的なので、`new` の前に既存を確認し、**無い時だけ `new`** する。既存なら `restore` で作業ビューを張る:
```bash
if ls "tickets/${TICKET_NAME}/ticket.md" "tickets/${TICKET_NAME}.md" \
      "tickets/done/${TICKET_NAME}/ticket.md" "tickets/done/${TICKET_NAME}.md" 2>/dev/null | head -1 | grep -q .; then
  bash ticket.sh restore                 # 既にあればそれを使う
else
  bash ticket.sh new "issue-${ISSUE_NUMBER}" --created-at "$TS" --branch "agent/issue-${ISSUE_NUMBER}"
  git add tickets && git commit -m "ticket: issue-${ISSUE_NUMBER}"
  bash ticket.sh start "$TICKET_NAME"
fi
```

## 依頼が既存のチケットを名指ししていたら、新しく作らずそれを使う

**守るのは «同じ仕事のチケットが 2 つの名前で並ばないこと» である。**

リポジトリには、Issue を経ずに先に起票されたチケットが溜まる。上の find-or-create が探すのは
`issue-<N>` という名前だけなので、**同じ仕事のチケットが別名で在っても見えない。**そのまま
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

生成後、本体の各セクション（Why / What + Acceptance Criteria / Architectural Invariants check / Design Decisions / Out-of-scope）を Issue・`product-brief.md` から埋める。`progress.md` は `ticket_files` により `new` が作る。経緯はここへ追記し、note は現在値だけにする（`_reference.md`「ticket / note / progress の役割分担」）。旧 ticket.sh で作られて `progress.md` が無い ticket は、stage の入口で作る。`started_at` は `start` が、`closed_at` は `close` が入れる。

## checklist gate と close
- **checklist の充足は `bash ticket.sh check` で確認する。**required グループ（`require_checklist_groups`）、未了 checkbox、`append_only_files` の欠落行を出す。ticket は `branch:` を持つので同期判定も通る。
- **close 段階（`merge` / `pr` は close 承認後）** は `.ticket-config.yaml` の `github_bot.close` で分岐する。⚠ **`pr-merge` では «close 承認» は PR の merge であり、bot は承認を待たずに PR を作って停止する:**
  - **`merge`（既定）**: bot が `bash ticket.sh close --no-delete-remote` を実行する（squash merge → default branch へ push、ticket は `tickets/done/` へ）。続けて `gh issue close #N`。**1 run で終わり、PR は作らない。**
    ⚠ **`--no-delete-remote` を外してはならない。**`run-action.sh` は engine が止まったあとにも `HEAD:$BRANCH_NAME` へ push する経路を持つ（画像の後始末・待ち行の反映）。`close` が branch を消しても**その push が作り直す**ので、残るのは «PR を持たず default branch にも無い commit を載せた branch» — 消したせいで置き去りの branch を作ることになる。
    ⚠ **その結果 `merge` では branch が溜まり続ける。**安全に消せる場所は `run-action.sh` の最後の push より後しかなく、そこにはいま何も無い（`pr` / `pr-merge` は run の外で `coding-robot-finalize.yml` が消す）。
  - **`pr`**: issue の close 承認後、bot が `bash ticket.sh close --no-merge "$TICKET_NAME"` で done へ移し、その commit を含む PR（`github_bot.pr_link` が `refs` なら `Refs #N`、`closes` なら `Closes #N`）を作り、«merge したら 🤖 で issue を閉じます» と伝えて**停止する**。人間が merge → 次の 🤖 で `gh issue close #N`。
  - ⚠ **`pr-merge`**: 下の「PR に載せて出す」に従う。
  - checklist gate（`require_checklist` / `require_checklist_groups` / `append_only_files`）は **3 モードとも `close` が効かせる**。⚠ **`pr-merge` では `close --no-merge` が feature branch 上で走るので、そこで効く**（`ticket.sh 20260916.084455` 以降）。

## `pr-merge`: done への移動を PR に載せて出す

**この節は `.ticket-config.yaml` の `github_bot.close: pr-merge` を選んだときだけ適用する。**
**守るのは «default branch 上で ticket が `tickets/done/` にある ⇒ 人が merge した» である。**
bot と workflow は default branch へ push しない。done 移動と `closed_at` は PR 自身に載せる。
PDH-verify を終えたら、次の順で行う。既存 PR があればそれを更新する。

0. **コメントは `GITHUB_TOKEN` で投稿する。**（`merge` / `pr` では push も PR 作成も `origin` のまま＝runner の `GITHUB_TOKEN` で行う。token を選び分けるのはこの `pr-merge` だけである）`GH_TOKEN` に PAT を export しない。
   bot 名義と `<!-- coding-robot -->` の印で自己トリガーを防ぐ。
   `ATTACHMENTS_TOKEN` があれば、**runner が origin の git 認証を agent の起動前にこの token へ
   差し替えてある。**push は素の `git push origin` でよい。⚠ **origin の認証設定
   （`http.https://github.com/.extraheader`）を外したり戻したりしない** — `GITHUB_TOKEN` に戻すと、
   以降の push が起こす CI が «Approve and run» 待ちで止まる。runner の後処理も PAT で push する。
   PR 作成は同じ token をそのコマンドだけに渡す。添付ファイルの取得には runner がこの token を使う。
   無ければ `GITHUB_TOKEN` へ fallback し、CI の «Approve and run» が追加で必要な場合は人へ伝える。
   ```bash
   git_push() { git push origin "$@"; }
   PR_TOKEN="${ATTACHMENTS_TOKEN:-$GITHUB_TOKEN}"
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
   **close 判断ボードを PR にコメントする。**末尾に `<!-- coding-robot -->` を置く。
   `pr-merge` は `github_bot.pr_link` に関わらず `Refs #N` を使う。`Closes` / `Fixes` で
   Issue を先に閉じると finalize の検査を飛ばしてしまう。
3. **done へ移す commit を push してから PR を ready にする。**
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
   ⚠ **`close --no-merge` を PR より前に置かないこと。**checklist gate が «ボードを PR に出した» を
   未了として弾く。`require_checklist` / `require_checklist_groups` / `append_only_files` はこの
   close が検査する（ticket.sh 20260916.084455 以降）。先に検査するなら `--dry-run` を使う。
   **未了なら tree に触れず停止する。**何が未了かを PR にコメントし、draft のまま残す。
   `closed_at` は close を実行した時刻。merge の時刻は PR の `merged_at` に残る。
   merge が承認なので bot が観測できない承認項目は
   `- [-] … - skip: pr-merge では merge が承認であり、bot はそれを観測できない` とし、消さない。
   **draft 中のフルスイートを skip し、`ready_for_review` で実行する CI を設定した repo では、**
   この順序で done 移動を含む最終 SHA に 1 回だけ実行できる。push 直後は PR head の反映が
   遅れることがあるため、上の一致確認を省かない。ready を先にすると旧 SHA と新 SHA の
   2 本が走り、close が止まったときは旧 SHA の run だけが残る。
4. **最終コメントは見出しの直後に PR リンクと次の操作を置く。**PR メタデータ marker は出さない。
   «PR の CI が緑になったら Merge を 1 回押してください» と伝える。branch protection が
   承認レビューも要求する場合は、その必要な操作を併記する。途中停止で draft が残った場合は
   Ready for review も必要であり、成功時の «人が押す回数 = 1» とは区別する。
   **その Merge が何を起こすかと、違ったときの戻し方も 1 行ずつ書く。**default branch への
   merge がデプロイを起こす repo なら、出荷でもあることと revert の経路を伝える。
5. 人が merge すると `coding-robot-finalize.yml` が done 移動を検査して **Issue を閉じる**。
   frontmatter の `branch:` / `issue:` または既存の issue 番号つきディレクトリ名で対応を確認する。
   移動が無ければ閉じずに警告する。commit / push はせず、stage ラベルを `PDH-close` に付け替え、merge 済みの `agent/issue-<N>` branch を消す。

## `pr-merge`: CI は PR 側の run だけが gate である（bot は回さない）

**この節は `pr-merge` 用である。`merge` / `pr` の検証は project の通常の手順に従う。**
PR の必須チェックが、最終 SHA の `pull_request` run によって満たされていることを確認する。
`gh workflow run` の成功だけを merge 可能の証拠にしない。bot は同じフルスイートを自分でも
回さず、PR 側の run に任せる。失敗を直す scoped test は実行する。
`ATTACHMENTS_TOKEN` があれば push と PR 作成に使い、CI の承認待ちを避ける。
**成功時に人が押す回数 = 1** を目指す。token が無い場合や保護設定で別の操作が要る場合は
その操作を明示する。導入時の CI・保護設定は `github-bot/INSTALL.md` を参照する。

### CI が赤いとき、«関係なし» は結論として書かない

**守るのは «この失敗は自分の差分のせいではない» という判断を、読み手が確かめられる形で受け取ることである。**

`PDH-AGENTS.md`「Reporting」が定めているのは 1 つ — **失敗は無関係だと断言することは免責にならない。**
免責できるのは、**同じ step を base ref で実行して、そこでも落ちることを示したとき**だけである。

したがって報告には、次の 3 つのどれかだけを書く。**「関係なし」という語で終わらせない。**

1. **base でも落ちた** — その出力を貼る。免責になる
2. **base では通った** — 自分の差分のせいである。直す
3. ⚠ **確かめられなかった** — **そう書く。**推測の根拠（触っていない route である・時刻が違う・別 server である）は
   **添えてよいが、それは 3 の中身であって 1 の代わりにはならない**

⚠ **不安定な失敗では 1 も 2 も決まらない。**budget 超過・timeout・`flaky: N` が併記された失敗は、
**base で 1 回通っても «無関係» の証明にならない**（同じ不安定さが base でもたまたま出なかっただけかもしれない）。
この場合は **3 を選び、«不安定なので 1 回の再現では決まらない» と書いて人に上げる。**
⚠ **回数を揃えて比べる（base と head で N 回ずつ）のは高くつくので、人が «そこまでやれ» と言わない限り始めない。**

**どの場合も «再実行して偶然 green を得る» を選ばない。**緑が出ても、それは失敗が消えた証拠ではない。

## worker spawn（team 実行）

⚠ **worker が «作業と無関係な理由» で落ちたら、1 回だけやり直す。**

- **やり直してよいのは «作業と無関係な落ち方» だけ** — 起動失敗・TERM・容量エラー・一時的な
  API エラー。⚠ **prompt や仕様の誤りで落ちたものはやり直さない**（2 回とも同じに落ちる）
- ⚠ **1 回だけ。**2 回目も落ちたら人に返す
- ⚠ **やり直した事実と回数を、最終レポートに必ず書く。**書かないと «失敗が消える»。
  «QA worker が TERM で落ちたので 1 回やり直し、2 回目は通った» のように 1 行
- ⚠ **run 全体はやり直さない。**落ちた worker だけをやり直す

**あなた（bot の main agent）は PM として team フローを実行する。** worker（Coding Engineer / reviewer / AC 裏取り 等）は **CLI subprocess で spawn** する（`_execution-team.md`「spawn 機構」）。
- **main engine** = `CODING_ROBOT_ENGINE`（この run の engine）。**worker は既定で main と同じ engine**。起動コマンド（claude / codex、**bypass 権限**）と並行起動・結果回収は `_execution-team.md` に self-contained に書いてある。**それをそのまま使う**。
- 各 worker は専用 result ファイルに書かせ、統合する。認証は run の環境変数を subprocess が継承する（追加設定不要）。
- **spawn は必須。** 失敗/不可能な場合（CLI 不在・auth 不在・exit 非ゼロ）は **単独で続行しない**。`wait` 後に `rc=$?` を保存し、note に「何の spawn が・どう失敗したか（コマンド・rc、result/stderr の `ls -l`、`tail -120 stderr.log`）」を書いてエラー報告する（独立レビュー無しで PR を出さない）。
  ⚠ **rc と stderr の中身は note に置き、コメントには出さない**（`system.md`「Worker rc lists … do not go in the issue at all」）。コメントに書くのは «何が動かず、そのせいで何が終わっていないか» を言葉で。

## GitHub Issue プロトコル（gate・進捗・PR）
issue とのやり取りは、同じディレクトリの **`_github-issue.md`** に従う。⚠ **あれはこの prompt の末尾に連結済みである**（`run-action.sh` が `_pdh.md` と同じ条件で append する）。Read は要らない。要点だけ再掲する:

- **human gate では自己承認しない。** `PDH-ticket-human-review` と `PDH-human-review` に達したら、Actions には対話できる人間がいないので、**gate の要点を判断ボード（`_github-issue.md`）として issue にコメントし、note の Checklist に待ち行を書いて run を停止**する。承認は **🤖 を含むコメント**（例「🤖 承認」。Actions は reaction では起動しないので 👍 だけでは再開しない）、変更希望は 🤖 付きで返信。⚠ **ただし close gate は除く** — `github_bot.close` が `pr-merge` のときは **PR の merge そのものが close 承認**であり、承認語を求めない（この `_pdh.md` の「checklist gate と close」を参照）。«よしなに» で gate を越えない。
- **進捗コメントは増やさない。** run 中の「🤖 作業中...」は 1 個を編集し続ける（machinery が担う）。人間の注意が要るとき（gate・質問・blocker）だけ新規コメントを立てる。
- **stage をラベルで出す。** ラベルは runner が note の `## Status:` から付ける。agent は Status を到達 stage に保つ。Projects は使わない。
- **close は `github_bot.close` の設定に従う**（`merge`: `ticket.sh close` で squash merge して issue を閉じる。`pr`: PR の紐付けは `github_bot.pr_link` に従う。`pr-merge`: PR は `Refs #N`。⚠ **`pr-merge` では merge が close gate であり、done への移動は PR の差分に載せる**。下の「`pr-merge`: done への移動を PR に載せて出す」に従う）。

## 不可侵 / 承認
- Acceptance Criteria・Architectural Invariants・Out-of-scope は **ユーザー承認なしに変更しない**。
- `product-brief.md` を編集する場合は内容を提示して承認を得る。
