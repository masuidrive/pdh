# PDH Dev — レビューの巡回と裁定

## 巡回

1. diff 全体の網羅探索は初回だけとし、修正後は採用 finding、再現条件、修正 diff、実装が記録した修正前後の出力だけを同じ reviewer へ渡す
2. 修正起因の Critical / Major だけを scope gate へ戻す

## 複雑度差分 gate

守るのは、**PDH-review の出口で PM が、修正のたびに足した部品の累計を見て、構造を見直す必要を判断できること**である。

PM は Coding Engineer の巡ごとの修正報告を並べて、**«この ticket の修正が足した部品（状態の項目・フラグ・分岐・見張りの job・後始末）の累計に、別の部品の欠陥を補うために足したものがあるか»** を問う。あれば、2 巡を待たずに「収束」の設計の見直しを回してよい。修正報告の一覧は、note の Checklist の既存の「PDH-review: 指摘を直すとき…」の行を `require_checklist` が数える。

## 収束

- 同種 Critical が 2 attempt で再発したら escalate し、ticket への実装詳細混入、scope 肥大、reviewer prompt 偏り、確定値の下流委譲を root cause として確認する
- `PDH-review-2` 以降で初回 finding が誤検出と判明したら棄却し、今回と無関係なら Discovery へ記録して、元の AC と user journey だけを verify する。⚠ **既存の問題（pre-existing）や 2 巡目以降の発見でも、承認された目的の達成に要る修正、または安く直せる修正は続ける** — 範囲の判断は `PDH-AGENTS.md`「Verification」の Scope boundary に従う
- **次の巡を起こす条件は 1 つだけ — 直前の巡の指摘を直した差分そのものに、新しい Critical / Major の指摘が付いたこと（この文書ではこれを «修正起因の Critical / Major» と呼ぶ）。**付いていなければ、その時点で review は終わりである（「巡回」2 の «修正起因の Critical / Major だけを scope gate へ戻す» の対偶）。⚠ **回数で決めない。**⚠ **人に «次の巡をやるか» を聞かない** — 何が出るかは、やる前には誰にも分からないので、**判断できない問いを承認者へ渡すことになる**（`PDH-AGENTS.md`「Human Gate Materials」）
  - ⚠ **Minor では次の巡を起こさない。**処置は 4 処置から Scope boundary で選ぶ — 安く直せるなら `採用`（`PDH-AGENTS.md`「保留した ticket には、それ自身が存在する理由が要る」の 4 処置）。⚠ **そもそも `pdh-reviewing`「報告」は Critical と Major だけを書くと定めている**
  - ⚠ **`記録先` が note で済む Critical/Major でも、次の巡は起こさない。**直した差分に対する指摘でなければ、修正起因ではない
  - ⚠ **既存の欠陥（pre-existing）や CI の既存 flaky では次の巡を起こさない。**⚠ **ただし «既存だから `起票`» にしない** — 巡を起こさないことと、いま直さないことは別の判断である。処置は Scope boundary で選び、`起票` は «別の問題 かつ ここで直すと高くつく» ときだけ
  - ⚠ **回数を削る規則ではない。**修正起因の Critical / Major が出れば巡は増える。
  - ⚠ **遮断器が守るのは、3 巡目の修正に入る前に、ユーザが設計の見直しの結論を見て、構造を変えるか決められることである。1 巡目の指摘を直した差分への review（2 巡目）で修正起因の Critical/Major が出たら、PM は 3 巡目の修正に入る前に設計の見直しを 1 回回し、その結論を添えて人へ渡す。**巡の数え方は検査と同じ — 1 巡目の指摘と、それを直した差分に付いた 2 巡目の指摘で 2 巡（`review-sha:` 3 本以上と 2 巡目の Findings 見出し）。
    - 同種 Critical の再発には上の escalate 規則を先に適用する。escalate 規則は同種 Critical の再発に限られるので、それ以外の修正起因の Critical/Major が 2 巡目で出た場合 — 種類を変えた場合も、escalate の対象でない同種の Major が再発した場合も — は、この遮断器で止める。
    - 見直しの worker は 1 人で、Why・AC・現コード（base との差分）だけを渡す。経緯・findings の一覧・note・progress は渡さない。engine / model は project ルールの worker の割り当て方針に従う（無ければ `_execution-team.md`「エンジン割り当て」）。
    - 問いは **«この差分が足した部品は、それぞれ何の欠陥を補うために在るか。足さずに済む構造はあるか。変えたら何が消えるか»**。人に渡す選択肢は **«もう 1 巡直す / 見直しの案で作り直す / 修正群を revert して実装からやり直す»** の 3 択である。
    - 渡した時点で note の Checklist に、何の答えを待つかと `発行先:` に続く URL か path を 1 行書き、答えを反映するまで未了にする（`PDH-AGENTS.md`「Handover Routes」）。この `発行先:` 行の文に **«設計の見直し» を含める**。`require_checklist` がその待ち行を数え、`scripts/check-pdh-ticket.sh` は導入後の ticket で `close-gate-sha:` があるのに `review-sha:` が 0 行なら落とす。
    - **«作り直す» が選ばれたら、«まとめる»（リファクタリング）を «直す»（指摘の修正）と別の差分で行い、その後の review は diff 全体の網羅探索からやり直す。AC が変わるなら再合意する。**
    - 検査は `review-sha:` 3 本以上で `###` か、それより深い（`####` 以降の）Findings 見出し（半角・全角括弧の `PDH-review-2`）があるなら、Checklist に `発行先:` と «設計の見直し» の両方を含む行があることまでしか数えない。人へ渡した後の修正差分への review で再び修正起因の Critical/Major が出たときは、PM が同じ遮断器を再び当てる。
  - ⚠ **例外は 1 つだけ — 「Independent review triggers」に該当する diff は、修正が落ち着いた後に網羅探索をもう 1 巡してよい**（認証・認可・破壊的操作・migration・secret・データ削除・課金・deploy・外部 API contract・新規の公開 surface）。⚠ **この 1 巡を回すかどうかは、実装前 gate の板で承認者に選ばせる** — 実装の後に «やりますか» と聞くのではなく、**diff の種類が分かった時点で先に決める。**⚠ **該当しない diff では回さない。**
  - ⚠ **同じ箇所で修正が 3 度続けて欠陥を作ったなら、担当がその箇所の不変条件を持っていない可能性を疑い、作り直しを選択肢に入れる。**

