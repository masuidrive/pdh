# 手動確認シナリオ

runtime / stop-state / UI behavior を変えた時に最低限確認すべき user flow をまとめます。

## 1. Idle Chooser

目的:

- active run が無い
- chooser が出る
- ticket を見られる

確認:

1. idle repo で Web UI を開く
2. blank な runtime shell ではなく chooser が出ることを確認する
3. ticket entry を選択できることを確認する
4. chooser action が見えて押せることを確認する

## 2. Ticket Start Request

目的:

- chooser assist から direct start せずに ticket start request を出せる

確認:

1. chooser assist を開く
2. ticket context を確認する
3. ticket-start request を発行する
4. UI が confirmation を出すことを確認する
5. approval 後にだけ実際の runtime start が起きることを確認する

## 3. PD-C-5 Human Gate

目的:

- recommendation と approval が分離されている

確認:

1. `PD-C-5` まで進める
2. gate summary が見えることを確認する
3. assist terminal を開く
4. recommendation を 1 つ出す
5. explicit approval までは runtime が advance しないことを確認する

## 4. Provider Interruption

目的:

- step 中に 1 つの明確なユーザ質問で止まれる

確認:

1. provider-side interruption request を作る、または simulate する
2. run status が `interrupted` になることを確認する
3. open question が見えることを確認する
4. provider progression が止まることを確認する
5. interruption に answer する
6. 次の provider prompt に answered context が入ることを確認する

## 5. Blocked State

目的:

- guard failure が visible な blocked state になる

確認:

1. guard failure を意図的に起こす
2. step が `blocked` になることを確認する
3. UI に理由が出ることを確認する
4. 次 action が妥当であることを確認する

## 6. Failed Provider Recovery

目的:

- provider failure が health に見えない

確認:

1. provider failure を起こす
2. step が `failed` になることを確認する
3. status output と UI が一致することを確認する
4. 想定 recovery path が見えることを確認する

## 7. Assist Terminal Open / Close

目的:

- assist modal が実 interaction で正しく開閉する

確認:

1. UI から実際の pointer interaction で assist を開く
2. modal が viewport に収まることを確認する
3. close control が見えることを確認する
4. terminal control が使えることを確認する
5. 閉じて再度開く

## 8. 狭い Viewport での Modal Fit

目的:

- 狭い画面でも modal と terminal control が見える

確認:

1. narrow あるいは foldable viewport で開く
2. assist を開く
3. terminal が modal からはみ出さないことを確認する
4. 下部 control が見えることを確認する

## 9. Bottom Bar の Truthfulness

目的:

- bottom bar が actual top-level runtime activity を示す

確認:

1. run が active な間、ticket と current step が正しいことを確認する
2. process / live line が reality を反映することを確認する
3. stop-state 後に、runtime provider がまだ動いているように偽装しないことを確認する

## 10. Stale Running Recovery

目的:

- stale `running` を検知して recover できる

確認:

1. top-level runtime process 消失を simulate する
2. UI を reload する
3. system が healthy live execution を装わないことを確認する
4. recovery path が見えることを確認する

## 11. PD-C-10 Close Path

目的:

- final close path が clean に完了する

確認:

1. `PD-C-10` まで進める
2. decision material が見えることを確認する
3. close を approve する
4. ticket close が走ることを確認する
5. run が idle / chooser に戻ることを確認する
6. その run の transient artifact が掃除されることを確認する

## 12. Browser Rule

UI を触るシナリオでは、API output や HTML snapshot だけに頼らず browser で確認します。

