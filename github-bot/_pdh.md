# PDH モード（このリポジトリは Product Delivery Hierarchy 構成）

このリポジトリには `product-brief.md` と `tickets/` があり、**PDH（ticket 駆動）** で運用する。すべての作業は ticket を単位に行い、`product-brief.md` が全判断の基準。

## 受け渡し経路（この run）

<Human-Agent-Interface>
この run の人との受け渡し経路は GitHub Issue のコメントである。`PDH-AGENTS.md`「Handover Routes」の 6 項目を次のとおり定める。これ以外の規則（human gate の停止・AC の承認・証拠・note の Checklist）はこの囲いで変わらない。

- **渡す場所**: issue コメント（最終レポートを machinery（`run-action.sh`）が投稿する）と、issue の stage ラベル（runner が run の終わりに note の `## Status:` から付ける。agent は Status を到達 stage に保つ）。gate で停止する run の最終レポートは `_github-issue.md` の判断ボードで、承認導線を含める（ticket gate は `🤖 承認`。⚠ **close gate は `github_bot.close` で変わる** — `merge` / `pr` では `🤖 クローズ承認`、`pr-merge` では «この PR を merge» であって承認語ではない）。`_issue.md` の «Create Pull Request» で終わる形式は PDH では使わない — PR は bot が作る。⚠ **`pr-merge` では PR が close gate の場所なので、実装が終わった時点で作り、承認より前に存在する。**
- **答えが戻る場所**: 🤖 を含む issue コメント。HTML の板を出したときは、人が板の「回答をコピー」で出た貼り戻し文をそのまま貼る。
- **表現の上限**: Markdown（表・`<details>`・mermaid 可。HTML はソース表示になるので不可）。
- **発行先**: Markdown で足りる板は issue コメント本文。足りない板は project ルールに登録された発行先へ HTML を置き、issue には決定サマリーと URL だけを書く。登録が無ければ Markdown で出し、像は «回せない» と書く。
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
  以後 `restore` / `check` / `close` はその branch でチケットを解決する（2026-09-21 に実測）。

- ⚠ **名前が 2 つ以上あるとき** — どれを使うか Issue で聞いて止まる。**選ばない。**
- ⚠ **`tickets/done/` のものを名指ししているとき** — 使わない。**閉じた仕事である。**
  その旨を Issue に書いて、`issue-<N>` で新しく作る。
- ⚠ **名前が在るのにファイルが無いとき** — 打ち間違いとして扱い、Issue で聞いて止まる。

**使ったチケットは、その Issue のものとして最後まで扱う。**close も `tickets/done/` への移動も
通常どおりで、`issue-<N>` という名前のチケットは作らない。

生成後、本体の各セクション（Why / What + Acceptance Criteria / Architectural Invariants check / Design Decisions / Out-of-scope）を Issue・`product-brief.md` から埋める。`progress.md` は `ticket_files` により `new` が作る。経緯はここへ追記し、note は現在値だけにする（`_reference.md`「ticket / note / progress の役割分担」）。旧 ticket.sh で作られて `progress.md` が無い ticket は、stage の入口で作る。`started_at` は `start` が、`closed_at` は `close` が入れる。

## checklist gate と close
- **checklist の充足は `bash ticket.sh check` で確認する。**required グループ（`require_checklist_groups`）、未了 checkbox、`append_only_files` の欠落行を出す。ticket は `branch:` を持つので同期判定も通る。
- **close 段階（PDH-close、close 承認後）** は `.ticket-config.yaml` の `github_bot.close` で分岐する:
  - **`merge`（既定）**: bot が `bash ticket.sh close --no-delete-remote` を実行する（squash merge → default branch へ push、ticket は `tickets/done/` へ）。続けて `gh issue close #N`。**1 run で終わり、PR は作らない。**
    ⚠ **`--no-delete-remote` を外してはならない。**`run-action.sh` は engine が止まったあとにも `HEAD:$BRANCH_NAME` へ push する経路を持つ（画像の後始末・待ち行の反映）。`close` が branch を消しても**その push が作り直す**ので、残るのは «PR を持たず default branch にも無い commit を載せた branch» — 消したせいで置き去りの branch を作ることになる。
    ⚠ **その結果 `merge` では branch が溜まり続ける。**安全に消せる場所は `run-action.sh` の最後の push より後しかなく、そこにはいま何も無い（`pr` / `pr-merge` は run の外で `coding-robot-finalize.yml` が消す）。
  - **`pr`**: bot が `bash ticket.sh close --no-merge "$TICKET_NAME"` で done へ移し、その commit を含む PR（`Refs #N`。`Closes` にしない）を作り、«merge したら 🤖 で issue を閉じます» と伝えて**停止する**。人間が merge → 次の 🤖 で `gh issue close #N`。
  - ⚠ **`pr-merge`**: **PR の merge そのものを close 承認にする。**手順は下の節にある。
  - checklist gate（`require_checklist` / `require_checklist_groups` / `append_only_files`）は 3 モードとも `close` が効かせる。⚠ **`pr-merge` では `close --no-merge` が feature branch 上で走るので、そこで効く**（`ticket.sh 20260916.084455` 以降）。