## 裏取り

同一 finding の統合と、code 上の事実誤認の除外だけを行う。ticket 記載を理由に却下する／重要度を引き下げる／対応済み扱いにする／既存問題扱いで無視する／指定 role、gate、承認を別手順で代替する、は行わない。

## 2 レンズ

- レンズ2 は通常の reviewer が diff とともに実施し、AC・確定判断・完了主張を渡す。AC が緩く Why 未達なら、ユーザ承認の上で AC を強化するか別 ticket にする
- reviewer 間または lens 間で結論が割れたら、union や多数決で流さず、前提差を確認して決着する

## Findings 表

finding は検出した時点で progress の `### Findings (PDH-review-N)` 表へ 1 行追加する。判定列と理由は後で埋めてよい。attempt 2 以降と、修正確認で出た新規 finding も同じ形式で足す。

```
| # | 観点 | Sev | 要旨 | 判定 | 記録先 | 理由 |
|---|---|---|---|---|---|---|
```

観点は `pdh-reviewing` の観点 label、Sev は Critical / Major / Minor、判定は 採用 / 起票 / 記録のみ / 棄却。

**`記録先` は、finding がどこに残ったかを書く列である。**守るのは «`PDH-human-review` で承認者が、finding がどこに残ったかを表から読めること» である。判定 4 つのうち `記録のみ` だけは、行方を追う機構を持たない — `採用` はテストが落ちて、`起票` は ticket 一覧に残って検出されるが、`記録のみ` は人が書いた文章にしか残らない。

- 判定が `記録のみ` なら `note` / `technical-reference` / `なし`（この表だけ）のどれか。**振り分け**: その行を `git blame` した人が辿れるなら `note`、別の ticket の人が知らずに踏む性質なら `technical-reference`（`PDH-AGENTS.md`「保留した ticket には…」の «恒久的な地雷»）
- 判定が `起票` なら、その ticket 名（Checklist の `起票:` 行と同じ名前）
- 判定が `採用` と `棄却` なら `—`

判定が `起票` の行は、close の前にその ticket を `./ticket.sh new` で作り、note の `## Checklist` に `- [ ] 起票: <anchor> → <ticket 名>` を 1 行書く。`scripts/check-pdh-ticket.sh` が `→` の後の名前の ticket が `tickets/` か `tickets/done/` に実在するかを確かめ、`require_checklist` が未了の間 close を拒否する。
