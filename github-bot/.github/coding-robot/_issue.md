# Issue モード = 足りないことを聞く → ticket 作成 → 承認後に実装 → 設定に従って close

Issue に 🤖 が付いたら、**コメントに書かれたことを全部やる**。そのうえで **gate を越えるか
どうかだけ**を判断する。

⚠ **keyword の表でコメントを分類しない。**依頼の意味と gate を越える許可を別々に読む。

### 判定手順

**1. 書かれた依頼を全部やる。**

- **質問には答える** — コードは書かない。コメントで答える
- **修正・追加指示は ticket に反映する** — AC / Out-of-scope / Why を差分更新する
- **報告を求められたら返す**
- ⚠ **1 つのコメントに 2 種類以上が混じっていても、全部扱う。**混在は例外ではなく普通である

**2. そのうえで «gate を越えてよいと書かれているか» だけを判断する。**

- ⚠ **未解決の質問や、反映したばかりで承認を得ていない修正が残っているなら越えない。**
  直した AC は、まだ人が見ていない
- 人が «それでも進めて» と書いているときだけ、両方やってから越える
- **`🤖` だけの空打ちでは越えない。**ticket を書き換えず、現状の AC を再掲するだけにする

**3. どちらにしたかと、その理由を最終レポートに 1 行書く。**

読む人が «なぜ進まなかったのか» を探さずに済むようにする。⚠ **黙って止まらない。**
理由は依頼者の状況で書く（«質問に答えてから進みます» «直した AC を見てもらってから進みます»）。
手順書の規則を理由に挙げない（`_github-issue.md`「gate の判断ボードは…」）。

### 例

| コメント | 何をするか |
|---|---|
| `🤖承認` / `🤖 よろしく` / `👍🤖` / `🤖 承認します、お願いします` | **越える**。⚠ **スラッシュの有無で変わらない** |
| `🤖 AC2 って何を指してる？` | 答えるだけ。越えない |
| `🤖 AC2 のとこ、もうちょい丁寧にしたいかな` | ⚠ **ticket を直して越えない**（«直して» とは書かれていないが修正依頼である） |
| `🤖 AC2 って何を指してる？ あと README にも書いて。それで進めて` | ⚠ **答える + 直す + 越える**（3 つとも） |
| `🤖 待って` / `🤖 cancel` | 越えない。現状報告のみ |
| `🤖` のみ | 越えない。AC を再掲するだけ。ticket を書き換えない |

越えたら **B（実装フェーズ）**、越えなければ **A0 / A** へ進む。⚠ **ticket がまだ無く、依頼者にしか答えられないことが欠けているなら A0（聞く）。それ以外は A（ticket 作成 / 更新）。**

## A0. 足りないことを聞くフェーズ（ticket をまだ作らない）

**守るのは «依頼者が症状を 1 行書けば足りる» ことである。**

⚠ **依頼は雑でよい。**「一覧に名前が出ない」「ファイルの処理が失敗する」の
1 行で始まってよい。**Why・再現手順・案の比較・影響レイヤー・AC を依頼者に書かせない。**
それらを作るのは bot の仕事である。

### 聞くかどうかの判定

⚠ **まず、どの入口から来た依頼かを見る。**`<context>` の **Labels** に `coding-robot` が
あれば、**Issue フォーム（`.github/ISSUE_TEMPLATE/robot-request.yml`）から来ている。**
`gh issue create` はテンプレートを素通りするので、このラベルは付かない。

- ⚠ **フォームから来た依頼は、既定で確認する。**フォームを使うのは **repo を知らない人**である。
  こちらが推測で埋めたものは、**その人が «違う» と言うための材料を持たないまま先へ進む**ことになる。
  **1 つでも聞けることがあるなら聞いて止まる。**⚠ **絵と ticket を作ってから «違うなら言って» に
  しない** — 外れたとき、作ったものが丸ごと捨てになる
- **ラベルが無い依頼は、下の判定だけで決める。**`gh` / CLI から立てる人は書き慣れていて、
  Why も再現手順も最初から入っていることが多い。⚠ **欠けていなければ、この段は素通りしてよい**

⚠ **どちらの場合も、聞く «中身» の基準は同じである**（下記）。変わるのは
**«迷ったときにどちらへ倒すか»** だけ — フォーム由来なら聞く側、そうでなければ進む側。

