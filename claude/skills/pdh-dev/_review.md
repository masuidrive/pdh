# PDH Dev — レビューの巡回と裁定

## 巡回

1. diff 全体の網羅探索は初回だけとし、修正後は採用 finding、再現条件、修正 diff、実装が記録した修正前後の出力だけを同じ reviewer へ渡す
2. 修正起因の Critical / Major だけを scope gate へ戻す

## 複雑度差分 gate

修正で永続 column / table、公開 endpoint、画面、権限、state 名または遷移が増えるなら、単純案で AC か security contract を満たせない理由を note へ残す。1 finding のために 2 つ以上増やすなら、自動修正を止めて相談する。

## 収束

- 同種 Critical が 2 attempt で再発したら escalate し、ticket への実装詳細混入、scope 肥大、reviewer prompt 偏り、確定値の下流委譲を root cause として確認する
- `PDH-review-2` 以降で初回 finding が誤検出、pre-existing、Out-of-scope、user 価値非直結と判明したら、追加 fix をせず Discovery へ記録し、元の AC と user journey だけを verify する
- **次の巡を起こす条件は 1 つだけ — 直前の巡で «修正が持ち込んだ Critical / Major» が出たこと。**出ていなければ、その時点で review は終わりである（「巡回」2 の «修正起因の Critical / Major だけを scope gate へ戻す» の対偶）。⚠ **回数で決めない。**⚠ **人に «次の巡をやるか» を聞かない** — 何が出るかは、やる前には誰にも分からないので、**判断できない問いを承認者へ渡すことになる**（`PDH-AGENTS.md`「Human Gate Materials」）
  - ⚠ **Minor では次の巡を起こさない。**`記録のみ` か `起票` に振る（`PDH-AGENTS.md`「保留した ticket には、それ自身が存在する理由が要る」の 4 処置）。⚠ **そもそも `pdh-reviewing`「報告」は Critical と Major だけを書くと定めている**
  - ⚠ **`記録先` が note で済む Critical/Major でも、次の巡は起こさない。**直したコードに対する指摘でなければ «修正が持ち込んだ» に当たらない
  - ⚠ **既存の欠陥（pre-existing）や CI の既存 flaky では次の巡を起こさない。**`起票` に振る
  - **実測でこの条件が正しく切れることを確かめた**（2026-09-19 に 4 ticket・計 16 巡を数えた）。ある ticket は 6 巡回ったが、**修正起因の Critical/Major が出たのは 3 巡目まで**で、4 巡目は Minor 4 件（記録のみ 3）、5 巡目は Major 1 件だが記録先 note と既存 flaky の起票、**6 巡目は製品コードを 1 行も変えなかった**（Minor 4 件・Surface 2 件は両方棄却）。⚠ **この条件なら 3 巡で止まり、3 巡目の Major 2 件（恒久 test が flaky で full suite を不安定にする / 検証用 DB の隔離漏れ）は取り逃さない**
  - ⚠ **止まらない側の歯止めは既にある** — 「同種 Critical が 2 attempt で再発したら escalate」。**そちらは «出続けている» ときの話なので、人が判断できる**（何が出たかを見てから決める）

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
