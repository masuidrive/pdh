# PDH モード（このリポジトリは Product Delivery Hierarchy 構成）

このリポジトリには `product-brief.md` と `tickets/` があり、**PDH（ticket 駆動）** で運用する。すべての作業は ticket を単位に行い、`product-brief.md` が全判断の基準。

## 受け渡し経路（この run）

<Human-Agent-Interface>
この run の人との受け渡し経路は GitHub Issue のコメントである。`PDH-AGENTS.md`「Handover Routes」の 6 項目を次のとおり定める。これ以外の規則（human gate の停止・AC の承認・証拠・note の Checklist）はこの囲いで変わらない。

- **渡す場所**: issue コメント（最終レポートを machinery（`run-action.sh`）が投稿する）と、issue の stage ラベル（run の終わりに到達 stage へ更新する。`_github-issue.md`「stage をラベルで可視化する」）。gate で停止する run の最終レポートは `_github-issue.md` の判断ボードで、承認導線（`🤖 承認` / `🤖 クローズ承認`）を含める。`_issue.md` の «Create Pull Request» で終わる形式は PDH では使わない — PR は close 承認後に bot が作る。
- **答えが戻る場所**: 🤖 を含む issue コメント。HTML の板を出したときは、人が板の「回答をコピー」で出た貼り戻し文をそのまま貼る。
- **表現の上限**: Markdown（表・`<details>`・mermaid 可。HTML はソース表示になるので不可）。
- **発行先**: Markdown で足りる板は issue コメント本文。足りない板は project ルールに登録された発行先へ HTML を置き、issue には決定サマリーと URL だけを書く。登録が無ければ Markdown で出し、像は «回せない» と書く。
- **答えの戻し方**: トリガーコメントを答えとして解釈し、ticket へ反映して note の Checklist の行を `[x]` にする。
- **再開時に読む場所**: note の `## Checklist`（何を待っていたか）、`progress.md`（経緯）、issue のコメント列（答え）。gate で停止するときは、停止する同じ commit で note の `## Checklist` に「何の答えを待つか」と gate コメントの URL を 1 行書く。machinery の状態ファイルは同じコメントを二度処理しないための印にだけ使う。
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

## チケットは `ticket.sh new` で作る（`start`/`close` は使わない）
ファイル本体は `ticket.sh new` で生成する（テンプレ・frontmatter・ノートを正しく作るため）。ブランチは `agent/issue-N`・作業ビューは自分で張るので `start` / `close` は使わない。

```bash
bash ticket.sh new "issue-${ISSUE_NUMBER}" --created-at "$TS"
```

**配置は ticket.sh の版に従う。** 現行の ticket.sh は **per-ticket dir**（`tickets/<TICKET_NAME>/ticket.md` と `note.md`）、旧版は **flat**（`tickets/<TICKET_NAME>.md` と `-note.md`）。実パスは `ticket.sh new` の出力（`ticket:` / `note:` 行）が示す。**その行を読んで以降の参照に使う**（パスをハードコードしない）。

**find-or-create（重複させない）**: チケット名は決定的なので、`new` の前に既存を確認し、**無い時だけ `new`** する。per-dir と flat、`tickets/done/` の両方を見る:
```bash
if ls "tickets/${TICKET_NAME}/ticket.md" "tickets/${TICKET_NAME}.md" \
      "tickets/done/${TICKET_NAME}/ticket.md" "tickets/done/${TICKET_NAME}.md" 2>/dev/null | head -1 | grep -q .; then
  echo "既存チケットを使う"          # 既にあればそれを使う
else
  bash ticket.sh new "issue-${ISSUE_NUMBER}" --created-at "$TS"
fi
```

**作業ビュー**: `ticket.sh` が示す `ticket:` / `note:` 実パスへ compat symlink を張る（`current-ticket.md` を参照する指示がそのまま機能するように）。symlink は `.gitignore` 済・毎回張り直す（揮発）。

生成後、本体の各セクション（Why / What + Acceptance Criteria / Architectural Invariants check / Design Decisions / Out-of-scope）を Issue・`product-brief.md` から埋める。**同じ dir に `progress.md` を作る**（1 行目 `# Progress: <TICKET_NAME>`。ticket.sh は作らない。無ければどの stage の入口でも作る）。経緯はここへ追記し、note は現在値だけにする（`_reference.md`「ticket / note / progress の役割分担」）。`started_at` / `closed_at` は `start`/`close` を使わないので、必要なタイミングで frontmatter を直接更新する。

