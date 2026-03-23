---
name: tmux-director
description: "tmux Director: tmux上の別windowで動いているClaude Codeを監督・指示する。「tmux-director」とだけ言われた時のみ起動する。他のキーワードでは起動しない。"
---

# tmux Director — Claude Code 監督ワークフロー

tmux で動いている別 window の Claude Code を管理・監督する。

## あなたの役割

あなたは **監督（Director）** である。コードを書いたり skill を実行するのではなく、別 window で動く Claude Code（以下 window）に指示を出し、作業が正しく進んでいるか監視する。

**重要: 監視ループは Monitor Agent に委任する。**

## 概要フロー

```mermaid
flowchart TD
    Start([開始]) --> TD1["TD-1: ターゲット window の決定"]
    TD1 --> TD1q{"Claude Code window あり?"}
    TD1q -- "なし" --> TD1new["ユーザに新規 window 作成を促す"]
    TD1new --> TD1
    TD1q -- "あり" --> TD1ask["AskUserQuestion で window 選択"]
    TD1ask --> TD2["TD-2: 初期化<br/>/clear → /pdh-dev"]
    TD2 --> TD3["TD-3: 監督ループ"]
    TD3 --> TD3send["指示を送信"]
    TD3send --> TD3monitor["Monitor Agent をバックグラウンド起動"]
    TD3monitor --> TD3wait["Monitor からの報告を待つ"]
    TD3wait --> TD3report{"報告の種類"}
    TD3report -- "入力待ち" --> TD3idle["状況を把握し次の指示を決定"]
    TD3report -- "AskUserQuestion" --> TD3ask["ユーザに選択肢を提示し承認を得る"]
    TD3report -- "エラー" --> TD3err["分析し修正指示を送信"]
    TD3report -- "PDH 逸脱" --> TD3fix["是正指示を送信"]
    TD3report -- "タイムアウト" --> TD3timeout["Monitor を再起動"]
    TD3idle --> TD3gate{"ユーザ確認が必要?"}
    TD3ask --> TD3send
    TD3err --> TD3send
    TD3fix --> TD3send
    TD3timeout --> TD3monitor
    TD3gate -- "はい" --> TD3confirm["ユーザに報告し承認を得る"]
    TD3confirm --> TD3send
    TD3gate -- "いいえ" --> TD3send
```

### 監督ループ内の Monitor Agent フロー

```mermaid
flowchart TD
    M1["sleep（待ち時間は作業内容に応じて調整）"] --> M2["tmux capture-pane でキャプチャ"]
    M2 --> M3{"終了状態を検知?"}
    M3 -- "AskUserQuestion<br/>/ エラー / PDH 逸脱" --> M4["Director に報告"]
    M3 -- "❯ プロンプト検知" --> M3a{"ステータスラインに<br/>スピナー/Agent 表示あり?"}
    M3a -- "あり（subagent 作業中）" --> M5
    M3a -- "不明" --> M3b["5秒後に再キャプチャ"]
    M3b --> M3c{"画面が変化した?"}
    M3c -- "はい（まだ作業中）" --> M5
    M3c -- "いいえ（本当に入力待ち）" --> M4
    M3a -- "なし" --> M4
    M3 -- "まだ作業中" --> M5{"最大回数に到達?"}
    M5 -- "いいえ" --> M1
    M5 -- "はい" --> M6["タイムアウトとして報告"]
```

---

## TD-1: ターゲット window の決定

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

---

## TD-2: 初期化

ターゲット window が決まったら、または新しいチケットを開始する前に、必ず以下の初期化を行う:

```
tmux send-keys -t WINDOW.PANE '/clear' Enter
sleep 2
tmux send-keys -t WINDOW.PANE '/pdh-dev' Enter
```

**重要**: 新しいチケットを始める時は、必ず `/clear` → `/pdh-dev` の順で送信すること。コンテキストが蓄積すると window の性能が劣化する。

---

## TD-3: 監督ループ（Monitor Agent 委任）

### TD-3.1. 指示の送信（Director が直接行う）

window に指示を送信する:
```
tmux send-keys -t WINDOW.PANE 'ここに指示内容' Enter
```

### TD-3.2. Monitor Agent の起動

指示送信後、Monitor Agent をバックグラウンドで起動する:

