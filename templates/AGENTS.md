# プロジェクト概要

`product-brief.md` と `PDH-AGENTS.md` を読むこと。`AGENTS.local.md` があれば、その環境固有 context も読むこと。

## ディレクトリ構造

<!-- プロジェクトに合わせて書き換えること -->

```text
product-brief.md                 # プロダクト概要・方針
technical-reference.md           # 現在の実装の How
docs/
  product-delivery-hierarchy.md  # Ticket 運用ルール
tickets/                         # Ticket。ticket.sh が管理する
  done/
```

## 基本方針

<!-- この project 固有の価値判断・運用規約に合わせて書き換える。PDH 共通ルールは書かない。 -->

- 時間がかかっても技術的正しさを優先する
- 文末が「？？」（? 2 回）の質問には回答だけを返し、ファイル変更やコマンド実行を始めない

## 実装品質ルール

<!-- この project で繰り返し起きた失敗だけを書く。汎用規則は pdh-coding skill に置く。 -->

## 開発環境

### サーバー起動

<!-- 実際の起動・seed・dummy login の手順を書く -->

### テスト

<!-- project 固有のテストコマンドと確認観点を書く -->

全スイートは `scripts/test-all.sh` で実行する。`--parallel` で並列実行できる。

完了報告と surface 確認の証拠要件は `PDH-AGENTS.md` に従う。テスト設計と ticket-local-test の規則は `.agents/skills/pdh-coding/SKILL.md` に従う。

## PDH (Ticket) 運用

PDH 共通ルールは `PDH-AGENTS.md`、stage flow と review 構造は `.agents/skills/pdh-dev/SKILL.md` にある。このファイルには project 固有の差分だけを書く。

### 影響範囲

チケット作成・実装計画・テスト計画では、影響する project layer を列挙する。

<!-- 例: backend · frontend · sdk · cli · e2e-test · docs -->

### 頻出レビュー指摘

<!-- project の実情に合わせて追加・削除する -->

| カテゴリ | よくある漏れ | 対策 |
|---|---|---|
| rename | import・mock・文書に旧名が残る | `rg '旧名'` で残骸を探す |
| DB migration | schema 変更に migration がない | schema と migration を同じ計画に入れる |

## Codex worker

PDH worker の通常モデルと reasoning effort は `.codex/agents/pdh-*.toml` にある。project 固有の制約だけをここに書く。

| 役割 | project 固有の制約・重点観点 |
|---|---|
| Coding Engineer | <!-- required skill、書き込み範囲など --> |
| QA Engineer | <!-- test command、fixture、E2E など --> |
| Reviewer | <!-- security、performance、compatibility など --> |
| AC 裏取り | <!-- canonical docs、必要な evidence など --> |
| Surface Observer | <!-- UI / HTTP API / SDK / CLI など --> |

通常 worker で同じ問題に繰り返し失敗した場合や、不可逆な設計判断に最高水準の推論が必要な場合だけ Astra へ escalation する。Sol 固定の `pdh-*` custom agent 定義は使わず、モデルを直接指定できる別 worker を起動し、同じ役割規則と task context を渡す。

環境固有で commit できない指示には、gitignore した `AGENTS.local.md` を使う。secret の値は書かず、取得方法や保管場所だけを書く。

# Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/templates/AGENTS.md
