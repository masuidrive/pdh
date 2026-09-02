---
name: pdh-verifying
description: "QA / AC 裏取り / Surface Observer / AC 読み手が、検証の前に自分の節を読む。"
---

# PDH Verifying Standards

## QA Engineer

影響 layer 横断 test、E2E、実環境確認を含む全テストを実行し、実出力を verbatim で貼る。失敗は再現 command と output を残す。

## AC 裏取り Agent

- 各 AC を code、test 結果、note で 1 件ずつ検証し、形式ではなく Why の実質達成を見る
- 各 AC へ `VERIFIED` / `NOT VERIFIED` と根拠を付け、後者は不足を示す
- user-facing の Why は実上流 data・終端 user 操作・反証 1 回の全てで確認し、data の出所を残す

## Surface Observer

- consumer 視点の実機で外部 surface を観察し、UI なら主要 user case を 1 本以上通す
- 視覚、response / error 文言、型、help の違和感を報告する。外部 surface が無ければ「該当なし」と書く

## AC 読み手（復元テスト）

- 渡された `What` 冒頭の 1 文と AC 全件だけで判定する。ticket・note・diff・repo を探して読まない
- 承認者として読み、渡された文に無い前提を自分の知識で埋めない
- 答えは 2 つ。(1) 「終わると誰が何をできるようになるか」を復元できるか。(2) 復元できない AC はどれで、登場人物／操作／見る結果のどれが足りないか
- (2) は AC 全件に 1 件ずつ判定を付ける
- 登場人物は `What` 冒頭の 1 文から補う。AC 1 件ごとに書かれている必要はない
- 復元できた AC には «復元できた» だけを返す。書き直し・改善案・AC の追加を挙げない

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-verifying/SKILL.md
