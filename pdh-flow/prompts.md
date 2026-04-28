# Prompt 一覧

このファイルは、`pdh-flow` が現在 provider / reviewer / assist に送っている prompt の種類と、その使用ケースを日本語で整理したものです。

実装の一次情報は主に以下です。

- `src/prompt-templates.mjs`
- `src/assist-runtime.mjs`
- `src/review-runtime.mjs`
- `src/step-ui.mjs`

## 前提

- `current-note.md` と `current-ticket.md` は、provider / reviewer / assist が読む主要な repo 内コンテキストです。
- 現在の実装では、通常 provider prompt と reviewer prompt は両方とも `current-note.md` / `current-ticket.md` を読む前提です。
- `ui-output.yaml` は provider が書く step-local な structured output です。
- assist 系 prompt は runtime progression を直接持たず、signal 経由で runtime に返します。

将来の設計方針としては、

- `current-note.md` の frontmatter
- `.pdh-flow/` 配下の structured artifact

を runtime truth に寄せ、markdown 本文は人間向け narrative に寄せる方向です。

---

## 1. 通常 step provider prompt

### 使用ケース

- 通常の provider step
- review batch ではない step
- 現在の Full flow では主に:
  - `PD-C-2`
  - `PD-C-3`
  - `PD-C-6`

### 実装

- `writeStepPrompt(...)`
- `renderStepPrompt(...)`

### 出力先

- `.pdh-flow/runs/<run-id>/steps/<step-id>/prompt.md`

### 主な内容

- Run / Ticket / Flow / Step / Provider / Mode
- Operating Rules
- current open / answered interruptions
- step 固有 instruction
- `current-ticket.md` / `current-note.md` を読む指示
- compiled semantic rules
- required guards
- review semantics がある step ならその概要
- `ui-output.yaml` の書式

### 期待すること

- 現在 step だけを進める
- later step 完了を主張しない
- guard を満たす
- 必要なら commit する
- commit subject は `[PD-C-*]` で始める

---

## 2. Reviewer prompt

### 使用ケース

- review step の reviewer batch
- 現在の Full flow:
  - `PD-C-4`
  - `PD-C-7`
  - `PD-C-8`
  - `PD-C-9`

### 実装

- `writeReviewerPromptArtifact(...)`
- `renderReviewerPrompt(...)`

### 出力先

- 初回:
  - `.pdh-flow/runs/<run-id>/steps/<step-id>/reviewers/<reviewer-id>/prompt.md`
- round 中:
  - `.pdh-flow/runs/<run-id>/steps/<step-id>/review-rounds/round-<n>/reviewers/<reviewer-id>/prompt.md`

### 主な内容

- reviewer role / remit / focus
- read-only review rule
- `current-ticket.md` / `current-note.md` を読め
- prior blocking findings の引き継ぎ
- review intent / passWhen / onFindings
- step-specific review rules
- `review.yaml` の schema

### 禁止事項

- repo file 編集
- commit
- `ticket.sh`
- `node src/cli.mjs ...`

### 期待すること

- 最新 repo state だけを見る
- severe finding を優先する
- prior blocker は現状で本当に解消されている時だけ閉じる
- `status / summary / findings / notes` を YAML で書く

---

## 3. Review repair prompt

### 使用ケース

- reviewer batch 後に blocker が残った時
- accepted review の後に guard-facing evidence が欠けた時
- 現在の Full flow:
  - `PD-C-4`
  - `PD-C-7`
  - `PD-C-8`
  - `PD-C-9`

### 実装

- `writeReviewRepairPromptArtifact(...)`
- `renderReviewRepairPrompt(...)`

### 出力先

- `.pdh-flow/runs/<run-id>/steps/<step-id>/review-rounds/round-<n>/repair-prompt.md`

### 主な内容

- current blocking findings 一覧
- read / edit 対象
- 最小限の verification を走らせる指示
- step-specific repair rules
- `repair.yaml` の schema

### 禁止事項

- commit
- `ticket.sh`
- `node src/cli.mjs ...`

### 期待すること

