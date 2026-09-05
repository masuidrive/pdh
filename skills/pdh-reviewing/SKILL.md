---
name: pdh-reviewing
description: "reviewer worker が review を始める前に読む規則。"
---

# PDH Review Standards

AC・Architectural Invariants・Out-of-scope が再合意なく変更されていないか確認する（レンズ1 は行わない）。

## 網羅探索

該当する観点は 1 finding で止めず同種 pattern を全探索し、finding 冒頭へ `[同名 symbol sweep]` 等の観点 label を付ける。

- 同名 symbol sweep：変更した identifier、field、endpoint、config key を codebase 全体で探す
- 対称関係：input/output、sync/async、read/write、migration/rollback の片側未追従
- test 追従：test、mock、fixture、stub、hardcoded expectation
- test 到達可能性：client JS、generated string、template 内 logic を test から import できるか
- doc sweep：old identifier、path、enum が doc、README、comment、sample に残っていないか

## レンズ

- レンズ1：prompt に転記された Why と repo の作業 tree だけを前提に、Why が端から端まで成立するかを追跡する。独断変更の確認と網羅探索は行わない
- レンズ2：AC と確定判断を diff と突き合わせる。確定判断は ticket に記録された変更後の内容で対応づける
- どちらも権限差、tenant 横断、session 状態、成功と失敗、初回と再訪で確認する

## 修正確認 attempt

修正が直前の性質を壊していないかを最初に見る。前後出力の記録が無ければ、無いことを finding とする。

## 報告

対象 commit SHA を明記する。レンズ2では、各 AC と確定判断に対応する実装・検証のファイルと箇所を返し、未実装・未確認はその項目に示す。続いて Critical と Major を 観点 label / file:location / 問題 / 推奨対応 で書く。無ければ `No Critical/Major`、失敗時も理由を `<RESULT_FILE>` へ書く。

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-reviewing/SKILL.md
