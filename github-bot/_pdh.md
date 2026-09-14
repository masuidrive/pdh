# PDH モード（このリポジトリは Product Delivery Hierarchy 構成）

このリポジトリには `product-brief.md` と `tickets/` があり、**PDH（ticket 駆動）** で運用する。すべての作業は ticket を単位に行い、`product-brief.md` が全判断の基準。

## 受け渡し経路（この run）

<Human-Agent-Interface>
この run の人との受け渡し経路は GitHub Issue のコメントである。`PDH-AGENTS.md`「Handover Routes」の 6 項目を次のとおり定める。これ以外の規則（human gate の停止・AC の承認・証拠・note の Checklist）はこの囲いで変わらない。

- **渡す場所**: issue コメント（最終レポートを machinery（`run-action.sh`）が投稿する）と、issue の stage ラベル（runner が run の終わりに note の `## Status:` から付ける。agent は Status を到達 stage に保つ）。gate で停止する run の最終レポートは `_github-issue.md` の判断ボードで、承認導線（`🤖 承認` / `🤖 クローズ承認`）を含める。`_issue.md` の «Create Pull Request» で終わる形式は PDH では使わない — PR は close 承認後に bot が作る。
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

生成後、本体の各セクション（Why / What + Acceptance Criteria / Architectural Invariants check / Design Decisions / Out-of-scope）を Issue・`product-brief.md` から埋める。`progress.md` は `ticket_files` により `new` が作る。経緯はここへ追記し、note は現在値だけにする（`_reference.md`「ticket / note / progress の役割分担」）。旧 ticket.sh で作られて `progress.md` が無い ticket は、stage の入口で作る。`started_at` は `start` が、`closed_at` は `close` が入れる。

## checklist gate と close
- **checklist の充足は `bash ticket.sh check` で確認する。**required グループ（`require_checklist_groups`）、未了 checkbox、`append_only_files` の欠落行を出す。ticket は `branch:` を持つので同期判定も通る。
- **close 段階（PDH-close、close 承認後）** は `.ticket-config.yaml` の `github_bot.close` で分岐する:
  - **`merge`（既定）**: bot が `bash ticket.sh close --no-delete-remote` を実行する（squash merge → default branch へ push、ticket は `tickets/done/` へ）。続けて `gh issue close #N`。**1 run で終わり、PR は作らない。**
  - **`pr`**: bot が `bash ticket.sh close --no-merge "$TICKET_NAME"` で done へ移し、その commit を含む PR（`Refs #N`。`Closes` にしない）を作り、«merge したら 🤖 で issue を閉じます» と伝えて**停止する**。人間が merge → 次の 🤖 で `gh issue close #N`。
  - checklist gate（`require_checklist` / `require_checklist_groups` / `append_only_files`）はどちらでも `close` で効く。

## worker spawn（team 実行）
**あなた（bot の main agent）は PM として team フローを実行する。** worker（Coding Engineer / reviewer / AC 裏取り 等）は **CLI subprocess で spawn** する（`_execution-team.md`「spawn 機構」）。
- **main engine** = `CODING_ROBOT_ENGINE`（この run の engine）。**worker は既定で main と同じ engine**。起動コマンド（claude / codex、**bypass 権限**）と並行起動・結果回収は `_execution-team.md` に self-contained に書いてある。**それをそのまま使う**。
- 各 worker は専用 result ファイルに書かせ、統合する。認証は run の環境変数を subprocess が継承する（追加設定不要）。
- **spawn は必須。** 失敗/不可能な場合（CLI 不在・auth 不在・exit 非ゼロ）は **単独で続行しない**。`wait` 後に `rc=$?` を保存し、final report に「何の spawn が・どう失敗したか（コマンド・rc、result/stderr の `ls -l`、`tail -120 stderr.log`）」を書いてエラー報告する（独立レビュー無しで PR を出さない）。

## GitHub Issue プロトコル（gate・進捗・PR）
issue とのやり取りは、同じディレクトリの **`.github/coding-robot/_github-issue.md`** に従う。**そのファイルを Read すること。** 要点だけ再掲する（詳細は同ファイル）:

- **human gate では自己承認しない。** `PDH-ticket-human-review` と `PDH-human-review` に達したら、Actions には対話できる人間がいないので、**gate の要点を判断ボード（`_github-issue.md`）として issue にコメントし、note の Checklist に待ち行を書いて run を停止**する。承認は **🤖 を含むコメント**（例「🤖 承認」。Actions は reaction では起動しないので 👍 だけでは再開しない）、変更希望は 🤖 付きで返信。«よしなに» で gate を越えない。
- **進捗コメントは増やさない。** run 中の「🤖 作業中...」は 1 個を編集し続ける（machinery が担う）。人間の注意が要るとき（gate・質問・blocker）だけ新規コメントを立てる。
- **stage をラベルで出す。** ラベルは runner が note の `## Status:` から付ける。agent は Status を到達 stage に保つ。Projects は使わない。
- **close は `github_bot.close` の設定に従う**（既定 `merge`: `ticket.sh close` で squash merge して issue を閉じる。`pr`: PR は `Refs #N`、`Closes #N` にしない）。

## 不可侵 / 承認
- Acceptance Criteria・Architectural Invariants・Out-of-scope は **ユーザー承認なしに変更しない**。
- `product-brief.md` を編集する場合は内容を提示して承認を得る。