## `pr-merge`: done への移動を PR に載せて出す

**守るのは «default branch 上で ticket が `tickets/done/` にある ⇒ 人が merge した» である。**

⚠ **default branch へ書き込むのは、人が PR を merge することだけにする。**bot も workflow も push しない。
したがって **done への移動と `closed_at` は、merge される PR 自身に載せる。**PDH-verify を終えたら、**この順で**行う。

0. ⚠ **`ATTACHMENTS_TOKEN`（人の PAT）があれば、PR の作成と PR ブランチへの push をそれで行う。**
   `GITHUB_TOKEN` で作った PR / 押した push では、`pull_request` と `synchronize` の CI が
   **`action_required`（承認待ち）**になり、**人が «Approve and run» を押すまで走らない。**
   PAT なら作者・push 主が人になるので**自動で走り、人が押すのは Merge の 1 回だけ**になる（実測）。
   **無ければ `GITHUB_TOKEN` のままでよい** — その場合は人が «Approve and run» を 1 回多く押す。
   設定は `github-bot/INSTALL.md`。
   ```bash
   # ⚠ actions/checkout が仕込んだ Authorization を外さないと Duplicate header で落ちる
   if [ -n "${ATTACHMENTS_TOKEN:-}" ]; then
     git config --local --unset-all 'http.https://github.com/.extraheader' || true
     git_push() { git push "https://x-access-token:${ATTACHMENTS_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$@"; }
     PR_TOKEN="$ATTACHMENTS_TOKEN"
   else
     git_push() { git push origin "$@"; }
     PR_TOKEN="$GITHUB_TOKEN"
   fi
   ```
1. **base branch を取り込んで push する**:
   ```bash
   BASE="${GITHUB_BASE_REF:-$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)}"
   git fetch origin "$BASE" && git merge "origin/$BASE" --no-edit && git_push "HEAD:$BRANCH_NAME"
   ```
   ⚠ **CI の緑を «現在の base を含んだ SHA» に紐づけるため、PR より前に取り込む。**必須チェックが
   `strict: false` なら、GitHub は «古い base のまま緑» でも merge を許す — 誰も試していない
   組み合わせが default branch に入る。衝突したら解決してから進む。
2. ⚠ **PR を作る**（`Refs #N`。`Closes` にしない）:
   ```bash
   GH_TOKEN="$PR_TOKEN" gh pr create --base "$BASE" --head "$BRANCH_NAME" --title … --body "… Refs #N"
   ```
   そのうえで **close 判断ボードをその PR にコメントする。**
   ⚠ **自分で投稿するコメントの最後には、必ず `<!-- coding-robot -->` を 1 行置く。**
   この印が無いと、板の本文に説明として入っている `🤖` が `coding-robot.yml` の起動条件に当たり、
   **自分の投稿で自分が起動する**（実測 2026-09-17: 3 つの PR すべてで、板の投稿の 3 秒後に run が
   起動し、14〜24 分走って「追加変更なし」で終わった）。
   ⚠ **`ATTACHMENTS_TOKEN` で投稿すると author が人になるので、`sender.type` では弾けない。**
   印は HTML コメントなので、読む人の画面には出ない。
   ⚠ **PR メタデータ marker は出さない** — «人がリンクを押して PR を作る» 形式では、close 判断ボードを
   PR へ出す経路が無く bot が止まる。
