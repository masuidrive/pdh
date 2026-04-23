# pdh-flowchart PRD

## 1. 概要

`pdh-flowchart` は、`pdh-dev` の進行ルールを実行可能なフローチャートとして扱うためのランタイムである。Claude Code と Codex を共通の実行モデルで扱い、Docker 上の隔離環境で、実装・レビュー・修正・人間承認を伴う開発フローを状態機械として再現する。

本プロダクトの目的は、既存の `pdh-dev` / `tmux-director` の価値である以下を維持しながら、進行管理の信頼性と再開性を高めることにある。

* step と gate を明示的に管理すること
* gate を満たすまで完了扱いしないこと
* `current-note.md` / `current-ticket.md` を進行の正本として扱うこと
* Claude Code / Codex のどちらでも同じ進行モデルで扱えること
* 「今何をしているか」がわかる進捗ログを見られること

`pdh-flowchart` は汎用オーケストレータではなく、`pdh-dev` 系の flow semantics を中心にした専用 runtime として設計する。

---

## 2. 背景

現状の `pdh-dev` / `tmux-director` には以下の強みがある。

* Epic / Ticket / step の責務が明確
* ユーザー承認が必要な箇所が明示されている
* 実装よりも進行管理の意味づけが強い
* ノートとチケットが進捗の正本として機能している

一方で、以下の課題がある。

1. 実行主体が tmux 監視や対話フローに強く依存している
2. Claude Code と Codex を対称に扱いにくい
3. 再開、失敗時の復旧、ログ収集が運用に依存しやすい
4. 実装→レビュー→修正ループの再現性が担当者依存になりやすい
5. 進捗の可視化が pane 監視ベースになりやすい

既存の汎用 orchestrator は一部近い機能を持つが、`pdh-dev` の gate semantics と note/ticket 中心運用をそのまま表現するには不足がある。そのため、`pdh-flowchart` は flowchart runtime として自前で持つ。

---

## 3. プロダクトビジョン

### 3.1 ビジョン

`pdh-dev` の開発フローを「人が読むルール」から「機械が実行・停止・再開できる状態機械」へ変換する。

### 3.2 提供価値

* 開発フローの再現性を高める
* Claude Code / Codex の違いを吸収する
* gate の厳密さを落とさずに自動化範囲を広げる
* 人間承認が必要な箇所を明示的に止める
* 実行ログと状態を保存し、途中から安全に再開できるようにする

---

## 4. 対象ユーザー

### Primary User

* `pdh-dev` を使って AI 支援開発を進める開発者
* Claude Code と Codex を使い分けたいエンジニア
* flow ごとの状態遷移と gate を重視する開発者

### Secondary User

* 実装とレビューの進捗を確認したいレビュアー
* 途中経過を見ながら承認判断したいプロジェクトオーナー

---

## 5. 解決したい課題

### 5.1 機能課題

* flowchart の各 step を実際に実行できない
* `AskUserQuestion` 相当の人間 gate をランタイム上で明示的に扱えない
* Claude Code / Codex で実行モデルが異なり、運用ルールが分岐しやすい
* note/ticket 更新の責務が曖昧になりやすい

### 5.2 運用課題

* tmux pane 監視に依存すると再現性とデバッグ性が低くなる
* エラーや中断時にどこから再開すべきかが明確でない
* 「進んでいる感」が弱い、もしくは provider 依存の見え方になる

---

## 6. 目標

### 6.1 Product Goals

1. `pdh-dev` の主要 step を状態機械として実行できる
2. Claude Code / Codex の両方を同一フロー上で切り替えられる
3. 人間承認を正式な状態として扱える
4. 進捗ログを共通フォーマットで表示できる
5. 中断後に step 単位で再開できる
6. note/ticket を自動更新できる

### 6.2 Success Metrics

* `PD-C-3` から `PD-C-10` までを手動補助なしで通せる割合
* 中断後に正しい step から再開できる割合
* provider 差分によるフロー失敗率
* 実行中の progress view に対するユーザー満足度
* note/ticket 更新漏れ件数

---

## 7. 非目標

以下は初期バージョンでは対象外とする。

* 汎用 multi-agent platform になること
* 任意の開発フロー記法を広くサポートすること
* GUI first のフルプロダクトを最初から作ること
* Slack / GitHub / PR 作成など外部 SaaS 連携の全面対応
* 高度な自律計画生成そのもの
* tmux pane 監視をコア依存にすること

---

## 8. プロダクト原則

1. **gate は意味的に厳密であること**
   モデルが「終わった」と言っても gate を満たさなければ完了扱いしない。

2. **進行の正本を持つこと**
   実行状態、note/ticket、artifacts の対応が追跡できること。

3. **provider を隠蔽しすぎないこと**
   Claude / Codex の違いは吸収しつつ、実行ログから判別できること。

