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
    TD3report -- "入力待ち" --> TD3self["TD-3.5 セルフチェック送信"]
    TD3report -- "AskUserQuestion" --> TD3ask2["ユーザに選択肢を提示し承認を得る"]
    TD3report -- "エラー" --> TD3err["分析し修正指示を送信"]
    TD3report -- "タイムアウト" --> TD3timeout["キャプチャ → Monitor 再起動"]
    TD3self --> TD3verify["Director: note/ticket で裏取り"]
    TD3verify --> TD3gate{"ユーザ確認が必要?"}
    TD3ask2 --> TD3send
    TD3err --> TD3send
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
    M3 -- "AskUserQuestion / エラー" --> M4["Director に報告"]
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

## PDH ステップ参照（tmux-director 用クイックリファレンス）

pdh-dev のステップ番号・ルールの **正式な定義** は常に `.claude/skills/pdh-dev/SKILL.md` にある。Director はフェーズ遷移を検知するたびに pdh-dev を Read して最新の定義に従うこと。以下は Director が頻繁に参照する情報のクイックリファレンスであり、pdh-dev と矛盾する場合は pdh-dev が正。

**PD-C ステップ一覧（Full）:**
C-1 開始前 → C-2 調査 → C-3 計画 → C-4 レビュー → **C-5 実装承認** → C-6 実装 → C-7 品質検証 → C-8 目的妥当性 → C-9 完了検証 → **C-10 クローズ**

**PD-C ステップ一覧（Light）:**
C-1 開始前 → C-3 調査+計画 → **C-5 実装承認** → C-6 実装 → C-7 品質検証 → C-9 完了検証 → **C-10 クローズ**

**Light でのステップ差異:**
- C-2 調査 → C-3 に統合
- C-4 計画レビュー → スキップ
- C-6 実装 → リードが直接実装可（TeamCreate 不要）
- C-7 品質検証 → DA×1 + codex のみ（Full: DA×2 + CR×2 + codex）
- C-8 目的妥当性 → スキップ
- C-9 完了検証 → AC チェックはリードのみ（裏取り agent なし）

**省略不可ステップ（Full/Light 共通）:** PD-C-6, PD-C-7, PD-C-9, PD-C-10

**ユーザ確認が必須の gate:**

| Gate | タイミング | 報告内容 |
|---|---|---|
| **PD-C-5 実装承認** | 計画完了後、実装開始前（Full: C-4 後 / Light: C-3 後） | 計画内容（設計判断、ファイル変更計画、E2E テスト手順、懸念事項） |
| **PD-C-10 クローズ** | 完了検証後（Full: C-8→C-9 後 / Light: C-7→C-9 後） | テスト結果、AC 達成状況、実環境動作確認結果、残課題。**特に「既存問題」「対応検討」「スコープ外」と記載された項目は個別に列挙し、対応方針をユーザに確認する** |

**gate 報告時の必須アクション:** ユーザに承認を求める前に、Director は必ず `current-ticket.md` と `current-note.md` を Read し、**ユーザがこの報告だけで判断できる包括的サマリ**を作成すること。window の AskUserQuestion の選択肢をそのまま転送するだけでは不十分。サマリには以下を含める:
- チケットの目的・背景（Why）
- 実装計画の全体像（チーム構成、各担当の作業内容、変更規模）
- レビューで発見・修正された重要ポイント
- AC の変更点（あれば）
- 懸念事項・リスク

**レビューフェーズ:** PD-C-4（計画）、PD-C-7（品質検証）

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

**重要: Window への指示は常に 1 フェーズ分のみ。** 「PD-C-4 をやって、その後実装も進めて」のように複数フェーズをまとめて指示しない。ユーザ確認 gate（PD-C-5, PD-C-10）を飛ばす原因になる。

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
- **現在の PDH フェーズ**: {CURRENT_PHASE}（例: PD-C-4 計画レビュー再レビュー中）
- **直前に送った指示**: {LAST_INSTRUCTION}（例: 「再レビューを実施して issue 0 を確認してください」）
- **期待する結果**: {EXPECTED_OUTCOME}（例: 「再レビュー完了し残存 Critical/Major が 0 になること」）
- **チケット AC**:
{TICKET_AC}