3. ⚠ **最後に done へ移して push する**（**順序が逆にならないこと**）:
   ```bash
   bash ticket.sh close --no-merge --no-push "$TICKET_NAME"
   git_push "HEAD:$BRANCH_NAME"
   ```
   **PR の内容は作成後の push で更新される**ので、done 移動はこれで PR の差分に入る。
   ⚠ **`close --no-merge` を PR より前に置かないこと。**checklist gate が「判断ボードを PR へ出した」
   「merge 承認を反映した」を未了として弾き、**PR を作る前に必ず止まる**（2026-09-16 に実際に踏んだ）。
   ⚠ **`pr-merge` では merge が承認なので、«承認を反映した» を bot が `[x]` にできる瞬間は無い。**
   その種の項目は **`- [-] … - skip: pr-merge では merge が承認であり、bot はそれを観測できない`** と
   理由つきで落とす。**消さない** — 判断したのか落としたのかが区別できなくなる。
   ⚠ **gate が止まったら、PR は既にあるので «何が未了か» をその PR にコメントして停止する。**
   issue 側へ書くと、承認する人が見ている画面に出ない。
   ⚠ **フルスイートは自分で回さない**（理由は下の「CI は PR 側の run だけが gate である」）。
   **close 判断ボードには «CI は PR 側で自動実行中である» ことと、人がやることは
   «緑を待って Merge を 1 回押すだけ» であることを書く。**
   ⚠ **あわせて «その Merge が何を起こすか» を必ず書く。**default branch への merge が
   そのままデプロイになる repo では、**押す人は «承認» のつもりで «出荷» をしている。**
   知らせずに押させない。⚠ **違ったときの戻し方も 1 行書く**（«この PR を revert すれば
   同じ経路で戻る»）。**«違う» と言えることは、出したあとに戻せる道があって完結する。**
4. 人が merge すると `coding-robot-finalize.yml` が **Issue を閉じるだけ**を行う（API のみ・git 書き込み無し）。
   ⚠ **その job は «PR の差分に `tickets/done/…/ticket.md` が入っているか» を検査し、入っていなければ
   Issue を閉じずに警告をコメントする。**手順 3 を飛ばすと、そこで止まる。

⚠ **「承認前に `done/` へ移すのは嘘だ」とは考えない。**未 merge の branch は、default branch について
「まだ真でないこと」を主張するもので、それが branch というものである。⚠ **むしろ逆で、merge の後に
bot の credential で default branch へ書く方式こそが、守りたい不変則を機構として破っていた。**

### CI は PR 側の run だけが gate である（bot は回さない）

⚠ **bot が `gh workflow run` で起動した CI は、PR の必須チェックを満たさない。**2026-09-16 に実測:

```
head の check-run : test-all completed/success   ← commit には付く
PR の rollup      : test-all が居ない
mergeable_state   : blocked
```

`pull_request` イベント由来の run が緑になって初めて `clean` になる。**したがって bot は
フルスイートを自分で回さない。**回しても merge の可否に 1 ミリも効かず、時間を 2 回払うだけになる。

⚠ **守る数字は «人が押す回数»。**`ATTACHMENTS_TOKEN` があれば **1 回**（Merge）、無ければ **2 回**
（Approve and run → Merge）。**手順を変えるときは、この回数が増えていないか必ず確かめること。**

### CI が赤いとき、«関係なし» は結論として書かない

`PDH-AGENTS.md`「Reporting」が定めているのは 1 つ — **失敗は無関係だと断言することは免責にならない。**
免責できるのは、**同じ step を base ref で実行して、そこでも落ちることを示したとき**だけである。
報告には次の 3 つのどれかだけを書く。**「関係なし」という語で終わらせない。**

1. **base でも落ちた** — その出力を貼る。免責になる
2. **base では通った** — 自分の差分のせいである。直す
3. ⚠ **確かめられなかった** — **そう書く。**推測の根拠は 3 の中身であって 1 の代わりにはならない

⚠ **不安定な失敗では 1 も 2 も決まらない**（budget 超過・timeout・`flaky: N` 併記）。
**base で 1 回通っても «無関係» の証明にならない** — 同じ不安定さが base でたまたま出なかっただけかもしれない。
その場合は 3 を選び、**«不安定なので 1 回の再現では決まらない» と書いて人に上げる。**
⚠ **回数を揃えて比べる（base と head で N 回ずつ）のは高くつくので、人が «そこまでやれ» と言わない限り始めない。**

