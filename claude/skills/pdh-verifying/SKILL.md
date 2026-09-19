---
name: pdh-verifying
description: "QA / AC 裏取り / Surface Observer / AC 読み手が、検証の前に自分の節を読む。"
---

# PDH Verifying Standards

## QA Engineer

影響 layer 横断 test、E2E、実環境確認を含む全テストを実行し、実出力を verbatim で貼る。失敗は再現 command と output を残す。

**⚠ test と E2E だけではない。`pdh-coding` の gate のうち機械で回せるものを、実装者の代わりに回して実出力を貼る。**

守るのは、**実装者が «通したつもり» で飛ばした gate が、出荷前に 1 つも残らないこと**である。⚠ **実装者は完成へ向かって急ぐので、自分の gate を採点する役には向かない。**別の worker が回すと、その動機が無い。

- **doc sweep** — 変更した identifier / field / API path / enum 値の旧名を、doc・spec・README・sample・comment で grep し、**出力をそのまま貼る**（0 件なら 0 件と貼る）
- **実 provider / 外部 API を経由する path** — 1 経路以上を実 API で叩き、**status と body 抜粋を貼る**。credential が無ければ「無い」と書く（自己判断で skip しない）
- **終端のユーザ操作** — リンク・通知・画面遷移・外部副作用が目的なら、**着地まで実際に操作する**。「描画された」で終えない。⚠ **途中で URL や port を手で書き換えたなら、それは finding である**（書き換えないと着かない状態が出荷される）
- **修正の前後出力** — 採用した指摘の修正について、`pdh-coding`「指摘を直すときは、壊していないことを反例で固定する」が要求する前後の出力が揃っているか確かめ、**無ければ「無い」と報告する**
- ⚠ **恒久テストが追加・変更されているなら、そのテスト自身を検査する**（下の「追加された恒久テストの検査」）

### 追加された恒久テストの検査

⚠ **恒久テストの追加は高リスク変更として扱う。**実測（2026-09-19 に 1 ticket で数えた）では、修正が持ち込んだ Critical / Major 5 件のうち **3 件が追加したテスト自身の欠陥**だった — 契約違反・共有 state への干渉・flaky。**製品コードではなく、テストが壊していた。**

- repo が test の**契約テスト**を持つなら、それを回す（「この test はこの marker を宣言していること」等）
- **追加・変更したテストだけを 3 回連続で実行する。**⚠ **1 回通っただけでは flaky を見つけられない。**全体スイートを待つ必要はなく、対象だけなら数分で済む
- テストが**失敗するはずの経路で «成功» と記録できないか**を見る（取得に失敗したのにローカルのファイルを読んで通る、等）

## AC 裏取り Agent

- 各 AC を code、test 結果、note と progress で 1 件ずつ検証し、形式ではなく Why の実質達成を見る
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

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/claude/skills/pdh-verifying/SKILL.md
