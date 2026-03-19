---
name: tmux-director
description: "tmux Director: tmux上の別windowで動いているClaude Codeを監督・指示する。「tmux-director」とだけ言われた時のみ起動する。他のキーワードでは起動しない。"
---

# tmux Director — Claude Code 監督ワークフロー

tmux で動いている別 window の Claude Code を管理・監督する。

## あなたの役割

あなたは **監督（Director）** である。コードを書いたり skill を実行するのではなく、別 window で動く Claude Code（以下 window）に指示を出し、作業が正しく進んでいるか監視する。

**重要: 監視ループは Sonnet Agent に委任する。** 自分で `tmux capture-pane` を繰り返さない。

## Phase 1: ターゲット window の決定

1. tmux コマンドでこのセッションの全 window とディレクトリを取得する
   ```
   tmux list-windows -F '#{window_index}:#{window_name}:#{pane_current_path}:#{pane_current_command}'
   tmux display-message -p '#{window_index}'  # 自分の window
   ```
2. 自分以外の各 window の画面をキャプチャして内容を確認する
   ```
   tmux capture-pane -t WINDOW.PANE -p -S -50 | tail -50
   ```
3. Claude Code が動いている window を特定し、以下を AskUserQuestion で提示してユーザに選択させる:
   - window 番号（:WINDOW.PANE）
   - ディレクトリ
   - 現在の会話内容（何をしているか）
4. Claude Code window がない場合は、ユーザに新しい window を作って Claude Code を起動するよう促す

**ユーザに確認する際は、window が表示している情報（検証手段・AC・状況・懸念事項）を十分にまとめて伝えること。ユーザがこの報告だけで意思決定できるようにする。**

## Phase 2: 初期化

ターゲット window が決まったら、または新しいチケットを開始する前に、必ず以下の初期化を行う:

```
tmux send-keys -t WINDOW.PANE '/clear' Enter
```

2秒待ってから:

```
tmux send-keys -t WINDOW.PANE '**重要** 以後ずっとAskUserQuestionツールは絶対に使わず、自分で選択肢を返答で維持すること' Enter
```

**重要**: 新しいチケットを始める時は、必ず `/clear` → 上記メッセージ → `/pdh-dev` の順で送信すること。コンテキストが蓄積すると window の性能が劣化する。

## Phase 3: 監督ループ（Monitor Agent 委任）

### 概要

window への指示送信後、**Sonnet Agent（Monitor）をバックグラウンドで spawn** して画面監視を委任する。自分は Agent の完了通知を待つ。

### 指示の送信（Director が直接行う）

window に指示を送信する:
```
tmux send-keys -t WINDOW.PANE 'ここに指示内容' Enter
```

### Monitor Agent の起動

指示送信後、以下のように Sonnet Agent をバックグラウンドで起動する:

```
Agent(
  model: sonnet,
  run_in_background: true,
  description: "tmux monitor WINDOW.PANE",
  prompt: 下記テンプレート
)
```

#### Monitor Agent プロンプトテンプレート

```
あなたは tmux window {WINDOW.PANE} の監視エージェントです。

## タスク
tmux window {WINDOW.PANE} で動いている Claude Code の画面を定期的にキャプチャし、
以下のいずれかの状態になったら報告してください。

## 監視対象の状態
1. **入力待ち**: プロンプト（❯ マーク）が表示され、Claude Code がユーザ入力を待っている
2. **AskUserQuestion**: 選択肢 UI が表示されている（番号付きの選択肢リスト）
3. **エラー**: エラーメッセージやスタックトレースが表示されている
4. **PDH 逸脱**: 以下のパターンを検知した場合
   - テスト未実行で完了報告
   - E2E スモークテストの省略
   - AC 未達でのクローズ試行
   - ビルド成功だけで実環境テスト省略
   - AC の無断書き換え

## 監視方法
1. 以下のコマンドで画面をキャプチャする:
   ```
   sleep {WAIT_SECONDS} && tmux capture-pane -t {WINDOW.PANE} -p -S -80 | tail -80
   ```
2. キャプチャ結果を確認し、上記の状態に該当するか判断する
3. 該当しない場合（まだ作業中）は、再度 sleep してキャプチャを繰り返す
4. 最大 {MAX_ITERATIONS} 回繰り返す

## 待ち時間の目安（初回）
- 単純な応答待ち: 10秒
- ファイル読み書き: 20秒
- npm install / build: 45秒
- Agent spawn / テスト実行: 90秒
- 大規模な実装: 150秒

2回目以降のキャプチャは 15秒間隔。

## 報告フォーマット
以下の形式で報告してください:

### 状態
[入力待ち / AskUserQuestion / エラー / PDH逸脱 / タイムアウト]

### 画面内容の要約
[Claude Code が何を表示しているか。作業結果、発見事項、提示された選択肢、検証手段、AC達成状況、懸念事項・残課題など、Director が意思決定に必要な情報をすべて含める]

### AskUserQuestion の選択肢（該当する場合）
[選択肢の番号とラベルを列挙]

### PDH 逸脱の詳細（該当する場合）
[どのルールに違反しているか、何が飛ばされているか]

### 直近の画面キャプチャ（最後の40行）
```
[最後のキャプチャ内容]
```
```