**どの場合も «再実行して偶然 green を得る» を選ばない。**緑が出ても、それは失敗が消えた証拠ではない。

## worker spawn（team 実行）

⚠ **worker が «作業と無関係な理由» で落ちたら、1 回だけやり直す。**

実測（2026-09-15〜16 の 4 件）: «実 API 検証後に worker が異常終了» / «QA・review 起動プロセスの
異常終了» / «2 worker が起動約 3 分後に TERM で中断» / «QA担当がモデル容量エラーで終了»。
⚠ **4 件とも、人がやったことは «🤖 続行» と打つことだけだった。**判断を求められたのではなく、
**再起動を求められていた。**

- **やり直してよいのは «作業と無関係な落ち方» だけ** — 起動失敗・TERM・容量エラー・一時的な
  API エラー。⚠ **prompt や仕様の誤りで落ちたものはやり直さない**（2 回とも同じに落ちる）
- ⚠ **1 回だけ。**2 回目も落ちたら人に返す
- ⚠ **やり直した事実と回数を、最終レポートに必ず書く。**書かないと «失敗が消える»。
  «QA worker が TERM で落ちたので 1 回やり直し、2 回目は通った» のように 1 行
- ⚠ **run 全体はやり直さない。**run 1 本は中央値 27 分かかる。落ちた worker だけをやり直す

**あなた（bot の main agent）は PM として team フローを実行する。** worker（Coding Engineer / reviewer / AC 裏取り 等）は **CLI subprocess で spawn** する（`_execution-team.md`「spawn 機構」）。
- **main engine** = `CODING_ROBOT_ENGINE`（この run の engine）。**worker は既定で main と同じ engine**。起動コマンド（claude / codex、**bypass 権限**）と並行起動・結果回収は `_execution-team.md` に self-contained に書いてある。**それをそのまま使う**。
- 各 worker は専用 result ファイルに書かせ、統合する。認証は run の環境変数を subprocess が継承する（追加設定不要）。
- **spawn は必須。** 失敗/不可能な場合（CLI 不在・auth 不在・exit 非ゼロ）は **単独で続行しない**。`wait` 後に `rc=$?` を保存し、final report に「何の spawn が・どう失敗したか（コマンド・rc、result/stderr の `ls -l`、`tail -120 stderr.log`）」を書いてエラー報告する（独立レビュー無しで PR を出さない）。

## GitHub Issue プロトコル（gate・進捗・PR）
issue とのやり取りは、同じディレクトリの **`_github-issue.md`** に従う。⚠ **あれはこの prompt の末尾に連結済みである**（`run-action.sh` が `_pdh.md` と同じ条件で append する）。Read は要らない。要点だけ再掲する:

- **human gate では自己承認しない。** `PDH-ticket-human-review` と `PDH-human-review` に達したら、Actions には対話できる人間がいないので、**gate の要点を判断ボード（`_github-issue.md`）として issue にコメントし、note の Checklist に待ち行を書いて run を停止**する。承認は **🤖 を含むコメント**（例「🤖 承認」。Actions は reaction では起動しないので 👍 だけでは再開しない）、変更希望は 🤖 付きで返信。⚠ **ただし close gate は除く** — `github_bot.close` が `pr-merge` のときは **PR の merge そのものが close 承認**であり、承認語を求めない（この `_pdh.md` の「checklist gate と close」を参照）。«よしなに» で gate を越えない。
- **進捗コメントは増やさない。** run 中の「🤖 作業中...」は 1 個を編集し続ける（machinery が担う）。人間の注意が要るとき（gate・質問・blocker）だけ新規コメントを立てる。
- **stage をラベルで出す。** ラベルは runner が note の `## Status:` から付ける。agent は Status を到達 stage に保つ。Projects は使わない。
- **close は `github_bot.close` の設定に従う**（既定 `merge`: `ticket.sh close` で squash merge して issue を閉じる。`pr` / `pr-merge`: PR は `Refs #N`、`Closes #N` にしない。⚠ **`pr-merge` では merge が close gate であり、done への移動は PR の差分に載せる**。手順は上の「`pr-merge`: done への移動を PR に載せて出す」にある）。

## 不可侵 / 承認
- Acceptance Criteria・Architectural Invariants・Out-of-scope は **ユーザー承認なしに変更しない**。
- `product-brief.md` を編集する場合は内容を提示して承認を得る。