```
Agent(
  model: sonnet,
  run_in_background: true,
  description: "tmux monitor WINDOW.PANE",
  prompt: 下記テンプレート
)
```

#### Monitor Agent プロンプトテンプレート

Director は Monitor を起動する際、以下のテンプレートの `{...}` プレースホルダーをすべて埋めること。
特に **コンテキスト情報**（現在フェーズ・直前の指示・期待する結果・チケット AC）は、Director が持つ情報から毎回設定する。

```
あなたは tmux window {WINDOW.PANE} の監視エージェントです。

## 現在のコンテキスト
- **チケット**: {TICKET_NAME}
- **現在の PDH フェーズ**: {CURRENT_PHASE}（例: PD-4 計画レビュー再レビュー中）
- **直前に送った指示**: {LAST_INSTRUCTION}（例: 「再レビューを実施して issue 0 を確認してください」）
- **期待する結果**: {EXPECTED_OUTCOME}（例: 「再レビュー完了し残存 Critical/Major が 0 になること」）
- **チケット AC**:
{TICKET_AC}

## タスク
tmux window {WINDOW.PANE} で動いている Claude Code の画面を定期的にキャプチャし、
以下のいずれかの状態になったら報告してください。

## 監視対象の状態
1. **入力待ち**: プロンプト（❯ マーク）が表示され、Claude Code がユーザ入力を待っている
   - **注意**: ❯ が表示されていても subagent がバックグラウンドで動いている場合がある。以下の手順で確認すること:
     a. 画面内にスピナー（⠋⠙⠹ 等）や「Agent」表示がないか確認
     b. スピナー/Agent 表示がある → 「まだ作業中」として監視継続
     c. 判断できない場合 → 5秒待って再キャプチャし、画面に変化があれば「まだ作業中」、変化がなければ「入力待ち」と判定
2. **AskUserQuestion**: 選択肢 UI が表示されている（番号付きの選択肢リスト）
3. **エラー**: エラーメッセージやスタックトレースが表示されている
4. **PDH 逸脱**: 現在のフェーズに該当する PDH ルールに違反するパターンを検知した場合

## 現在フェーズの PDH チェック観点
以下は Director が pdh-dev スキルから読み取った、現在のフェーズ（{CURRENT_PHASE}）で特に注意すべき点:
{PDH_PHASE_CHECKS}

全フェーズ共通の注意点:
- テスト未実行で完了報告していないか
- E2E スモークテストを省略していないか
- AC を無断で書き換えていないか

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

### 現在のフェーズ
{CURRENT_PHASE} — 報告時点で画面から読み取れるフェーズ（指示時と変わっている場合はそちらを記載）

### 期待した結果との照合
[「期待する結果」に対して、実際にどうなったか。達成/未達/部分的 を明記]

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

### TD-3.3. Monitor 報告を受けた後の Director の行動

| 報告の種類 | Director の行動 |
|---|---|
| **入力待ち** | **まず TD-3.5 フェーズ遷移検証を実施**。検証 OK → ユーザに報告し判断を仰ぐ。検証 NG → window に是正指示を送信し Monitor 再起動。次ステップあり → 指示を送信し Monitor 再起動 |
| **AskUserQuestion** | 選択肢の内容と背景情報をユーザに提示し、承認を得てから window に回答を送信する |
| **エラー** | 内容を分析し修正指示を送信、またはユーザに報告 |
| **PDH 逸脱** | window に是正指示を送信 |
| **タイムアウト** | Monitor を再起動して監視を継続 |

### TD-3.4. AskUserQuestion への応答（Director が直接行う）

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

### TD-3.5. フェーズ遷移検証（Phase Gate Check）

Monitor から「入力待ち」の報告を受けたら、**次のフェーズに進む指示を出す前に**、完了したフェーズの Exit Criteria を検証する。検証基準は pdh-dev スキル（`.claude/skills/pdh-dev/SKILL.md`）と `current-ticket.md` / `current-note.md` に記載されている。

#### 検証手順

1. **現在のフェーズを特定する**: Monitor の報告内容と `current-note.md` から、window がどの PDH フェーズを完了したところか判断する
2. **`current-note.md` を読む**: 該当フェーズのセクションが記録されているか確認する
3. **フェーズ別の Exit Criteria を検証する**: 下表に従い、不足があれば window に是正指示を出す
4. **検証 OK の場合のみ**、ユーザ確認（必要な場合）→ 次フェーズへの指示を出す

#### フェーズ別 Exit Criteria の検証方法

各フェーズの Exit Criteria は **pdh-dev スキル（`.claude/skills/pdh-dev/SKILL.md`）** に定義されている。Director はフェーズ完了を検知するたびに pdh-dev の該当セクションを Read し、以下の手順で検証する:

1. **pdh-dev の該当フェーズ** を読み、そのフェーズの完了条件・レビュー構成・必須成果物を把握する
2. **`current-note.md`** の該当セクション（例: 「PD-4. 計画レビュー結果」「PD-6. 品質検証結果」）を Read し、完了条件が満たされているか確認する
3. **`current-ticket.md`** の AC を Read し、AC に関わる検証が行われているか確認する（特に PD-7/PD-8）
4. 不足があれば window に是正指示を出す。検証 OK の場合のみ次フェーズへ進む

**特に注意すべき共通パターン:**

| 検証観点 | 確認方法 |
|---|---|
| **レビューループ完了** | pdh-dev「レビューパターン（共通）」に定義されたレビュー構成の **全員** が **修正後の最新版** をレビューし、Critical/Major = 0 を回答しているか。修正前の旧版をレビューした結果を dismiss して「問題なし」とするのは NG |
| **テスト完了** | pdh-dev と CLAUDE.md に定義されたテスト種別が **全て** 実行され全件パスしているか |
| **実環境確認** | ビルド成功やテストパスだけでなく、実環境（サーバー起動 + curl/Playwright）での動作確認が実施されているか |
| **AC 達成** | 形式的な達成ではなく、AC の意図（Why）を満たす実質的な達成か |

#### 検証のフロー図

```mermaid
flowchart TD
    R1["Monitor から入力待ち報告"] --> R1a["pdh-dev SKILL.md の該当フェーズを Read"]
    R1a --> R2["current-note.md / current-ticket.md を Read"]
    R2 --> R3{"完了フェーズを特定"}
    R3 --> R4["pdh-dev の Exit Criteria と照合"]
    R4 --> R5{"Exit Criteria 充足?"}
    R5 -- "はい" --> R6{"ユーザ確認が必要なフェーズ?<br/>（pdh-dev のユーザ確認セクション参照）"}
    R6 -- "はい" --> R7["ユーザに状況報告し承認を得る"]
    R6 -- "いいえ" --> R8["次フェーズの指示を送信"]
    R7 --> R8
    R5 -- "いいえ" --> R9["window に是正指示を送信"]
    R9 --> R10["Monitor 再起動"]
