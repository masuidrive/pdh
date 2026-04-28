# 既知の問題と地雷

この文書は recurring な failure mode と設計上の地雷をまとめます。

## 1. `running` は必ずしも live ではない

保存された runtime state が `running` でも、実際の top-level process は死んでいることがあります。

対策:

- top-level runtime liveness を確認する
- runtime supervisor の truth を優先する
- stale running state を正規化する

## 2. Web UI が生きて見えても Runtime は止まっていることがある

viewer は runtime が止まった後でも state を表示できます。

見た目が動いていることを process activity と同一視してはいけません。

## 3. Provider と Assist の責務が混ざりやすい

最も多い conceptual trap です。

- provider = runtime-invoked step worker
- assist = stop-state の discussion / verification terminal

ここが混ざると、interruption / gate / progression logic が崩れます。

## 4. Markdown Body は誘惑だが危険

人間が書く markdown body を transition authority として parse するのは壊れやすいです。

可能な限り structured state と artifact を使います。

やむを得ず markdown を読む場合でも、それは compatibility debt と考えてください。

## 5. Recommendation は Approval ではない

これは UI と runtime の両方で繰り返しバグ原因になっています。

- recommendation は evidence / advice
- approval は human decision
- runtime は recommendation 文面ではなく approved decision から advance する

## 6. Gate Summary は必須

gate summary なしで human approval ができる経路は壊れています。

もし approval が summary なしで通るなら、それはバグです。

## 7. Close Finalization は壊れやすい

PD-C-10 は次を混ぜるので壊れやすいです。

- final gate
- note / ticket update
- `ticket.sh close`
- transient artifact cleanup

順序が崩れると、誤った state に取り残されます。

## 8. Stop-State Terminal は正しい Surface を使う必要がある

stop-state assist と chooser assist は、explicit wrapper または designated handoff path を使う必要があります。

assist がこっそり raw runtime controller になってはいけません。

## 9. 実ブラウザ挙動は重要

API state と実ブラウザ挙動はずれることがあります。

典型例:

- hidden button が layout space を食い続ける
- pointer interaction が wiring されていない
- ある viewport では収まる modal が、別 viewport では壊れる

## 10. Seeded UI State は問題を隠すことがある

server がある程度もっともらしい HTML を返しても、client-side behavior が壊れていることがあります。

区別すべきもの:

- seeded display
- hydrated behavior
- live runtime update

## 11. Review / Repair は Review を通っても Guard で落ちることがある

review step が accepted judgement に達しても、guard-facing evidence が不足していることがあります。

この場合は誤った success ではなく、deterministic な follow-up repair に進むべきです。

## 12. `.pdh-flow/` は Local に保つ

便利ではありますが、その中身が durable product truth のように振る舞い始めると設計が不安定になります。

そして commit してはいけません。

## 13. Ticketing Flow と PD-C Runtime は別レイヤー

ticket 選択 / start と PD-C 実行は関連していても別レイヤーです。

これを混同すると:

- chooser の挙動が壊れる
- start semantics が誤る
- prompt の責務が混ざる

## 14. Human-Facing Label は厳密である必要がある

特に次の label は曖昧にしてはいけません。

- `running`
- `completed`
- `close`
- `approve`
- `start`

label が不正確だと、ユーザは間違った action を取ります。