## タスク
tmux window {WINDOW.PANE} の画面を定期的にキャプチャし、以下のいずれかの状態になったら報告してください。

## 監視対象の状態
1. **入力待ち**: ❯ マークが表示されユーザ入力を待っている
   - 注意: ❯ が表示されていても subagent が動いている場合がある
     a. スピナー（⠋⠙⠹ 等）や「Agent」表示あり → 「まだ作業中」
     b. 判断できない場合 → 5秒待って再キャプチャ、変化なければ「入力待ち」
2. **AskUserQuestion**: 選択肢 UI（番号付きリスト）が表示されている
3. **エラー**: エラーメッセージやスタックトレースが表示されている

## フェーズ追跡
- 画面キャプチャ内の `[PD-C-X] -> [PD-C-Y]` 形式のステップ遷移宣言を探し、最後に検知した宣言を報告する
- **遷移宣言が見つからなければ、フェーズは {CURRENT_PHASE} のまま変わっていないと報告する。遷移宣言がない限り、フェーズが変わったと解釈しないこと**
- 入力待ちを検知し、かつ遷移宣言が見つからない場合は `tmux send-keys -t {WINDOW.PANE} '今の作業フェーズを教えて' Enter` で window に確認し、その回答をキャプチャしてから報告する

## 監視方法
sleep {WAIT_SECONDS} → `tmux capture-pane -t {WINDOW.PANE} -p -S -80 | tail -80` を最大 240 回（15秒間隔、約1時間）繰り返す。
初回待ち時間: 単純応答 10s / ファイル操作 20s / build 45s / Agent spawn 90s / 大規模実装 150s

## 報告フォーマット
### 状態
[入力待ち / AskUserQuestion / エラー / タイムアウト]

### 現在のフェーズ
最後に検知した遷移宣言 `[PD-C-X] -> [PD-C-Y]`（なければ「遷移宣言なし、{CURRENT_PHASE} のまま」）

### 画面内容の要約
[作業結果、選択肢、懸念事項など Director が意思決定に必要な情報をすべて含める]

### AskUserQuestion の選択肢（該当する場合）
[番号とラベルを列挙]

### 直近の画面キャプチャ（最後の40行）
```
[最後のキャプチャ内容]
```
```

### TD-3.3. Monitor 報告を受けた後の Director の行動

| 報告の種類 | Director の行動 |
|---|---|
| **入力待ち** | **TD-3.5 セルフチェック → フェーズ遷移を実施**（下記参照） |
| **AskUserQuestion** | 選択肢の内容と背景情報をユーザに提示し、承認を得てから window に回答を送信する |
| **エラー** | 内容を分析し修正指示を送信、またはユーザに報告 |
| **タイムアウト** | **まず window の現在の画面をキャプチャ**し、AskUserQuestion が出ていないか確認する。問題なければ Monitor を再起動 |

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

### TD-3.5. セルフチェック → フェーズ遷移

Monitor から「入力待ち」の報告を受けたら、**次のフェーズに進む指示を出す前に** 以下の手順を実行する。

```mermaid
flowchart TD
    R1["Monitor から入力待ち報告"] --> R2["window にセルフチェックを送信"]
    R2 --> R3["Monitor でセルフチェック結果を待つ"]
    R3 --> R4["Director: note / ticket を Read して裏取り"]
    R4 --> R5{"問題あり?"}
    R5 -- "あり" --> R6["window に是正指示 → Monitor 再起動"]
    R5 -- "なし" --> R7{"ユーザ確認 gate?<br/>（PD-C-5 or PD-C-10）"}
    R7 -- "いいえ" --> R8["次フェーズの指示を送信 → Monitor 再起動"]
    R7 -- "はい" --> R9["ユーザに状況報告し承認を得る"]
    R9 --> R8