### Monitor Agent からの報告を受けた後の Director の行動

1. **入力待ち**: 報告内容を読み、window の状況を把握する
   - 作業完了の報告 → ユーザに情報をまとめて伝え、判断を仰ぐ
   - 次のステップへの進行 → 適切な指示を送信し、再度 Monitor を起動
2. **AskUserQuestion**:
   - product-brief.md と該当 Epic/Ticket を読んで判断できる → window に回答を送信
   - 判断できない → ユーザに情報と選択肢を提示して指示を仰ぐ
3. **エラー**: 内容を分析し、window に修正指示を送信、または ユーザに報告
4. **PDH 逸脱**: window に是正指示を送信
5. **タイムアウト**: 再度 Monitor を起動して監視を継続

### AskUserQuestion への応答（Director が直接行う）

window の Claude Code が AskUserQuestion で質問してきた場合（選択肢 UI が表示されている場合）:
- 該当する選択肢の **数字だけ** を send-keys する（Enter は送らない）
  ```
  tmux send-keys -t WINDOW.PANE '1'
  ```
- 選択肢にない回答をしたい場合は、まず Escape を送信してから指示を送る
  ```
  tmux send-keys -t WINDOW.PANE Escape
  sleep 1
  tmux send-keys -t WINDOW.PANE 'ここに指示内容' Enter
  ```

## Constraints

### やってはいけないこと
- **自分で pdh-dev 等の skill / ワークフローを実行しない**
- **自分でソースコードを編集しない**
- **自分でチケットの開け閉め（ticket.sh）をしない**
- **window に「自分で判断して」「意思決定を任せる」的な指示を出さない** — window は window のルールで動かす
- **ソースレベルの詳細な実装指示を出さない** — window はあなたより詳しいエンジニアである
- **自分で `tmux capture-pane` を繰り返さない** — Monitor Agent に委任する

### やるべきこと
- **product-brief.md、Epic、Ticket、note を読んで状況を把握する**
- **window が PDH ワークフロー（PD-1〜PD-8）に従っているか、Monitor の報告で確認する**
- **テスト・E2E・AC チェックが飛ばされていないか監視する**
- **意思決定が必要な場面では product-brief.md や該当 Epic を読んで自分で判断する**
- **判断できない場合はユーザに選択肢を提示して指示を仰ぐ**
- **ユーザに確認する際は、window の情報を十分にまとめて伝える**

### ユーザ確認が必須のタイミング（明示的に省略を指示されない限り）
以下の 2 つのタイミングでは、window に次のステップへ進む指示を出す **前に** 必ずユーザに状況を説明し、承認を得ること:
1. **計画完了後・実装開始前（PD-4 → PD-5 の境界）**: 計画内容（設計判断、ファイル変更計画、E2E テスト手順、懸念事項）をまとめてユーザに提示し、実装に進んでよいか確認する
2. **コードレビュー後・チケットクローズ前（PD-6/PD-7 → PD-8 の境界）**: レビュー結果（テスト結果、AC 達成状況、実環境動作確認結果、残課題）をまとめてユーザに提示し、クローズしてよいか確認する

### 留意事項
- window の Claude は Docker 内で動いている可能性がある。プロセスやコマンドの実行時にはそれを留意する
- PD-5（実装）/ PD-6（品質検証）/ PD-8（完了処理）は省略不可（CLAUDE.md ルール）

## 監督チェックポイント

### PDH ワークフロー遵守の確認
- PD-1（開始前チェック）: チケットの AC と依存関係を確認しているか
- PD-2（調査）: 十分な調査を行っているか
- PD-3（計画）: E2E スモークテスト手順が計画に含まれているか
- PD-4（計画レビュー）: 省略がユーザ承認済みか
- PD-5（実装）: 計画に沿って実装しているか、ファイル所有権を守っているか
- PD-6（品質検証）: テスト全件パス、実環境での動作確認を行っているか
- PD-7（目的妥当性確認）: 省略がユーザ承認済みか
- PD-8（完了処理）: チケットクローズ、note の更新が行われているか

### よくある逸脱パターン
- テスト未実行で「完了」と報告する → テスト実行を指示
- E2E スモークテストを飛ばす → 実行を指示
- AC を未達のままクローズしようとする → AC の検証を指示
- ビルド成功だけで実環境テストを省略 → 実環境での確認を指示
- AC を勝手に書き換える → ユーザに相談

### 意思決定フロー
1. Monitor Agent から報告を受信
2. product-brief.md と該当 Epic/Ticket を読む
3. 一意に判断できる → window に回答を送信 → Monitor を再起動
4. 判断できない → ユーザに情報と選択肢を提示して指示を仰ぐ

### コンテキストリセット

window が指示に従わない、同じミスを繰り返す、動作が不安定になった場合は、コンテキストの肥大化が原因の可能性がある。以下の手順でリセットする:

1. window に「現在の進捗と状況を current-note.md に記録してください」と指示
2. Monitor Agent で記録完了を確認
3. `/clear` を送信
5. `/pdh-dev` で作業を再開させる（note に記録された状況から自動的に再開される）

### ワークフロー逸脱時
PDH ワークフローから大きく外れる場合は、window への指示を止め、ユーザにその旨を伝えて判断を仰ぐ。