4. **中断と再開を前提にすること**
   長時間実行は必ず失敗や停止がある前提で設計する。

5. **Docker 前提で権限確認を減らすこと**
   permission bypass を許容する代わりに、実行環境を隔離する。

---

## 9. 主要ユースケース

### UC-1: Ticket 実装フローを回す

ユーザーは `pdh-flowchart` に Ticket を渡し、`PD-C-3` 以降の flow を開始する。runtime は step ごとに適切な provider を選択し、実装、レビュー、修正を進める。

### UC-2: ユーザー承認で止める

runtime は `PD-C-5` または `PD-C-10` 相当の gate に到達した時点で停止し、必要な要約・根拠・変更ファイルを提示したうえで承認待ちに入る。

### UC-3: 中断後に再開する

コンテナ再起動や provider エラーの後、runtime は保存済み state を読み込み、直前の step から再開する。

### UC-4: 実行中の進捗を見る

ユーザーは provider に依らない progress view で、いま何をしているか、どの step にいるか、何ファイル変わったかを見られる。

### UC-5: レビュー結果に応じて自動で差し戻す

review step で NG が出た場合、runtime は fix step に戻し、再レビューへ遷移する。

---

## 10. MVP スコープ

初期バージョンでは以下に限定する。

### In Scope

* `PD-C-3` 〜 `PD-C-10` の最小サポート
* Claude Code / Codex の 2 provider 対応
* Docker コンテナ内での実行
* permission bypass 前提の運用
* YAML ベースの最小 flow 定義
* step 状態保存と resume
* progress event の標準化
* `current-note.md` / `current-ticket.md` の更新サポート
* 人間承認 state

### Out of Scope for MVP

* Epic 全体フローの完全対応
* 複数 reviewer の並列分散実行
* Web UI フル実装
* 任意 provider plugin marketplace
* 高度な分岐 DSL

---

## 11. 機能要件

### 11.1 Flow 定義

システムは flow を宣言的に記述できなければならない。

最低限必要な項目:

* `step.id`
* `step.mode` (`read`, `edit`, `review`)
* `step.provider` (`claude`, `codex`)
* `prompt` または prompt template
* `on_success`
* `on_failure`
* `on_human`
* `guards`

### 11.2 State Machine

システムは step ごとの状態を持たなければならない。

最低限の状態:

* `pending`
* `running`
* `needs_human`
* `failed`
* `completed`
* `blocked`

### 11.3 Guard Evaluation

システムは provider の自己申告ではなく、外部検証可能な条件で step 完了を判断しなければならない。

例:

* 指定ファイルが更新されたか
* テストが成功したか
* note/ticket が更新されたか
* reviewer レポートが生成されたか
* ユーザー承認を受けたか

### 11.4 Provider Adapters

システムは Claude Code と Codex を共通インターフェースで扱わなければならない。

共通で扱う対象:

* 実行開始
* ストリーミングイベント
* tool 実行イベント
* message
* エラー
* 完了
* resume

### 11.5 Progress Logging

システムは provider 非依存の progress event を生成し、CLI または将来の UI で表示できなければならない。

最低限の progress event:

* step started
* status
* message
* tool started / finished
* file changed
* retry
* ask human
* step finished

### 11.6 Human Gate

システムは人間による承認を正式な状態として扱わなければならない。

必要な操作:

* approve
* reject
* request changes
* cancel

### 11.7 Persistence / Resume

システムは実行履歴、step 状態、resume token、artifacts を永続化しなければならない。

### 11.8 Note / Ticket Integration

システムは `current-note.md` と `current-ticket.md` を読み書きしなければならない。差分確認は `git diff` と実行 artifact に集約する。

---

## 12. 非機能要件

### 12.1 実行環境

* Docker コンテナ内で動作すること
* 外側で repo と credential を管理できること
* provider 実行に必要な環境変数を受け取れること

### 12.2 セキュリティ

* permission bypass は Docker 内でのみ許容する
* ホストを直接壊さない構成を前提とする
* 実行ログに機密値を不用意に残さない

### 12.3 信頼性

* provider エラーで step 全体が即消失しないこと
* 中断後に再開可能であること
* 少なくとも step 単位で冪等に再実行できること

### 12.4 可観測性

* raw provider log を保存すること
* normalized progress log を保存すること
* 最終 summary と変更ファイル一覧を保存すること

---

## 13. 想定アーキテクチャ

### 13.1 コンポーネント

1. **Flow Engine**
   flow 定義の読込、step 遷移、guard 評価を担当する。

2. **Provider Adapter Layer**
   Claude / Codex の実行差分を吸収する。

3. **State Store**
   実行状態、resume 情報、artifacts を永続化する。

