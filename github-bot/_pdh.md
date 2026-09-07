# PDH モード（このリポジトリは Product Delivery Hierarchy 構成）

このリポジトリには `product-brief.md` と `tickets/` があり、**PDH（ticket 駆動）** で運用する。すべての作業は ticket を単位に行い、`product-brief.md` が全判断の基準。

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

生成後、本体の各セクション（Why / What + Acceptance Criteria / Architectural Invariants check / Design Decisions / Out-of-scope）を Issue・`product-brief.md` から埋める。`started_at` / `closed_at` は `start`/`close` を使わないので、必要なタイミングで frontmatter を直接更新する。

## worker spawn（team 実行）
**あなた（bot の main agent）は PM として team フローを実行する。** worker（Coding Engineer / reviewer / AC 裏取り 等）は **CLI subprocess で spawn** する（`_execution-team.md`「spawn 機構」）。
- **main engine** = `CODING_ROBOT_ENGINE`（この run の engine）。**worker は既定で main と同じ engine**。起動コマンド（claude / codex、**bypass 権限**）と並行起動・結果回収は `_execution-team.md` に self-contained に書いてある。**それをそのまま使う**。
- 各 worker は専用 result ファイルに書かせ、統合する。認証は run の環境変数を subprocess が継承する（追加設定不要）。
- **spawn は必須。** 失敗/不可能な場合（CLI 不在・auth 不在・exit 非ゼロ）は **単独で続行しない**。`wait` 後に `rc=$?` を保存し、final report に「何の spawn が・どう失敗したか（コマンド・rc、result/stderr の `ls -l`、`tail -120 stderr.log`）」を書いてエラー報告する（独立レビュー無しで PR を出さない）。

## GitHub Issue プロトコル（gate・進捗・PR）
issue とのやり取りは、同じディレクトリの **`.github/coding-robot/_github-issue.md`** に従う。**そのファイルを Read すること。** 要点だけ再掲する（詳細は同ファイル）:

- **human gate では自己承認しない。** `PDH-ticket-human-review` と `PDH-human-review` に達したら、Actions には対話できる人間がいないので、**gate の要点を issue にコメントして run を停止**する。承認は **gate コメントへの 👍**、変更希望は返信。次回 🤖 で再開する。«よしなに» で gate を越えない。
- **進捗コメントは増やさない。** run 中の「🤖 作業中...」は 1 個を編集し続ける（machinery が担う）。人間の注意が要るとき（gate・質問・blocker）だけ新規コメントを立てる。
- **PR は `Refs #N`**（`Closes #N` にしない）。ticket.md に従い・issue は会話面なので、close は PDH の close 手順で行う。

## 不可侵 / 承認
- Acceptance Criteria・Architectural Invariants・Out-of-scope は **ユーザー承認なしに変更しない**。
- `product-brief.md` を編集する場合は内容を提示して承認を得る。
