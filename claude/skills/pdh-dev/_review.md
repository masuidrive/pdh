# PDH Dev — レビューの巡回と裁定

## 巡回

1. diff 全体の網羅探索は初回だけとし、修正後は採用 finding、再現条件、修正 diff、実装が記録した修正前後の出力だけを同じ reviewer へ渡す
2. 修正起因の Critical / Major だけを scope gate へ戻す

## 複雑度差分 gate

修正で永続 column / table、公開 endpoint、画面、権限、state 名または遷移が増えるなら、単純案で AC か security contract を満たせない理由を note へ残す。1 finding のために 2 つ以上増やすなら、自動修正を止めて相談する。

## 収束

- 同種 Critical が 2 attempt で再発したら escalate し、ticket への実装詳細混入、scope 肥大、reviewer prompt 偏り、確定値の下流委譲を root cause として確認する
- `PDH-review-2` 以降で初回 finding が誤検出、pre-existing、Out-of-scope、user 価値非直結と判明したら、追加 fix をせず Discovery へ記録し、元の AC と user journey だけを verify する
- **既定は 2 巡である**（網羅探索 1 巡 + 修正確認 1 巡）。⚠ **`### Findings (PDH-review-3)` の表を作る前に escalate する。**3 巡目を自分の判断で始めない。escalate したら、scope 再作成、3 案以上の提示、戦略転換、レビュー対象の変更（diff をやめ実 data・実挙動の監査へ切り替える）、そのまま続行のいずれかを人が選ぶ
  - ⚠ **«2 巡で打ち切る» ではない。**実測（2026-09-19 に 4 ticket を数えた）では 3 巡目以降にも本物の Major が出た — 恒久 test が flaky で full suite を不安定にする / 検証用 DB の隔離漏れ。**機械的に打ち切ると、これが出荷される。**止めるのは自動の継続だけで、続けるかどうかは人が決める
  - ⚠ **2 巡目で出た Minor で 3 巡目を起こさない。**`記録のみ` か `起票` に振る（`PDH-AGENTS.md`「保留した ticket には、それ自身が存在する理由が要る」の 4 処置）。⚠ **そもそも `pdh-reviewing`「報告」は Critical と Major だけを書くと定めている。**実測では 4 巡目以降が Minor ばかりになり、6 巡目は**製品コードを 1 行も変えなかった**（Minor 4 件のうち 記録のみ 2・test 2、Surface 2 件は両方 棄却）

## 裏取り

同一 finding の統合と、code 上の事実誤認の除外だけを行う。ticket 記載を理由に却下する／重要度を引き下げる／対応済み扱いにする／既存問題扱いで無視する／指定 role、gate、承認を別手順で代替する、は行わない。

## 2 レンズ

- レンズ2 は通常の reviewer が diff とともに実施し、AC・確定判断・完了主張を渡す。AC が緩く Why 未達なら、ユーザ承認の上で AC を強化するか別 ticket にする
- reviewer 間または lens 間で結論が割れたら、union や多数決で流さず、前提差を確認して決着する

## Findings 表

finding は検出した時点で progress の `### Findings (PDH-review-N)` 表へ 1 行追加する。判定列と理由は後で埋めてよい。attempt 2 以降と、修正確認で出た新規 finding も同じ形式で足す。

```
| # | 観点 | Sev | 要旨 | 判定 | 理由 |
|---|---|---|---|---|---|
```

観点は `pdh-reviewing` の観点 label、Sev は Critical / Major / Minor、判定は 採用 / 起票 / 記録のみ / 棄却。