4. **Progress Bus**
   provider event を正規化し、CLI/UI へ流す。

5. **Repo Integration Layer**
   `current-note.md` / `current-ticket.md` の更新、必要コマンド実行を担当する。

6. **Human Gate Interface**
   承認待ち状態の取得と応答入力を担当する。

### 13.2 実行モデル

* runtime が step を選択
* provider adapter に prompt と context を渡す
* adapter が stream event を返す
* Flow Engine が guard を評価
* 条件に応じて `next step` または `needs_human` に遷移
* state と logs を保存

---

## 14. UX / CLI 要件

MVP では CLI を主要インターフェースとする。

### コマンド例

* `pdh-flowchart run ticket-123`
* `pdh-flowchart status run-001`
* `pdh-flowchart approve run-001`
* `pdh-flowchart reject run-001 --reason "Need more tests"`
* `pdh-flowchart resume run-001`

### 実行中表示要件

ユーザーは以下を常に確認できる必要がある。

* 現在の step
* 現在の provider
* 現在の mode
* 直近メッセージ
* 実行中コマンド
* 変更ファイル
* 次に人間入力が必要かどうか

---

## 15. 初期 provider 戦略

### Claude Code

* review 系 step に優先採用しやすい
* partial message により「読んでいる感」を出しやすい
* 再開やストリーム表示を重視する

### Codex

* implement 系 step に優先採用しやすい
* command / file change / plan update のイベント粒度が細かい
* 実装進捗の可視化に向く

### 初期方針

* `implement`: Codex を優先
* `review`: Claude を優先
* provider は step 単位で切り替え可能にする

---

## 16. リスク

1. **provider 抽象化が薄すぎると実装差分が漏れる**
   → adapter interface を厳密にし、raw log を残す。

2. **gate 判定が甘くなると `pdh-dev` の価値を損なう**
   → guard は外部検証可能条件を優先する。

3. **resume が壊れると長時間実行に耐えない**
   → step 単位再実行を前提に設計する。

4. **note/ticket 更新が不完全だと進行の正本が崩れる**
   → 更新を step guard に含める。

5. **Docker 運用が雑だと bypass が危険になる**
   → コンテナ設定を標準化する。

---

## 17. 代替案と判断

### A. TAKT を採用する

長所:

* 既に workflow engine がある
* provider abstraction がある
* レビュー / 修正ループが強い

短所:

* `pdh-dev` 固有の gate semantics を中心に据えにくい
* 外部 runtime の中心として使うには抽象化の境界が合わない可能性がある

### B. tmux-director を拡張する

長所:

* 既存の運用と近い
* 手元の感覚に近い

短所:

* pane 監視依存が残る
* 再開性と可観測性を伸ばしにくい

### C. 自前 flowchart runtime を作る

長所:

* `pdh-dev` semantics を中心に設計できる
* Claude / Codex を対称に扱いやすい
* gate / note / ticket を一級概念にできる

短所:

* 初期実装コストがある
* provider 差分吸収を自分で持つ必要がある

**本 PRD は C を選択する。**

---

## 18. ロードマップ

### Phase 0: 技術検証

* Claude / Codex の adapter 最小実装
* stream event 正規化
* Docker での bypass 実行確認

### Phase 1: MVP

* `PD-C-3` 〜 `PD-C-10` の最小 flow
* CLI 実行
* state 保存
* human gate
* progress log

### Phase 2: 実運用対応

* review/fix loop 強化
* note/ticket 更新の自動化強化
* provider 切り替えポリシー改善
* エラー回復改善

### Phase 3: 拡張

* Epic フロー対応
* Web UI
* 複数 reviewer 並列

---

## 19. オープンクエスチョン

1. review step で複数 reviewer を MVP に含めるか
2. human gate は CLI のみで十分か、簡易 Web UI を先に入れるか
3. repo ごとの差分設定をどう吸収するか

---

## 20. 付録: MVP の最小フロー例

```yaml
flow: pdh-ticket-core
initial: PD-C-3
steps:
  - id: PD-C-3
    provider: codex
    mode: read
    on_success: PD-C-5

  - id: PD-C-5
    provider: claude
    mode: review
    on_human: PD-C-6

  - id: PD-C-6
    provider: codex
    mode: edit
    on_success: PD-C-7

  - id: PD-C-7
    provider: claude
    mode: review
    on_success: PD-C-9
    on_failure: PD-C-6

  - id: PD-C-9
    provider: codex
    mode: edit
    on_success: PD-C-10

  - id: PD-C-10
    provider: claude
    mode: review
    on_human: COMPLETE
```

この例では、実装は Codex、レビューは Claude を基本とし、人間承認を `PD-C-5` と `PD-C-10` で挟む。MVP ではこのレベルの単純さから始める。
:
:`
