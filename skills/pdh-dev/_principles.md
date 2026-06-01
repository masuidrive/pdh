# PDH Dev — 最重要原則と核となる設計選択

## 最重要原則

**価値を届けるために workflow を選ぶ。workflow を当てはめるために workflow を回すのではない。**

**user journey 動作 > engineering aesthetics**。「user が今何ができるようになるか」が常に第一基準。clean break migration / interface dataclass / DD invariant fidelity / registry value alignment / 後方互換削除 などの engineering 美学は、user journey が壊れないことを担保した上でのみ追求する。close gate で「downstream ticket で復旧予定」と引き換えに main の consumer surface を壊すことは、user journey を engineering aesthetics で犠牲にする典型例で禁止 (詳細は `_flow.md` PD-C-10)。

階層:
- **Product Brief** = 人間の意思。解きたい問題と目指す状態。常に最上位
- **Ticket** = 実装単位。常に存在する

**Epic 概念は持たない。** 1 user + AI scale では Epic の同期 / coordination 価値より overhead cost の方が高い。Epic に書くべき情報 (Outcome / Scope / Design Decisions / Non-goals) は ticket に直接書く。

## YAGNI / 最小実装

**AC を満たす最小の変更で止める。仮定の将来要件のために設計しない。**

- 抽象化・拡張点・設定・汎用化を先回りで足さない。AC に無い機能・オプション・防御コードを足さない。必要になったら**その時** ticket を切る。
- 「実際に観測した問題」は直す（→ `_review.md` §スコープ外の既存問題）。「観測していない将来問題」のための設計はしない。この対比が境界線。
- *理由*: 投機的拡張は review loop を膨らませ、未使用コードが負債化し、「ticket の意思 (AC)」と実装が乖離する。スコープ規律は ticket 増殖（過剰なチケット切り出し含む）も抑える。

## 核となる設計選択

| 選択 | 理由 |
|---|---|
| **1 ticket per work** | cross-cutting changes を複数 ticket に切ると layer 間整合性が完成時にしか取れず、複数の plan-vs-real-code 不整合が並列発生し review loop が収束しなくなる。1 ticket なら 1 作業文脈で全 layer を見ながら整合性を取れる |
| **1 作業文脈が investigate + implement** | 「実コードを読み計画を書く」段と「再度実コードを読み実装する」段の 2 段階分離は、計画段で生じた盲点を計画と実装の両方に伝播させる anti-pattern。同一作業文脈が実コードを読みながら実装すれば計画と実コードは自動的に整合 |
| **実装後 review のみ** | 実装前 (plan review) は「計画書 vs 計画書」の内部整合性しか検証できない。実装後 (code review) は「動くコード vs AC / Invariants / spec」の実質整合性を検証できる |
| **commit cadence 5+ 必須** | 実装後 review で bisect / partial rollback / 段階追跡を可能にする。「全変更を 1 commit に押し込む」は事後分析不能 |
| **Ticket immutable** | implementor が AC / out-of-scope / Architectural Invariants を勝手に書き換えると、ticket が "意思決定者の意思" を持たなくなり ticket 自体の価値が消失する。変更が必要なら implementation を止めてエスカレーション |
