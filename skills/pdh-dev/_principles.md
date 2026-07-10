# PDH Dev — 最重要原則と核となる設計選択

## 最重要原則

**価値を届けるために workflow を選ぶ。workflow を当てはめるために workflow を回すのではない。**

**user journey 動作 > engineering aesthetics**。「user が今何ができるようになるか」が常に第一基準。clean break migration / interface dataclass / DD invariant fidelity / registry value alignment / 後方互換削除 などの engineering 美学は、user journey が壊れないことを担保した上でのみ追求する。close gate で「downstream ticket で復旧予定」と引き換えに main の consumer surface を壊すことは、user journey を engineering aesthetics で犠牲にする典型例で禁止 (詳細は `_flow.md` `PDH-close`)。

階層:
- **Product Brief** = 人間の意思。解きたい問題と目指す状態。常に最上位
- **Ticket** = 実装単位。常に存在する

**Epic 概念は持たない。** 1 user + AI scale では Epic の同期 / coordination 価値より overhead cost の方が高い。Epic に書くべき情報 (Outcome / Scope / Design Decisions / Non-goals) は ticket に直接書く。

## 症状ではなく目的から解く

**バグ修正・機能追加の ticket は、症状や要望の文面をそのままなぞるのではなく、`product-brief.md` の目的・利益から逆算して Why と AC を組み立てる。**

- Issue が「X が動かない」「X を追加して」と症状/要望ベースで来ても、ticket の Why は「product-brief のどの目的・どの利益が損なわれているか／前進するか」に翻訳してから書く。AC はその Why から派生させる。
- 翻訳した結果、報告された症状の直接修正と product-brief の目的が乖離する場合 (例: 症状の直し方が brief の Invariants と衝突する、より根本の場所で直す方が brief の目的に合致する) は、**実装に進まず提起**する。場当たり修正で症状だけ消して目的を満たさない方向に進めない。
- *理由*: 症状ベースの修正は、同じ根本原因の再発・brief との不整合・「直したつもりで価値が動いていない」を生む。Why が product-brief に接続されていれば、`PDH-review` と `PDH-verify` で「目的を満たしたか」を判定でき、close の意味が定まる。

## YAGNI / 最小実装

**AC を満たす最小の変更で止める。仮定の将来要件のために設計しない。**

- 抽象化・拡張点・設定・汎用化を先回りで足さない。AC に無い機能・オプション・防御コードを足さない。必要になったら**その時** ticket を切る。
- 「実際に観測した問題」は無視せず記録し、`_review.md` §スコープ外の既存問題の因果基準で **current ticket で直すか follow-up にするか分類する**。「観測していない将来問題」のための設計はしない。この対比が境界線。
- *理由*: 投機的拡張はレビューと修正を長引かせ、未使用コードが負債化し、「ticket の意思 (AC)」と実装が乖離する。スコープ規律は ticket 増殖（過剰なチケット切り出し含む）も抑える。

## 核となる設計選択

| 選択 | 理由 |
|---|---|
| **1 ticket per work** | cross-cutting changes を複数 ticket に切ると layer 間整合性が完成時にしか取れず、複数の plan-vs-real-code 不整合が並列発生する。1 ticket なら 1 作業文脈で全 layer を見ながら整合性を取れる |
| **1 作業文脈が investigate + implement** | 「実コードを読み計画を書く」段と「再度実コードを読み実装する」段の 2 段階分離は、計画段で生じた盲点を計画と実装の両方に伝播させる anti-pattern。同一作業文脈が実コードを読みながら実装すれば計画と実コードは自動的に整合 |
| **実装後 review のみ** | 実装前 (plan review) は「計画書 vs 計画書」の内部整合性しか検証できない。実装後 (code review) は「動くコード vs AC / Invariants / spec」の実質整合性を検証できる |
| **commit cadence (mega-commit 禁止)** | 論理単位の境界ごとに commit し、bisect / partial rollback / 段階追跡と中断耐性を確保する。狙いは commit 数ではなく mega-commit 回避と state 遷移 (blocker 等) の durable 化。「全変更を 1 commit に押し込む」は事後分析不能。push は `CLAUDE.md` の no-push-without-request ルールに従う |
| **Ticket immutable** | implementor が AC / out-of-scope / Architectural Invariants を勝手に書き換えると、ticket が "意思決定者の意思" を持たなくなり ticket 自体の価値が消失する。変更が必要なら implementation を止めてエスカレーション |