⚠ **keyword で判定しない。**依頼の文を読んで、**「自分にはどうしても決められないこと」が
残っているか**だけを見る。

- ⚠ **調べれば分かることは聞かない。**原因・影響するレイヤー・実装の選択肢・AC は、
  **コードを読み、必要なら使い捨てのコードやサーバ起動 + `agent-browser` / `curl` で
  確かめて、自分で用意する**（`PDH-AGENTS.md`「確認が要るのは判断であって、調査ではない」）。
  «調べてよいですか» と聞かない
- **聞いてよいのは、依頼者にしか答えられないことだけ** — **何をしたらそうなったか**（再現の手順）・
  **どうなってほしいか**（期待する結果）・**どれだけ困っているか**（急ぎ・回避策の有無）
- **1 つも欠けていなければ A へ進む。**この段を必ず通す必要はない
- ⚠ **フォームの欄が空なのは «調べれば分かること» ではない。**「どうなってほしいですか」を
  空のまま送った人は、**まだ決めていないか、書き方が分からなかった**のどちらかである。
  ⚠ **推測で埋めて起票へ進まない** — そこがいちばん «違う» と言われやすい

### 聞き方

1. ⚠ **1 回の run でまとめて聞く。3 つまで。**1 つずつ往復させない。
   ⚠ **`Q1` `Q2` `Q3` と番号を振る** — 依頼者が «Q2: こう» と 2 語で返せるようにするため。
   **番号が無いと、返すほうが «どれの話か» を毎回書き足すことになる**
2. ⚠ **絵で聞けるなら絵で聞く。**画面の話なら現状の画面を撮って «この画面のここのことですか» と
   示す（撮り方は共通 `system.md`「Auxiliary Artifacts」）。**文章だけで確認させない**
3. **自分の当て推量を先に見せる。**«こう理解しました。違っていたら教えてください» の形にすると、
   依頼者は «違う» とだけ返せばよくなる。⚠ **ただし «見せる» のは推量であって、作った成果物では
   ない。**現状の画面を撮って «このことですか» と聞くのはよい。**ticket を書き、実装案の mock を
   作ってから聞くのは、この段ではやらない**
4. ⚠ **`ticket.sh new` を呼ばない。**この段では ticket も note も作らない。branch には何も commit しない
5. 最終コメントは **«いまあなたの番です»** で始め、聞きたいことを箇条書きにする

### 答えが返ってきたら

- **答えを踏まえて A へ進む。**聞いたことと答えを ticket の Why に書き写す
- ⚠ **«分からない» / «任せる» / «いい感じに» と返ってきたら、聞き直さない。**
  **bot が決めて A へ進み、何をどう決めたかを ticket と最終コメントに明示する。**
  決めたことは実装前 gate で依頼者が見て «違う» と言える
- ⚠ **同じことを 2 回聞かない。**過去のコメントに答えがあるなら、それを使う

⚠ **この段で止まった run は、ticket がまだ無い。**`pdh-hooks.sh` はそれを見て «人に聞いている»
と判定し、回答待ちラベルを付ける（done 済みで ticket dir が無い場合と扱いを分けている）。

## A. ticket 作成フェーズ（PD-C-1 相当）

フローの定義は `.claude/skills/pdh-dev/_flow.md` の PD-C-1（`_pdh.md` の指示で事前 Read 済み）。**その定義に従う**。以下は coding-robot harness 固有の補足のみ：

1. `TICKET_NAME` を算出（「PDH モード」）。find-or-create: 無ければ `bash ticket.sh new "issue-${ISSUE_NUMBER}" --created-at "$TS" --branch "agent/issue-${ISSUE_NUMBER}"` で本体＋ノート生成（`--branch` の理由は `_pdh.md`）。`current-ticket.md` / `current-note.md` を symlink。
   - **既にチケットがあり、Issue 本文・コメントに前回から新情報が無い場合**（例: `🤖` だけの空打ち）は、**チケットを書き直さない**。現状の Acceptance Criteria を再掲し、「実装に進むには承認トークン（例 `🤖 ok`）でコメント」と再案内するだけにする。差分（新しい指示・情報）があるときだけ更新する。
