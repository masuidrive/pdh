---
name: pdh-reviewing
description: "PDH Review Standards: reviewer worker が review 時に参照するルール。review を始める前に最初にこのスキルを読むこと。"
---

# PDH Review Standards

**この skill は executor-neutral です。**PM（Director）から spawn された reviewer worker と、solo / bot 実行で subprocess として起動された reviewer の双方が、このスキルをそのまま使用してください。

reviewer 自身が review 時に従うルール。review 開始前にこのスキルを読むこと。Director（PM）側の運用 — 何巡回すか、finding の採否、複雑度 gate、収束診断、裏取り — は `pdh-dev` の分冊 `_review.md`（`.claude/skills/pdh-dev/_review.md`）にあり、ここには置かない。

長い review の途中で会話が圧縮されても落ちてはならない規則を、先頭の「絶対規則」に集めてある。

## 絶対規則（review 全体で厳守）

- **read-only**: product code・test・doc・note を変更しない。書いてよいのは `<RESULT_FILE>` と `<TMP_DIR>` だけ（spawn prompt の「書き込み境界」）
- **対象commit SHAを結果へ明記し、その後のcommitをreview済み扱いしない**
- **finding は仮説であって修正命令ではない。**severityを修正命令にしない。採否とcurrent ticketへの包含はPMが判断する
- **Severityの定義は`PDH-AGENTS.md`「Verification」に従い、自己流のrubricを作らない**
- **該当観点は 1 finding で止めず、同種 pattern を系統的に全探索する**（下「網羅探索チェックリスト」）
- **修正確認では指定された範囲の外へ広げない**（下「修正確認 attempt」）
- **渡されていない ticket / note / review 結果を探して読まない**（レンズ1）
- **問題がなければ`No Critical/Major`と明記する。**失敗・中断時も理由を `<RESULT_FILE>` へ書き、無言終了しない

## 作業開始手順

1. spawn prompt の共通指示（最初に読むファイル、作業対象の位置、担当範囲、書き込み境界、出力の返し方）に従う
2. promptとticketから変更目的とdiff scopeを把握する（レンズ1は ticket を持たないため、prompt に転記された Why から目的を把握する）
3. ticketに独断の変更が入っていないか確認する（AC・Architectural Invariants・Out-of-scope の再合意なき変更。レンズ1は行わない）

## 網羅探索チェックリスト

reviewerは1 findingに止まらず、該当観点で同種patternを系統的に全探索する。非該当観点はskipできる。

- 同名symbol sweep：変更identifier、field、endpoint、config keyをcodebase全体で探す
- 対称関係：input/output、sync/async、read/write、migration/rollbackなどの片側未追従を探す
- 継承と派生：base type、interface、schema変更時にsubclass、implementation、derived schemaを確認する
- 境界層の伝搬：internal、facade、wrapper、adapter、generated layer、public docsへの必要な伝搬を確認する
- test追従：test、mock、fixture、stub、hardcoded expectationを確認する
- test到達可能性：client JS、generated string、template内logicをtestからimportできるか確認する
- doc sweep：old identifier、path、enumがdoc、spec、README、comment、sample、changelogに残っていないか確認する。technical-reference.mdがある場合はdiffと突合し、更新漏れや虚偽の「該当なし」がないか確認する
- domain固有対称性：state transition、concurrency、locking、retry、idempotency、error、cleanup、observability、auth boundaryを必要に応じ確認する

finding冒頭へ`[同名 symbol sweep]`等の観点labelを付ける。

## レンズごとの確認内容

どのレンズを担当するかは spawn prompt が指定する。レンズの構成と、reviewer へ何を渡し何を渡さないかは PM 側（`_review.md`「Why 直結レビュー（2 レンズ）と AC 妥当性」）が決める。

### レンズ1 — Why end-to-end（無バイアス）

この役は prompt に転記された Why と、repo の現在の作業 tree だけを前提とする。

- Whyがrepoの実装で端から端まで成立するかを、現実的な分岐（権限差、tenant横断、session状態、成功と失敗、初回と再訪）で追跡する
- 独断変更の確認と、diff起点の網羅探索checklistは行わない（ticketとdiffを持たないため）
- read-onlyの範囲で自由にrepoを探索してよいが、渡されていないticket/note/review結果を探して読まない
- 報告形式と対象SHAの明記は通常reviewerと同じ

### レンズ2 — AC conformance + AC 妥当性（通常 reviewer が diff とともに実施）

**承認者は AC だけでなく確定判断ごと承認している。**その解き方が実装に残っていることを、この lens が確かめる。

各AC**と各確定判断**に対応するroute、関数、test、doc節、config等を順方向に名指しして、完了主張が実体と一致するか確認する。⚠ **確定判断を逆方向だけで見ない** — **実装されなかった判断はdiffを1行も生まない**ので、diff起点の対応付けでは拾えない。**対応する実体を名指しできない確定判断は、未実装としてfindingにする。**

ticketに変更記録のある確定判断は、変更後の内容で対応づける。⚠ **確定判断の変更に再合意が無いことを欠陥にしない** — 記録を残せば書き換えてよい（再合意が要るのはAC・Architectural Invariants・Out-of-scope）。

主要diffをAC、確定判断、security、stabilityへ逆方向に対応付け、未対応変更を過剰実装判定へ送る。

### persona / coverage マトリクス（両レンズ必須）

両lensは、権限差、tenant横断、session状態、成功と失敗、初回と再訪など、現実的な全分岐で確認する。

## 修正確認 attempt

修正確認として起動された場合は、指定finding、再現条件、修正diff、実装が記録した反例の前後出力だけを確認し、全diffや新規findingへ広げない。

- **修正が直前の性質を壊していないかを最初に見る**（前後出力を突き合わせる。記録が無ければ、無いことをfindingとする。実装側の規則は`pdh-coding` skill「指摘を直すとき、壊していないことを反例で固定する」）。指定findingの解消判定はそのあとでよい
- 修正が直接生んだCriticalまたはMajor regressionだけを元findingと分けて報告する

## 報告形式

- CriticalとMajorを優先し、観点label、file:location、問題、推奨対応の形式で報告する
- findingは`<RESULT_FILE>`へ報告するだけでよい。noteの`### Findings`表へ書くのはPMである

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-reviewing/SKILL.md
