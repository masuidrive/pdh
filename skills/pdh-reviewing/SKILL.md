---
name: pdh-reviewing
description: "PDH Review Standards: reviewer worker が review 時に参照するルール。review を始める前に最初にこのスキルを読むこと。"
---

# PDH Review Standards

## 絶対規則（review 全体で厳守）

- **read-only**: product code・test・doc・note を変更しない。書いてよいのは `<RESULT_FILE>` と `<TMP_DIR>` だけ（spawn prompt の「書き込み境界」）
- **対象commit SHAを結果へ明記し、その後のcommitをreview済み扱いしない**
- **Severityの定義は`PDH-AGENTS.md`「Verification」に従い、自己流のrubricを作らない**
- **該当観点は 1 finding で止めず、同種 pattern を系統的に全探索する**（下「網羅探索チェックリスト」）
- **渡されていない ticket / note / review 結果を探して読まない**
- **問題がなければ`No Critical/Major`と明記する。**失敗・中断時も理由を `<RESULT_FILE>` へ書き、無言終了しない

## 作業開始手順

1. promptとticketから変更目的とdiff scopeを把握する（レンズ1は ticket を持たないため、prompt に転記された Why から目的を把握する）
2. ticketに独断の変更が入っていないか確認する（AC・Architectural Invariants・Out-of-scope の再合意なき変更。レンズ1は行わない）

## 網羅探索チェックリスト

- 同名symbol sweep：変更identifier、field、endpoint、config keyをcodebase全体で探す
- 対称関係：input/output、sync/async、read/write、migration/rollbackなどの片側未追従を探す
- 継承と派生：base type、interface、schema変更時にsubclass、implementation、derived schemaを確認する
- 境界層の伝搬：internal、facade、wrapper、adapter、generated layer、public docsへの必要な伝搬を確認する
- test追従：test、mock、fixture、stub、hardcoded expectationを確認する
- test到達可能性：client JS、generated string、template内logicをtestからimportできるか確認する
- doc sweep：old identifier、path、enumがdoc、spec、README、comment、sample、changelogに残っていないか確認する。technical-reference.mdがある場合はdiffと突合し、更新漏れや虚偽の「該当なし」がないか確認する
- domain固有対称性：state transition、concurrency、locking、retry、idempotency、error、cleanup、observability、auth boundaryを必要に応じ確認する

finding冒頭へ`[同名 symbol sweep]`等の観点labelを付ける。非該当観点はskipできる。

## レンズごとの確認内容

### レンズ1 — Why end-to-end（無バイアス）

この役は prompt に転記された Why と、repo の現在の作業 tree だけを前提とする。

- Whyがrepoの実装で端から端まで成立するかを、現実的な分岐（権限差、tenant横断、session状態、成功と失敗、初回と再訪）で追跡する
- 独断変更の確認と、diff起点の網羅探索checklistは行わない

### レンズ2 — AC conformance + AC 妥当性（通常 reviewer が diff とともに実施）

ticketに変更記録のある確定判断は、変更後の内容で対応づける。⚠ **確定判断の変更に再合意が無いことを欠陥にしない** — 記録を残せば書き換えてよい（再合意が要るのはAC・Architectural Invariants・Out-of-scope）。

### persona / coverage マトリクス（両レンズ必須）

両lensは、権限差、tenant横断、session状態、成功と失敗、初回と再訪など、現実的な全分岐で確認する。

## 修正確認 attempt

- **修正が直前の性質を壊していないかを最初に見る**（前後出力を突き合わせる。記録が無ければ、無いことをfindingとする。実装側の規則は`pdh-coding` skill「指摘を直すとき、壊していないことを反例で固定する」）。指定findingの解消判定はそのあとでよい
- 修正が直接生んだCriticalまたはMajor regressionだけを元findingと分けて報告する

## 報告形式

- CriticalとMajorを優先し、観点label、file:location、問題、推奨対応の形式で報告する
- findingは`<RESULT_FILE>`へ報告するだけでよい。noteの`### Findings`表へ書くのはPMである

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-reviewing/SKILL.md