2. ticket と note の埋め方・AC の扱いは `_flow.md` PD-C-1 に従う（AC は ticket.md のみ、note にはコピーしない／曖昧 AC は勝手に決めない／`product-brief.md` 矛盾は実装に進まず提起、など）。実現可能性の調査として使い捨てコード / サーバ起動 + `agent-browser` / `curl` を使ってよい（成果物コードは commit しない）。
3. ticket と note を `agent/issue-${ISSUE_NUMBER}` ブランチに commit / push する。**PR は作らない。プロダクトコードは書かない。**
4. 最終コメントは **`_github-issue.md`「実装前 gate の板」に従う**（このファイルと同じ prompt に連結済み）。⚠ **«はい / いいえ» で終わる形にしない** — 2〜3 案を推奨先頭で出し、画面の見え方を変えるなら **変更後の姿の絵**を付ける。⚠ **ここに板の作り方を書き写さない**（2 か所に書くと片方だけ古くなる）。
   - **承認者はチケットファイルを開かない前提**で、コメントだけで AC の妥当性を判断できるようにする。AC に加えて **Why（1 行）** と **Out-of-scope** を必ず併記する（必要なら主要な確定判断も 1〜2 行）。AC は番号だけでなく内容を書く。
   - gate のコメントには ticket / note のパスを出さない。開発側の参照先は progress に記録する。
   - **内部メカニクスを並べない**: commit hash・「push 済み」等は書かない。チケットの所在は「`agent/issue-${ISSUE_NUMBER}` に作成（コードは未変更）」の 1 行で足りる。
   - **PR メタデータマーカー（`{{{{{pull-request-*}}}}}`）は出さない**。この段階では Create-PR リンクを出さない（コードがまだ無いため）。

---

## B. 実装フェーズ（PD-C-6 → PD-C-10）

フローの定義は `.claude/skills/pdh-dev/_flow.md`（PD-C-6/7/9/10）/ `_review.md`（収束性診断・スコープ外既存問題の扱い・裏取りルール）/ `_execution-team.md`（spawn 機構・並行起動・worker prompt の組み立て）/ `_subagent-context.md`（worker 共通プロンプト）。**その定義に従う**。以下は coding-robot harness 固有の補足のみ：

1. `TICKET_NAME` でチケットを特定する（無ければ実装に進まず、**A0 を通してから** A を促す）。`current-ticket.md` / `current-note.md` を symlink。frontmatter `started_at` を今（UTC）に設定。
2. **harness の hard timeout 対策（PD-C-6 中）**:
   - **Commit 早期義務**: worker は spawn 後の最初の意味ある変更で *先に commit + push してから* scoped テストを回す（最初の commit は spawn から *15 分以内*が目安）。push されていない作業は harness の hard timeout（`DEADLINE_UNIX`）で消失する。
   - **長時間 gate の前に push**: `scripts/test-all.sh` 等の長時間ジョブを回す前に、未 push の変更があれば必ず push してから実行する。
   - **test-all 前の deadline チェック**: Environment Variables の `DEADLINE_UNIX` を見て、残時間が test-all の想定実行時間 + 5 分のマージンを下回るなら、フル実行せず scoped に留めて「deadline 不足のため test-all はスキップ／scoped で代替、PD-C-9 に委譲」を note に記録して進める（kill されるより合理的）。
   - test cadence 本体（scoped中／test-all 1回／失敗時 triage）と round escalation policy は `_flow.md` PD-C-7 / `_review.md` 収束性診断・スコープ外既存問題の扱い に従う。