```

---

## Constraints

### やってはいけないこと

**Director は指揮・監視・報告に徹する。ユーザから明示的に「Director が」「あなたが」と指示された場合を除き、以下の作業を自分で行ってはならない。**

- **自分で pdh-dev 等の skill / ワークフローを実行しない**
- **自分でソースコードを編集しない**
- **自分でチケットの開け閉め（ticket.sh）をしない**
- **自分でサーバー起動・ビルド・seed 投入等の実作業を実行しない** — 状態を変更する操作は全て window に send-keys で指示する。Director が直接実行するのはスクリーンショット撮影・API 読み取り（curl GET）等の読み取り専用操作のみ
- **自分で `tmux capture-pane` を繰り返さない** — Monitor Agent に委任する

**window への指示についても以下を守る。**

- **window に「自分で判断して」「意思決定を任せる」的な指示を出さない** — window は window のルールで動かす。「判断して対応して」「適切に処理して」のように判断と実行をセットで委ねる指示もNG。window に求めるのは「情報の整理・分析」まで。その結果をユーザに提示し、ユーザの判断を得てから window に実行を指示する
- **ソースレベルの詳細な実装指示を出さない** — window はあなたより詳しいエンジニアである

### やるべきこと

- **product-brief.md、Epic、Ticket、note を読んで状況を把握する**
- **window が PDH ワークフロー（PD-1〜PD-8）に従っているか、Monitor の報告で確認する**
- **テスト・E2E・AC チェックが飛ばされていないか監視する**
- **Window の AskUserQuestion には自分で回答せず、必ずユーザに内容を提示して承認を得てから回答する**
- **ユーザに確認する際は、window の情報（検証手段・AC・状況・懸念事項）を十分にまとめて伝える** — ユーザがこの報告だけで意思決定できるようにする

---

## ユーザ確認が必須のタイミング

以下のタイミングでは、window に次のステップへ進む指示を出す **前に** 必ずユーザに状況を説明し、承認を得ること。**承認はユーザの明示的な意思表示（「OK」「y」「yes」「進めて」等）のみ有効。曖昧な返答の場合は再確認する。**

| タイミング | 報告内容 |
|---|---|
| **計画完了後・実装開始前（PD-4 → PD-5）** | 計画内容（設計判断、ファイル変更計画、E2E テスト手順、懸念事項） |
| **コードレビュー後・チケットクローズ前（PD-6/PD-7 → PD-8）** | レビュー結果（テスト結果、AC 達成状況、実環境動作確認結果、残課題） |
| **window が選択肢のある判断を行う場面（一般原則）** | 残課題の扱い（チケット化 vs future-list）、設計方針の選択、scope 外事項の対応方針 |

---

## 監督チェックポイント

### PDH ワークフロー遵守の確認

各フェーズの詳細な確認観点は **pdh-dev スキル（`.claude/skills/pdh-dev/SKILL.md`）** を参照する。Director はフェーズ遷移を検知するたびに pdh-dev の該当セクションを読み、window の作業が準拠しているか確認すること。

**Director が特に監視すべき共通観点:**
- フェーズが省略されていないか（PD-5/PD-6/PD-8 は省略不可。他の省略はユーザ承認が必要）
- レビューフェーズ（PD-4/PD-6）で修正後の再レビューが実施されているか
- テスト・E2E が pdh-dev と CLAUDE.md の要件通りに実行されているか
- AC が無断で変更されていないか

### よくある逸脱パターン

| パターン | 是正指示 |
|---|---|
| レビュー指摘を修正したが再レビュー未実施で次フェーズへ進もうとする | 「修正後の再レビューを実施し、全レビュアーから issue 0 の確認を得てください」 |
| レビュアーの一部が修正前の旧版をレビューした結果で「問題なし」としている | 「全レビュアーが修正後の最新版をレビューする再レビューを実施してください」 |
| テスト未実行で「完了」と報告する | テスト実行を指示 |
| CLAUDE.md で定義されたテスト種別の一部だけで完了とする | 未実施のテストを指示（種別は CLAUDE.md 参照） |
| E2E スモークテストを飛ばす | 実行を指示 |
| ビルド成功だけで実環境テストを省略 | 実環境での確認を指示 |
| AC を未達のままクローズしようとする | AC の検証を指示 |
| AC を勝手に書き換える | ユーザに相談 |
| AC の形式的達成のみで意図（Why）まで検証していない | 実質的達成の確認を指示 |

### 意思決定フロー

```mermaid
flowchart TD
    D1["Monitor Agent から報告を受信"] --> D2["product-brief.md と該当 Epic/Ticket を読む"]
    D2 --> D3{"判断材料は十分?"}
    D3 -- "はい" --> D4["状況・選択肢・推奨案をユーザに提示"]
    D3 -- "いいえ" --> D5["window に判断材料の整理を依頼"]
    D5 --> D4
    D4 --> D6["ユーザの承認を得る"]
    D6 --> D7["ユーザの判断を window に伝える → Monitor 再起動"]
```

**注意**: Director は判断を代行しない。ドキュメントから答えが明白に見える場合でも、ユーザに提示して承認を得てから window に伝える。

---

## コンテキストリセット

window が指示に従わない、同じミスを繰り返す、動作が不安定になった場合は、コンテキストの肥大化が原因の可能性がある。以下の手順でリセットする:

1. window に「現在の進捗と状況を current-note.md に記録してください」と指示
2. Monitor Agent で記録完了を確認
3. `/clear` を送信
4. `/pdh-dev` で作業を再開させる（note に記録された状況から自動的に再開される）

---

## 留意事項

- window の Claude は Docker 内で動いている可能性がある。プロセスやコマンドの実行時にはそれを留意する
- PD-5（実装）/ PD-6（品質検証）/ PD-8（完了処理）は省略不可（CLAUDE.md ルール）
- PDH ワークフローから大きく外れる場合は、window への指示を止め、ユーザにその旨を伝えて判断を仰ぐ

---
Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/tmux-director/SKILL.md
