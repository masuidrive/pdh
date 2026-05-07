# 開発メモ

## 1. このシステムが何か

`pdh-flow` は、1 つの repo checkout の中で PD-C フローを実行する repo-centric runtime です。

汎用チャットシェルではありません。これは次を持つワークフロー runtime です。

- canonical な current state
- 明示的な停止状態
- deterministic な guard
- 一時的な local evidence
- viewer-first の Web UI

遷移を決めるのは runtime です。LLM 出力は evidence に過ぎません。

## 2. Authority モデル

authority は意図的に分離しています。

- `current-note.md` frontmatter: canonical runtime state
- `current-ticket.md`: durable ticket intent
- `.pdh-flow/`: transient local evidence と runtime artifact
- markdown body: 人間向け narrative。遷移 authority ではない

第二の source of truth を増やしてはいけません。

## 3. 役割分担

### Runtime

持つ責務:

- current step
- run status
- guard evaluation
- human gate
- interruption
- 次の step への遷移

持たない責務:

- プロダクト判断
- コード変更
- レビュー内容そのもの

### Provider

provider は runtime から起動される step worker です。

長寿命の user-facing chat surface ではありません。

provider は:

- 1 step を実行する
- repo context を読む
- 必要に応じて code と note を更新する
- `ui-output.yaml` などの evidence を書く
- 終了する

provider が 1 つの明確なユーザ回答を必要とする時は、provider 向け surface から interruption を開き、その invocation を終えるのが正しい動きです。

### Assist

assist は、相談・調査・検証・recommendation のための stop-state terminal です。

assist は flow progression を持ちません。

状態に応じて、explicit signal や start request で runtime に control を返せます。

### Human Gate

human gate は明示的な stop point です。recommendation と approval は別です。

## 4. Run のライフサイクル

典型的な step は次の順で進みます。

1. runtime が provider を起動する、または runtime-owned step を処理する
2. provider が repo 変更と step-local artifact を残す
3. runtime が必要なら judgement / evidence を materialize する
4. runtime が guard を評価する
5. runtime は次のどれかに進む
   - advance
   - block
   - interrupt
   - human approval 待ち
   - fail

provider が exit しただけで advance してはいけません。

## 5. 停止状態

### `running`

current step が active であるか、直ちに runtime progression 可能な状態です。

### `needs_human`

runtime が human gate に到達し、人間の判断待ちです。

### `interrupted`

current step が継続前にユーザ回答を必要としています。

### `blocked`

step は guard 評価できるところまでは進みましたが、guard failure があり、自動回復でも解消できませんでした。

### `failed`

provider または runtime path が失敗し、明示的な recovery が必要です。

## 6. Interruption モデル

interruption は、「推測して進まず、1 つの明確な質問をする」ための仕組みです。

重要なのは次です。

- provider process 自体は回答待ちで開き続けない
- runtime state が `interrupted` になる
- 次の provider invocation が explicit answer 後に再開する

step 中の clarification を要求する正しい方法はこれです。

## 7. Human Gate

PD-C-5 と PD-C-10 は明示的な human gate です。

ルール:

- approval 前に gate summary が必要
- recommendation は approval ではない
- approved decision から先の遷移を決めるのは runtime
- gate 中の編集内容によっては、前段 step からの rerun が必要になる

## 8. Provider モデルと Assist モデル

ここは混線しやすく、実際に不具合の原因になります。

### Provider モデル

- single-step worker
- runtime-invoked
- flow を直接進めない
- gate を直接確定しない

### Assist モデル

- stop-state の対話 surface
- 調査・相談・検証はできる
- explicit signal や ticket-start request は出せる
- それでも progression 自体は持たない

この 2 つを混ぜる変更をする時は、理由を必ず文書化してください。

## 9. 遷移ロジック

遷移は次で決まります。

1. flow YAML にある current step 定義
2. current variant (`full` / `light`)
3. guard result
4. 必要なら explicit human decision outcome

structured evidence が既にあるのに、prose の解釈で遷移を増やしてはいけません。

## 10. Local Artifact

`.pdh-flow/` は local evidence 専用です。

典型的には次が入ります。

- prompt
- raw provider log
- `ui-output.yaml`
- gate summary
- interruption
- run-local process metadata

これらは inspection と recovery を助けるためのものであり、durable な product truth になってはいけません。

commit してはいけません。

## 11. Web UI 契約

Web UI は viewer-first です。

できること:

- state を表示する
- artifact と diff を表示する
- gate と interruption を表示する
- assist terminal を開く

独立した workflow engine になってはいけません。

runtime truth と UI 表示が食い違ったら、まず runtime / source-of-truth 側を直してください。

## 12. 変更時のルール

このシステムを変更する時は:

- 安易に truth source を増やさない
- 安易に markdown body parse を増やさない
- 遷移 ownership を Web UI に移さない
- provider と assist の責務を分離する
- prose の推測より deterministic evidence を優先する

## 13. 変更後に最低限見るべきもの

最低でも次を確認します。

- current run state
- current step
- 必要なら gate summary または interruption artifact
- `git diff`
- UI を触った場合は viewer behavior

stop-state を触った変更なら、少なくとも次を手動確認します。

- `needs_human`
- `interrupted`
- `blocked`
- assist open / close