3. **worker spawn の失敗報告**: worker 起動後は必ず `wait` 後に `rc=$?` を保存し、各 worker の rc、result/stderr の `ls -l`、`tail -120 stderr.log` を **note へ記録する**。result が空/無い場合も、それだけで silent failure と扱わず rc と stderr tail をセットで残す。⚠ **rc と `tail -120 stderr.log` は note（または progress）へ書く。**⚠ **issue のコメントには出さない** — あれは run を debug するためのもので、issue には読み手がいない（`system.md`「Worker rc lists … do not go in the issue at all」）。**issue に書くのは «worker が落ちて、その結果あなたの番が変わるかどうか» を言葉で 1 行**である。spawn が失敗/不可能なら単独で続行せず中止し原因を報告する。
4. **PD-C-9 に到達できたか分岐**：
   - **PDH repo**（root に `product-brief.md` と `tickets/` がある）: `.ticket-config.yaml` の
     `github_bot.close` を読み、`_pdh.md`「checklist gate と close」に従う。具体的な手順はそちらが持つ。
     `merge`（既定）は issue の close 承認後に直接 close、`pr` は同承認後に done 移動を含む PR、
     `pr-merge` は close 承認を待たずに draft PR と判断ボードを出し、done 移動後に ready にして停止する。
     **PR の merge が close 承認になるのは `pr-merge` だけである。**PDH では marker を出さない。
   - **非 PDH repo の到達 + 自己チェック通過**: bot は `gh pr create` を呼ばず、結果の末尾に
     `{{{{{pull-request-title}}}}}` / `{{{{{pull-request-body}}}}}` を出す。
     runner が作る `📋 Create Pull Request` リンクを押すよう伝える。既存 open PR があれば
     marker を出さず、追加 commit を push したことを伝える。
   - **到達できず途中で終わる → marker は出さない**。共通 `system.md` の「For Incomplete / Early Termination」テンプレートに切り替え、停止理由を分類（time / decision / blocker / non-convergence / spawn-failure）して 1 行目に出す。`What was done (committed)` / `What was NOT done (remaining)` / `Decision needed from user` / `Evidence pointers` を埋める。次回 `🤖` の続行で何を再開すればよいか分かる状態にする。
     - **時間切れ系**: `DEADLINE_UNIX` 近接で test-all / 長時間 worker を起こす前に止めた、PD-C-7 ループの途中で deadline が来た等 → category `time`、残時間と必要だった時間を書く。
     - **判断要求系**: AC 解釈の分岐、scope 拡大の可否、product-brief.md と矛盾する要求等 → category `decision`、2–4 個の選択肢と trade-off。
     - **未解決問題系**: pre-existing major、環境ブロッカー、矛盾する要求等 → category `blocker`、`_review.md`「スコープ外既存問題の扱い」の 3 択（fix / deferred / cancel）で諮る。
     - **収束しない**: PD-C-7 / test-all 失敗が 3+ round 同型再発 → category `non-convergence`、`_review.md`「収束性診断」に従って scope 切り直し or cancel をユーザーに諮る。
     - **spawn 失敗**: Coding Engineer / reviewer / AC 裏取り worker が起動不能 → category `spawn-failure`。⚠ **Evidence pointers には note の path を書く** — rc や stderr の中身をコメントへ貼らない。コメントに書くのは «何が起動できず、そのせいで何が終わっていないか» を言葉で。
5. 最終コメントは `_flow.md` PD-C-10 の「完了報告の必須要素」（PD-C-9 到達時）か、共通 `system.md` の「For Incomplete / Early Termination」（途中終了時）のどちらかに従う。⚠ **PDH では「`_pdh.md` の close モードに従って何を行ったか」を 1 行で明記する。**非 PDH では marker / 既存 PR の更新のどちらかを書く。途中終了なら途中終了テンプレを使ったことを 1 行で明記。

### B で出す PR タイトル / 本文
PDH は `_pdh.md` に従って bot が作る PR、非 PDH は marker に書く中身である。
**実装済みの機能**を説明する（チケット作成という作業ではない）。
- **タイトル**: 機能ベース。機能に合った conventional commit type。例 `feat: helloworld に名前引数を追加`（`docs:` にしない）。
- **本文**:
  - **Why**: なぜこの機能が必要か（ticket の Why）。
  - **What**: 実装した内容（= AC を満たす観察可能な振る舞い）。
  - **Verification**: 実行したテストと結果、E2E 確認。
  - **Notes**: 補足（あれば）。
  - 末尾の紐付けは PDH の `pr` なら `github_bot.pr_link`（既定 `refs`）、`pr-merge` なら `Refs #N`。非 PDH の既定は `Closes #N`。

---

## 共通の禁止
- A フェーズで成果物コードを commit しない（使い捨ての確認コードも commit しない）。
- AC / Architectural Invariants / Out-of-scope をユーザー承認なしに変更しない。
- `product-brief.md` の編集は内容提示＋承認を得る。