```

#### 手順の詳細

**Step 1: window にセルフチェックを送信する**

入力待ちを検知したら、**常に** window に以下を送信し、Monitor で結果を待つ:

```
次のフェーズに進む前に、pdh-dev ワークフロー（.claude/skills/pdh-dev/SKILL.md）の現在のステップの完了条件を読み直し、current-note.md のログと照合して、全てのステップを正しく踏んだか確認してください。ステップ遷移宣言（[PD-C-X] -> [PD-C-Y] の形式）が抜けていれば補完してください。確認結果を報告してください。
```

**Step 2: Director が裏取りする**

セルフチェック結果を受け取った後、Director 自身で `current-note.md` と `current-ticket.md` を Read し、以下を確認する:
- **チケットの規模に関わらず、この検証を省略してはならない**

| 検証観点 | 確認方法 |
|---|---|
| **レビューループ完了** | レビュー構成の **全員** が **修正後の最新版** をレビューし、Critical/Major = 0 を回答しているか |
| **テスト完了** | CLAUDE.md に定義されたテスト種別が **全て** 実行され全件パスしているか |
| **実環境確認** | サーバー起動 + curl/Playwright での動作確認が実施されているか |
| **AC 達成** | 形式的な達成ではなく、AC の意図（Why）を満たす実質的な達成か |
| **既存問題・残課題** | note に「対応検討」「スコープ外」「別チケット」等と記載された項目がないか。ある場合は **ユーザに個別に提示し対応方針の判断を仰ぐ** |

**Step 3: ユーザ確認 gate の場合、ユーザに報告し承認を得る**

PD-C-5 または PD-C-10 に該当する場合、セルフチェック結果 + Director の裏取り結果をまとめてユーザに報告する。承認はユーザの明示的な意思表示（「OK」「y」「yes」「進めて」等）のみ有効。

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
- **window が PDH ワークフローに従っているか、Monitor の報告で確認する**（ステップ一覧は「PDH ステップ参照」セクション参照）
- **テスト・E2E・AC チェックが飛ばされていないか監視する**
- **Window の AskUserQuestion には自分で回答せず、必ずユーザに内容を提示して承認を得てから回答する**
- **ユーザに確認する際は、window の情報（検証手段・AC・状況・懸念事項）を十分にまとめて伝える** — ユーザがこの報告だけで意思決定できるようにする

---

## よくある逸脱パターン

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
| **レビューで既存問題が「対応検討」「スコープ外」「別チケット」と記載されている** | **Director がユーザに背景・選択肢を提示し、対応方針の判断を仰ぐ**（window に判断を任せない） |
| **ユーザ確認なしに gate（PD-C-5, PD-C-10）を越えて進んでいる** | 即座に window を止め、ユーザに状況報告して承認を得る。ユーザが window に質問・会話しただけでは承認にならない。pdh-dev が定義する「明示的な意思表示（OK/y/yes/進めて）」のみ有効 |

---

## コンテキストリセット

window が是正指示を **2回送っても同じ問題を繰り返す** 場合、コンテキストの肥大化が原因の可能性がある。ユーザに状況を報告し、リセットの承認を得てから以下を実行する:

1. window に「現在の進捗と状況を current-note.md に記録してください」と指示
2. Monitor Agent で記録完了を確認
3. `/clear` を送信
4. `/pdh-dev` で作業を再開させる（note に記録された状況から自動的に再開される）

---

## 留意事項

- window の Claude は Docker 内で動いている可能性がある。プロセスやコマンドの実行時にはそれを留意する
- PDH ワークフローから大きく外れる場合は、window への指示を止め、ユーザにその旨を伝えて判断を仰ぐ

---
Based on https://github.com/masuidrive/pdh/blob/20bc5d6/skills/tmux-director/SKILL.md