## checklist gate と close（bot のブランチ模型に注意）
bot は `agent/issue-N` で作業し、ticket.sh の feature-branch 模型（`{branch_prefix}<ticket-name>`）を使わない。そのため **`ticket.sh check` の «ticket/branch 同期» 判定は構造的に不一致を出す**（checklist の合否ではなく、branch が `agent/issue-N` で `{branch_prefix}<name>` と違うことを報告している）。これは想定内で、フローを止める失敗ではない。
- **checklist の充足は ticket 本体・note を直接読んで確認する** — required グループ（`.ticket-config.yaml` の `require_checklist_groups`）が両ファイルに在り、未了 checkbox が無いか。branch 同期の警告そのものは無視してよい。
- **close 段階（PDH-close、close 承認後）の手順** — PR を «誰が作るか» を曖昧にしない。次の順で行う:
  1. **bot が PR を作る**（`agent/issue-N` → default branch、本文に **`Refs #N`**。`Closes`/`Fixes` にしない）。作ったら «PR #M を merge したら 🤖 で最終 close します» と issue にコメントして**停止する**（merge は人間の操作）。
  2. 人間が PR を merge する。
  3. 次の 🤖 で bot が **`ticket.sh close --no-merge <ticket-name>`**（ticket.sh に merge させない。`--no-merge` は feature-branch 模型に依存しないので `agent/issue-N` でも通る）を実行し、`gh issue close #N` する。checklist gate（`require_checklist` / `require_checklist_groups`）はここで効くので、その前に上記の checklist 充足を満たしておく。

## worker spawn（team 実行）
**あなた（bot の main agent）は PM として team フローを実行する。** worker（Coding Engineer / reviewer / AC 裏取り 等）は **CLI subprocess で spawn** する（`_execution-team.md`「spawn 機構」）。
- **main engine** = `CODING_ROBOT_ENGINE`（この run の engine）。**worker は既定で main と同じ engine**。起動コマンド（claude / codex、**bypass 権限**）と並行起動・結果回収は `_execution-team.md` に self-contained に書いてある。**それをそのまま使う**。
- 各 worker は専用 result ファイルに書かせ、統合する。認証は run の環境変数を subprocess が継承する（追加設定不要）。
- **spawn は必須。** 失敗/不可能な場合（CLI 不在・auth 不在・exit 非ゼロ）は **単独で続行しない**。`wait` 後に `rc=$?` を保存し、final report に「何の spawn が・どう失敗したか（コマンド・rc、result/stderr の `ls -l`、`tail -120 stderr.log`）」を書いてエラー報告する（独立レビュー無しで PR を出さない）。

## GitHub Issue プロトコル（gate・進捗・PR）
issue とのやり取りは、同じディレクトリの **`.github/coding-robot/_github-issue.md`** に従う。**そのファイルを Read すること。** 要点だけ再掲する（詳細は同ファイル）:

- **human gate では自己承認しない。** `PDH-ticket-human-review` と `PDH-human-review` に達したら、Actions には対話できる人間がいないので、**gate の要点を判断ボード（`_github-issue.md`）として issue にコメントし、note の Checklist に待ち行を書いて run を停止**する。承認は **🤖 を含むコメント**（例「🤖 承認」。Actions は reaction では起動しないので 👍 だけでは再開しない）、変更希望は 🤖 付きで返信。«よしなに» で gate を越えない。
- **進捗コメントは増やさない。** run 中の「🤖 作業中...」は 1 個を編集し続ける（machinery が担う）。人間の注意が要るとき（gate・質問・blocker）だけ新規コメントを立てる。
- **stage をラベルで出す。** run の終わりに issue の PDH stage ラベルを到達 stage に更新する（既存の PDH-* を外し現在のものだけ付ける。詳細は `_github-issue.md`）。ラベルが無ければ skip して続行。Projects は使わない。
- **PR は `Refs #N`**（`Closes #N` にしない）。ticket.md に従い・issue は会話面なので、close は PDH の close 手順で行う。

## 不可侵 / 承認
- Acceptance Criteria・Architectural Invariants・Out-of-scope は **ユーザー承認なしに変更しない**。
- `product-brief.md` を編集する場合は内容を提示して承認を得る。