- blocker を解消する
- 必要なら code / test / `current-ticket.md` / `current-note.md` を直す
- verification を実行する
- 未解決があれば `remaining_risks` に残す

---

## 4. Stop-state assist prompt

### 使用ケース

- `needs_human`
- `interrupted`
- `blocked`
- `failed`
- `advance pending` の `running`

### 実装

- `buildAssistSystemPrompt()`
- `buildAssistPrompt(...)`

### 出力先

- system:
  - `.pdh-flow/runs/<run-id>/steps/<step-id>/assist/system-prompt.txt`
- body:
  - `.pdh-flow/runs/<run-id>/steps/<step-id>/assist/prompt.md`

### 主な内容

- current stop / current context
- read first files
- human gate context
- interruption context
- blocked guard context
- step checkpoints
- allowed signals
- signal examples
- working style

### 強い制約

- runtime progression を直接持たない
- `ticket.sh` を叩かない
- `run-next` / `run-provider` / `resume` / `approve` / `reject` / `request-changes` などを直接叩かない
- 必要な時だけ wrapper 経由で signal を返す

### 期待すること

- 調査、相談、編集、検証
- human gate では recommendation を 1 つに絞る
- blocked / failed / interrupted では `continue` または `answer` の条件を整える

---

## 5. Ticket chooser assist prompt

### 使用ケース

- active run が無い chooser 画面で `Open Terminal`

### 実装

- `buildTicketAssistSystemPrompt()`
- `buildTicketAssistPrompt(...)`

### 出力先

- `.pdh-flow/ticket-assist/<ticket-id>/system-prompt.txt`
- `.pdh-flow/ticket-assist/<ticket-id>/prompt.md`

### 主な内容

- 対象 ticket id
- これから開始する flow variant
- ticket file path
- note file path
- `product-brief.md`
- `AGENTS.md`
- `./ticket.sh` の usage 出力
- `ticket-start-request` の使い方

### 強い制約

- `./ticket.sh start` を直接叩かない
- `node src/cli.mjs run` / `run-next` を直接叩かない
- 開始したい時は `ticket-start-request` を 1 回だけ出す

### 期待すること

- 対象 ticket を読み、開始してよいかを相談する
- `Keep Editing` の後でも新しい request を出し直せる
- 実際の開始は UI の確認 modal に委ねる

---

## 6. UI output contract

### 使用ケース

- 通常 step provider prompt の末尾に常に付く
- review step では judgement も要求する

### 実装

- `renderUiOutputPromptSection(...)`

### 出力先

- `.pdh-flow/runs/<run-id>/steps/<step-id>/ui-output.yaml`

### 主な内容

- `summary`
- `risks`
- `ready_when`
- `notes`
- review step なら `judgement.kind / judgement.status / judgement.summary`

### 期待すること

- provider が step の UI summary を structured に出す
- review step では guard-facing judgement を同時に出す

---

## Full flow 対応表

### 通常 provider prompt

- `PD-C-2`
- `PD-C-3`
- `PD-C-6`

### Reviewer + repair

- `PD-C-4`
- `PD-C-7`
- `PD-C-8`
- `PD-C-9`

### Human / stop-state assist のみ

- `PD-C-5`
- `PD-C-10`

### Ticket chooser assist

- active run が無い時

---

## いまの prompt 設計で気をつける点

1. **通常 provider / reviewer / repair prompt は、まだ markdown 寄り**
- `current-ticket.md`
- `current-note.md`

を強く読ませています。

2. **runtime truth の優先順位は prompt にまだ十分入っていない**

今後は prompt 側でも以下を明示するのが望ましいです。

- frontmatter と structured artifact が runtime truth
- markdown body は human narrative
- 両者が矛盾したら runtime truth を優先する

3. **assist prompt は runtime progression を持たない**

この制約は既に強めに入っています。

---

## 今後このファイルも更新すべきタイミング

- 新しい prompt 種別を追加した時
- reviewer / repair / assist の権限境界を変えた時
- runtime truth の優先順位を prompt に反映した時
- chooser / stop-state assist の handoff 方式を変えた時
