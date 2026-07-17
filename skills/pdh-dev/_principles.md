# PDH Dev — 最重要原則と核となる設計選択

## 最重要原則

価値を届けるためにworkflowを選び、workflowの適用自体を目的にしない。

判断ではuser journey動作をengineering aestheticsより優先する。
downstream ticketでの復旧予定を理由に、mainのconsumer surfaceを壊してcloseしてはならない（`_flow.md`「PDH-close」）。

階層は次の2つだけとする。

- Product Brief：人間の意思であり、常に最上位に置く
- Ticket：実装単位であり、常に存在させる

Epic概念は持たない。
Outcome、Scope、Design Decisions、Non-goalsはticketへ直接書く。

## 症状ではなく目的から解く

bugfixやfeature ticketのWhyとACは、`product-brief.md`の目的と利益から逆算する。
症状や要望は、briefで損なわれる、または前進する目的へWhyを翻訳し、そのWhyからACを派生させる。
症状の直接修正とbriefの目的またはInvariantsが乖離する場合は実装せず提起する。

## YAGNI / 最小実装

ACを満たす最小変更で止め、仮定の将来要件を設計しない。
ACにない抽象化、拡張点、設定、汎用化、機能、option、防御コードを先回りで足さない。
実際に観測した問題は記録し、`_review.md`「スコープ外問題と過剰実装の扱い」に従ってcurrent ticketで直すかfollow-upかを分類する。
観測していない将来問題のための設計はしない。

## 核となる設計選択

| 選択 | 規範 |
|---|---|
| 1 ticket per work | cross-cuttingな全layerを1 ticket、1作業文脈で整合させる |
| investigate + implement | investigate、implement、testsを1つの作業文脈で完遂する |
| 実装後review | 動く成果物をAC、Invariants、specと照合する |
| commit cadence | 論理単位ごとにcommitし、mega-commitを禁止する。blocker等のstate遷移もdurableに残す。pushは`CLAUDE.md`のno-push-without-requestに従う |
| **Ticket immutable** | implementorはAC、Out-of-scope、Architectural Invariantsを変更しない。必要なら実装を止めてescalateする |
