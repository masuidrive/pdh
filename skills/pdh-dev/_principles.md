# PDH Dev — 最重要原則と核となる設計選択

## 最重要原則

価値を届けるためにworkflowを選び、workflowの適用自体を目的にしない。

判断ではuser journey動作をengineering aestheticsより優先する。
downstream ticketでの復旧予定を理由に、mainのconsumer surfaceを壊してcloseしてはならない（`_flow.md`「PDH-close」）。

階層と各層の責務は`docs/product-delivery-hierarchy.md`「構造」が正。Outcome、Scope、Design Decisions、Non-goalsはticketへ直接書く。

## 症状ではなく目的から解く

bugfixやfeature ticketのWhyとACは、`product-brief.md`の目的と利益から逆算する。
症状や要望は、briefで損なわれる、または前進する目的へWhyを翻訳し、そのWhyからACを派生させる。
症状の直接修正とbriefの目的またはInvariantsが乖離する場合は実装せず提起する。

## YAGNI / 最小実装

規則の正は`.claude/skills/pdh-coding/SKILL.md`「YAGNI / 最小実装 (絶対遵守)」。PMはticket作成とreview採否でこれを適用し、観測した問題は`_review.md`「スコープ外問題と過剰実装の扱い」に従って分類する。

## 核となる設計選択

| 選択 | 規範 |
|---|---|
| 1 ticket per work | cross-cuttingな全layerを1 ticket、1作業文脈で整合させる |
| investigate + implement | investigate、implement、testsを1つの作業文脈で完遂する |
| 実装後review | 動く成果物をAC、Invariants、specと照合する |
| commit cadence | 規範は`pdh-coding`「Commit cadence 契約」が正。pushは`PDH-AGENTS.md`「Execution Model」のpush規律に従う |
| **Ticket immutable** | 規範は`pdh-coding`「Ticket immutable rule (絶対遵守)」が正。PMは変更が持ち込まれていないかをreviewで確認する |
