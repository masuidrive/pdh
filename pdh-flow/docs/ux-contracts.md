# UX 契約

この文書は user-facing behavior の期待値を定義します。実装がこれからずれた場合、そのずれはバグか、文書化すべき intentional redesign です。

## 1. 全体像

Web UI は runtime viewer であり、action entry point は持つが、独立した controller ではありません。

UI は次を伝える必要があります。

- run が今どこにいるか
- なぜ止まっているか、または進んでいるか
- ユーザが次に何をできるか
- その state を支える evidence は何か

## 2. Active Run 画面

run が active な時、メイン画面には次が必要です。

- flow / step rail
- current step detail
- state に応じた action
- active runtime 情報を示す live bottom bar

ユーザが「本当に動いているか」を推測しなくて済む必要があります。

## 3. Idle 画面

active run が無い時は、blank な runtime shell ではなく ticket chooser を表示します。

chooser は次の action を明確にする必要があります。

- ticket を見る
- その ticket 用 terminal を開く
- ticket start を request する

## 4. Running State

current step が実行中の時は:

- `Live` 相当の内容が見える
- 実行中に無効な lower detail control は disabled になる
- approval などの stop-state action は出さない
- assist を開いても、実際に runtime が止まっていない限り、止まったように見せない

## 5. Stop State

step が止まっている時は:

- 理由が見える
- 次に可能な action が見える
- その state で無効な action は無視するのではなく hidden にする

想定 stop state:

- `needs_human`
- `interrupted`
- `blocked`
- `failed`

## 6. Human Gate UI

human gate では:

- ここが human decision point だと分かること
- approval 前に gate summary が見えること
- recommendation と approval を混同しないこと
- approval 文言が実際の step semantics と一致すること

例:

- `PD-C-5`: 実装開始 / request changes / rerun の判断
- `PD-C-10`: close readiness / ticket completion の判断

## 7. Interruption UI

`interrupted` の時は:

- open question が見える
- answer path が明確
- answer なしに step を続行できるような見え方をしない

## 8. Assist Terminal UI

assist は stop-state tool であって runtime 本体ではありません。

assist modal には次が必要です。

- 実際の pointer interaction で安定して開く
- modal の中に収まる
- close control が見える
- terminal control が fold の下に消えない
- stop-state assist か chooser assist かが分かる

assist terminal が run progression を持っているような見え方をしてはいけません。

## 9. Action Visibility

current state で無効な action は出さないでください。

例:

- step がまだ active に running しているのに `Approve` を出さない
- recommendation 用 affordance を direct approval のように見せない
- terminal が実際には開けないなら stale な terminal action を出さない

## 10. Evidence Presentation

意思決定用 evidence は短時間で読める必要があります。

優先表示:

- 短い state summary
- AC verification count
- review outcome
- changed files / diff summary
- ticket / note excerpt

長い raw material も残してよいですが、主要判断を埋めてはいけません。

## 11. Bottom Bar

bottom bar は常に次に答える必要があります。

- どの ticket が active か
- どの step が current か
- top-level runtime process が生きているか
- 直近の live runtime line は何か

UI の推測ではなく runtime truth を表す必要があります。

## 12. Terminology

ユーザに見せる用語は runtime semantics と一致させます。

混同してはいけないもの:

- recommendation と approval
- running と stale
- assist terminal と runtime provider
- ticket chooser と active run

## 13. Failure Presentation

UI が十分な state を描画できない場合、失敗は visible で diagnose 可能であるべきです。

白い shell だけが出て説明が無い状態は許容しません。

## 14. Browser Validation Rule

意味のある UI 変更では、HTML や API output を読むだけでなく browser で検証します。

最低限の確認:

- page が表示される
- primary action が押せる
- modal が収まる
- current state が読める
- bottom bar が live truth を示す

