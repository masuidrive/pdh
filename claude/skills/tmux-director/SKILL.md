---
name: tmux-director
description: "tmux Director: 「tmux-director」とだけ言われた時に起動し、tmux 上の別 window で動いている Claude Code を監督・指示する（他のキーワードでは起動しない）。"
---

# tmux Director — Claude Code 監督ワークフロー

Director は指揮・監視・報告に徹する。迷ったら止まり、gate ではユーザに聞く。自分の判断で承認・close・実行開始をしない。

Director / worker とも Claude Code であることを前提とする。codex を main にする場合は、この skill ではなく pdh-dev `_execution-team.md`「spawn 機構」の subprocess worker 方式を使う。window 側の実装 worker だけを codex へ委譲する構成では、Director 側の前提は変わらない。

## PDH ステップ参照

pdh-dev のステップ番号・ルールの **正式な定義** は常に `.claude/skills/pdh-dev/SKILL.md` にある。Director はフェーズ遷移を検知するたびに pdh-dev を Read して最新の定義に従うこと。

**PDH ステージ一覧:**
PDH-open → PDH-ticket-review → PDH-ticket-human-review → PDH-implement → PDH-review → PDH-verify → PDH-human-review → **PDH-close**

**省略不可ステージ:** PDH-open, PDH-ticket-review, PDH-ticket-human-review, PDH-implement, PDH-review, PDH-verify, PDH-human-review, PDH-close

## gate

| Gate | タイミング |
|---|---|
| PDH-ticket-human-review 承認 | ticket contract check 後、実装に入る前 |
| PDH-human-review 承認 | PDH-verify 完了後、close 前 |

- gate は毎回ユーザに確認する。それまで全ての質問に「yes」と答え続けていても、gate だけは自動承認と見なさない。
- gate で何を報告するかは `pdh-decision-board` skill の gate 分冊（`ticket-gate.md` / `close-gate.md`）に従う。
- gate 報告の前に、Director 自身が `ticket.sh start`/`restore` 出力の `ticket:` / `note:` パス（互換 symlink: `current-ticket.md` / `current-note.md`）を Read し、window の報告と突き合わせてから材料を組む。

## ユーザは window を見ない

- 判断材料は読み返せる 1 枚の board に置き、`AskUserQuestion` は決定の入口としてのみ使う。**順序は board を作って発行 → URL を提示 → `AskUserQuestion`。**
- gate だけでなく scope の判断（finding を本 ticket で直すか / 起票するか / 記録のみか、次にどの ticket を流すか）にも board を作る。判断が 1 件でも、選択肢が単純に見えても同じ。
- worker が publish した gate report は転送せず、材料として引用・リンクし、Director が board を作る。board には Director の裏取り結果と、window を横断した判断を載せる。artifact を publish できる engine はそれを使い、できない engine は同じ構造を ticket の tmp 配下のファイルに書いて path を渡す。

## TD-1: ターゲット window の決定

1. このセッションの全 window を取得する
   ```
   tmux list-windows -F '#{window_index}:#{window_name}:#{pane_current_path}:#{pane_current_command}'
   tmux display-message -p '#{window_index}'  # 自分の window
   ```
2. 自分以外の各 window をキャプチャして内容を確認する
   ```
   tmux capture-pane -t WINDOW.PANE -p -S -50 | tail -50
   ```
3. Claude Code が動いている window を特定し、window 番号（`:WINDOW.PANE`）・ディレクトリ・現在の会話内容を AskUserQuestion で提示して選択させる
4. Claude Code window がなければ、新しい window を作って Claude Code を起動するようユーザに促す

## TD-0: hookbus 事前設定（1 回だけ）

worker の入力待ち / permission 待ちは hookbus event stream で検知する。未配線なら TD-3.2-fallback に落ちる。

配線チェック:

```
ls scripts/hookbus.js && jq '.hooks.Stop' .claude/settings.json
```

両方あれば配線済。未配線なら INSTALL.md「.claude/settings.json を設定する」の hookbus 版に従って配線し、追加後は全 Claude セッションを再起動する。hook の command は `"$CLAUDE_PROJECT_DIR/scripts/hookbus.js"` と絶対化する。

**以下の値は Bash で取得したあと、得られたリテラル値を Monitor のコマンド文字列へ埋め込む。**

```bash
# a) tmux socket hash と Monitor 専用の cursor id を求めて表示する
SOCK_HASH=$(scripts/hookbus.js whoami | cut -d: -f1)
CURID="$SOCK_HASH:mon-$(tmux display-message -p '#{window_index}')"   # Director 自身の key と必ず別
ROOT=/tmp/claude-events-$SOCK_HASH

# b) cursor を log 末尾へ seed し、offset 0 からの全 backlog 再生を避ける
mkdir -p "$ROOT/consumers"
wc -c < "$ROOT/log.ndjson" | tr -d ' ' > "$ROOT/consumers/${CURID/:/%3A}.cursor"

echo "CURID=$CURID"    # ← この値を次の Monitor コマンドへ literal で埋め込む
```

監視対象 pane の key は `<SOCK_HASH>:<pane_id>`（pane_id は TD-1 で選んだもの。例 `%10`）。

```
Monitor({
  command: "scripts/hookbus.js pull --cursor <上で表示された CURID> --include <w1-key> --include <w2-key> --follow",
  description: "tmux worker idle events",
  persistent: true
})
```

- `--include` を明示する。未指定だと無関係な pane を含む全 worker の event が流れる。
- 各 Monitor に固有の `--cursor <id>` を渡す。Director 自身の key とは必ず別にする。
- 新規 cursor は offset 0 から全 backlog を replay するので、起動前に上記 b) で cursor を log 末尾へ seed する。
- 監視対象を増減するときは、`--include` の変更と cursor の seed を必ずセットで行う。
- 複数 worker は「Monitor を N 個」ではなく「1 Monitor + `--include` 複数」で監視し、cursor を 1 本に保つ。
- Director が診断目的で手動 `pull` を叩くときも `--cursor` を別 id にする。

## TD-2: 初期化

### TD-2.1. チケット確認

1. `./ticket.sh list` で TODO ticket を一覧する
2. AskUserQuestion で「次にどのチケットをやるか」を確認する（チケット名と概要・依存関係・推奨する実行順序）
3. ユーザの承認を得てから TD-2.2 に進む

### TD-2.2. window の初期化

新しいチケットを始めるときは、必ず `/clear` → `/pdh-dev` の順で送信する。

```
tmux send-keys -t WINDOW.PANE '/clear' Enter
sleep 2
tmux send-keys -t WINDOW.PANE '/pdh-dev 最初に `./ticket.sh start --worktree <ticket-name>` を排他ロック下で実行し、EnterWorktree({path: ...}) で移ってください。ticket.sh 系は排他ロック下で実行してください（flock があれば flock、macOS など flock 非同梱環境では mkdir ベースの atomic lock。下記「ticket.sh の排他ロック（クロス OS）」参照）。[追加指示があればここに]'
tmux send-keys -t WINDOW.PANE Enter
```

slash command（`/clear`、`/effort`、`/pdh-dev` 等）は必ず literal な `tmux send-keys` で送る。kickoff message のテキスト内に書いても実行されない。`/effort max` を送るなら `/clear` の後、kickoff の前に単独で送る。

### TD-2.3. Worktree 運用

- 全 ticket で worktree 分離をデフォルトにする。単独 ticket / hotfix / infra ticket でも同じ。
- 新規 window 起動は `claude --worktree <slug>` 経由にする。
- 既存 window を続行させるときは、初回指示に `ticket.sh start --worktree <ticket-name>`（排他ロック下）+ `EnterWorktree({path: ...})` を含める。
- 既に worktree 内で起動している window に `EnterWorktree({name: ...})` を指示しない。2 巡目以降の window には `ticket.sh start --worktree` を使わせる。移動に失敗した場合、worker は「全コマンドで絶対パスを明示する」運用で続行できる。新しい ticket は、可能なら新規セッションを新 worktree で立てる。
- worktree path は `.worktrees/<slug>/`（ticket.sh default）。
- `.env` 等 gitignored ファイルの持ち込みは `.ticket-config.yaml` の `worktree_copy_files` で行う（単発の追加は `--copy-file <path>`）。`claude --worktree` / `EnterWorktree` だけで作った worktree には適用されないので、その場合は手動でコピーする。
- close 時は `ticket.sh close --keep-worktree` で worktree path を維持する。

## TD-3: 監督ループ

### TD-3.1. 指示の送信

text と Enter を別コマンドで送る。`send-keys '...' Enter` を 1 回で実行しない。

```
tmux send-keys -t WINDOW.PANE 'ここに指示内容'
tmux send-keys -t WINDOW.PANE Enter
```

- 到達確認は画面ではなく worker の transcript で行う。全メッセージの先頭に固定の prefix を付け、worker の transcript にそれが現れたかで判定する（transcript path は hookbus event の `transcript_path` に入っている）。`capture-pane` による判定は両方向に嘘をつく。
- 長文・複数行は逐字入力ではなく buffer 経由で送り、載せる前に末尾改行を落とす。paste の前に `C-u` で入力欄をクリアし、Enter は単独コマンドで paste の 0.5 秒後に送る。
- 届いていなければ Enter だけ再送する。paste をやり直すと二重入力になる。数回で届かなければ loud fail してユーザに報告する。
- 未確認の送信を「送った」と報告しない。
- 例外: slash command（`/clear` `/compact` `/pdh-dev`）と `AskUserQuestion` への数字回答は buffer 経由にせず literal な `send-keys` で送る。

window への指示は常に 1 フェーズ分のみにする。「PDH-implement をやって、その後 PDH-review も進めて」のように複数フェーズをまとめて指示しない。

#### ゴースト表示

Claude Code の prompt 行には、入力バッファが空でもテキストが残像として表示され続けることがある。この状態では Enter を押しても何も起きない。**画面でテキストの有無を判定しない。**

実体かゴーストかは 1 文字送れば判別できる。

```bash
tmux send-keys -t <pane> 'X'      # 「元のテキストX」なら実体、「X」だけに置き換わればゴースト
tmux send-keys -t <pane> BSpace   # 確認後に戻す
```

- ゴーストは `C-u` では消えない。消せるのは paste による上書きだけ。
- pane にテキストが残っていても、Director は勝手に Enter しない。自分の送信の取りこぼしなら Enter を再送してよいが、自分が送った覚えのないテキストは出所を確認するまで触らない。
- **順序を守る。1 文字送る判別を «先に» 行い、grep はその後にする。**
- grep は Director 自身の session を必ず除外する。`capture-pane` の出力は Director の transcript に入るので、素朴に grep すると自分の観測記録が必ずヒットし、存在しない第三者を作り出す。

```bash
# ❌ これは必ず自分にヒットする（capture-pane の出力が入っているだけ）
grep -rl '<テキスト>' /home/vscode/.claude/projects/
# ✅ 自分の session を除き、«送信された user メッセージ» として存在するかを見る
grep -rl '<テキスト>' /home/vscode/.claude/projects/ | grep -v "$MY_SESSION_ID"
```

- 決め手は「worker の transcript に、単独の user メッセージとして届いているか」である。届いていなければ、それは送信されていない。Director が引用した文章の中に現れるのは届いた証拠ではない。
- ゴーストの文言は変化することがあるが、変化を「人間が打っている」証拠にしてはならない。「誰が打ったか」を推測して人の運用を変えさせない。

### TD-3.2. 入力待ち検知 — hookbus stream（配線済の場合）

hookbus Monitor から event が届いたら、次を抽出して行動を決める。

- `hook_event_name` で分岐する
  - `Stop` → メインターン終了。入力待ち。TD-3.5 に進む
  - `Notification` + `matcher=permission_prompt` → permission UI 表示。TD-3.4 で応答
  - `Notification` + `matcher=idle_prompt` → idle reminder
  - `SubagentStop` → subagent 終了。main は動いている可能性があるので通常無視
- `last_message.text_snippet` を直接参照して worker の最終メッセージを把握する（capture-pane も `transcript_path` の Read も原則不要）
- `text_full_length > text_snippet.length` なら truncate 済。詳細が要るなら `transcript_path` を Read で tail する
- `key` から pane を解決して応答する
  ```
  tmux list-panes -a -F '#{pane_id} #{session_name}:#{window_index}'
  tmux send-keys -t <pane_id> ...
  ```

capture-pane は情報不足のときだけ補助的に使う（permission UI の選択肢番号が `last_message` に入らない場合など）。

### TD-3.2-fallback. Monitor Agent の起動（hookbus 未配線時のみ）

```
Agent(
  model: sonnet,
  run_in_background: true,
  description: "tmux monitor WINDOW.PANE",
  prompt: 下記テンプレート
)
```

テンプレートの `{...}` は Director が持つ情報からすべて埋める。

```
あなたは tmux window {WINDOW.PANE} の監視エージェントです。

## 現在のコンテキスト
- **チケット**: {TICKET_NAME}
- **現在の PDH フェーズ**: {CURRENT_PHASE}
- **直前に送った指示**: {LAST_INSTRUCTION}
- **期待する結果**: {EXPECTED_OUTCOME}
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
- 画面キャプチャ内の `[PDH-open] -> [PDH-ticket-review]` のようなステージ遷移宣言を探し、最後に検知した宣言を報告する
- **遷移宣言が見つからなければ、フェーズは {CURRENT_PHASE} のまま変わっていないと報告する。遷移宣言がない限り、フェーズが変わったと解釈しないこと**
- 入力待ちを検知し、かつ遷移宣言が見つからない場合は `tmux send-keys -t {WINDOW.PANE} '今の作業フェーズを教えて' Enter` で window に確認し、その回答をキャプチャしてから報告する

## 監視方法
`sleep 15` → `tmux capture-pane -t {WINDOW.PANE} -p -S -80 | tail -80` を最大 240 回（15秒間隔、約1時間）繰り返す。**監視間隔の 15秒は固定。変更しないこと。初回も 15秒。**

## 報告フォーマット
### 状態
[入力待ち / AskUserQuestion / エラー / タイムアウト]

### 現在のフェーズ
最後に検知した遷移宣言 `[PDH-*] -> [PDH-*]`（なければ「遷移宣言なし、{CURRENT_PHASE} のまま」）

### 画面内容の要約
[作業結果、選択肢、懸念事項など Director が意思決定に必要な情報をすべて含める]

### AskUserQuestion の選択肢（該当する場合）
[番号とラベルを列挙]

### 直近の画面キャプチャ（最後の40行）
```
[最後のキャプチャ内容]
```
```

### TD-3.2.5. 完了して静止した窓は通知されない

- 判断を要求した window は「待たせている」と認識し続ける。gate に上げた時点でリストに残す。
- 他の window の議論が一段落したら、全 window の最終 assistant 発言の時刻を transcript で確認する
  ```bash
  for d in ~/.claude/projects/-<repo-encoded>*/; do
    f=$(ls -t "$d"/*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && echo "$(date -r "$f" '+%H:%M')  $(basename "$d")"
  done | sort -r | head
  ```
- idle 通知（`Notification` + `Claude is waiting for your input`）を機械的に無視しない。「作業の途中で待っている」のか「終わって報告済みで待っている」のかは、transcript の最終 assistant 発言を読んで判断する。

### TD-3.3. 報告を受けた後の行動

| 報告の種類 | Director の行動 |
|---|---|
| 入力待ち | TD-3.5 セルフチェック → フェーズ遷移 |
| AskUserQuestion | 選択肢の内容と背景情報をユーザに提示し、承認を得てから window に回答を送信する |
| エラー | 内容を分析し修正指示を送信、またはユーザに報告 |
| タイムアウト | まず window の現在の画面をキャプチャし、AskUserQuestion が出ていないか確認する。問題なければ Monitor を再起動 |

### TD-3.4. AskUserQuestion への応答

該当する選択肢の数字だけを send-keys する（Enter は送らない）。

```
tmux send-keys -t WINDOW.PANE '1'
```

選択肢にない回答をしたい場合は、まず Escape を送信してから指示を送る。

```
tmux send-keys -t WINDOW.PANE Escape
sleep 1
tmux send-keys -t WINDOW.PANE 'ここに指示内容'
tmux send-keys -t WINDOW.PANE Enter
```

### TD-3.5. セルフチェック → フェーズ遷移

**Step 1: window にセルフチェックを送信し、結果を待つ**

```
次のフェーズに進む前に、pdh-dev ワークフロー（.claude/skills/pdh-dev/SKILL.md）の現在のステージの完了条件を読み直し、`ticket.sh start`/`restore` 出力の `note:` パス（互換 symlink: `current-note.md`）のログと照合して、全てのステージを正しく踏んだか確認してください。ステージ遷移宣言（[PDH-*] -> [PDH-*] の形式）が抜けていれば補完してください。確認結果を報告してください。
```

**Step 2: Director が裏取りする**

`ticket.sh start`/`restore` 出力の `note:`/`ticket:` パス（互換 symlink: `current-note.md`/`current-ticket.md`）を Read し、次を確認する。チケットの規模に関わらず省略しない。

| 検証観点 | 確認方法 |
|---|---|
| PDH-review 完了 | レビュー構成の全員が修正後の最新版をレビューし、Critical/Major = 0 を回答しているか |
| テスト完了 | CLAUDE.md に定義されたテスト種別が全て実行され全件パスしているか |
| 実環境確認 | サーバー起動 + curl/Playwright での動作確認が実施されているか |
| AC 達成 | 形式的な達成ではなく、AC の意図（Why）を満たす実質的な達成か |
| 既存問題・残課題 | note に「対応検討」「スコープ外」「別チケット」等と記載された項目がないか。あればユーザに個別に提示し対応方針の判断を仰ぐ |

**Step 3: gate ならユーザに報告し承認を得る**

セルフチェック結果 + Director の裏取り結果をまとめて報告する。承認はユーザの明示的な意思表示（「OK」「y」「yes」「進めて」等）のみ有効。

問題がなく gate でもなければ、次フェーズの指示を送信して Monitor を再起動する。問題があれば是正指示を送って Monitor を再起動する。

## Constraints

ユーザから明示的に「Director が」「あなたが」と指示された場合を除き、以下を自分で行わない。

- pdh-dev 等の skill / ワークフローを実行しない
- ソースコードを編集しない
- チケットの開け閉め（ticket.sh）をしない
- サーバー起動・ビルド・seed 投入等の実作業を実行しない。状態を変更する操作は全て window に send-keys で指示する。Director が直接実行するのはスクリーンショット撮影・API 読み取り（curl GET）等の読み取り専用操作のみ
- 本番の状態を変える操作、とりわけ非可逆な操作（元に戻せない設定変更・リソースの作成/削除・データの書き込み）をしない。ユーザ承認を得たうえで worker に ticket の一部として実行させ、実行前後の状態・発行時刻・コマンド全文を note に記録させる
- `tmux capture-pane` を繰り返さない。Monitor に委任する

window への指示についても次を守る。

- window に「自分で判断して」「意思決定を任せる」的な指示を出さない。「判断して対応して」「適切に処理して」のように判断と実行をセットで委ねない。window に求めるのは情報の整理・分析までで、その結果をユーザに提示し、ユーザの判断を得てから実行を指示する
- ソースレベルの詳細な実装指示を出さない

やること。

- `product-brief.md`、Ticket、note を読んで状況を把握する
- window が PDH ワークフローに従い、テスト・E2E・AC チェックを飛ばしていないか、Monitor の報告で確認する
- 各 window の context 使用率を監視する。`tmux capture-pane` の status line の `ctx` 表示で分かる
- window の AskUserQuestion には自分で回答せず、ユーザに内容を提示して承認を得てから回答する
- ユーザに確認する際は、window の情報（検証手段・AC・状況・懸念事項）を十分にまとめて伝える

## コンテキスト管理

| | いつ | ユーザ承認 |
|---|---|---|
| `/compact` | 使用率が 50% を超えたら、適当なタイミングで | 不要 |
| `/clear` | 是正指示が 2 回効かないとき | 必要 |

短命な window（1 タスクで終わるもの）は `/compact` の対象外でよい。

| 送ってよい | 送ってはいけない |
|---|---|
| phase 遷移の直後（`PDH-implement` → `PDH-review` など） | 実装・修正の途中 |
| commit した直後 | gate 材料を作っている最中 |
| 長い background（フルスイート / codex gate / 実 API 実測）を待っている間 | 未 commit の変更があるとき |

### 送り方（compact / clear 共通）

1. window に状態を note へ落とすよう指示する
2. note へ落としたという返答を確認する（Monitor / transcript で。画面で判定しない）
3. slash command を literal な `send-keys` で送る（buffer 経由にしない）
4. `/clear` の場合のみ、続けて `/pdh-dev` を送って再開させる

次を note に書かせる。現在の ticket id と PDH stage、未解決の懸念（まだ誰にも言っていないものを含む）、ユーザの決定と明示承認、走らせていて結果が出ていないもの、次にやる具体的な 1 手。

### リセット（`/clear`）

window が是正指示を 2 回送っても同じ問題を繰り返す場合は、ユーザに状況を報告し、リセットの承認を得てから上記の送り方で `/clear` → `/pdh-dev` を実行する。

## 複数 window による並行チケット実行

1. 並行可能なチケットを特定する（互いに依存しない、同一ファイルを変更しない）
2. 完了した window には次の依存解消済みチケットを割り当てる

## ticket.sh の排他ロック（クロス OS）

worker への指示は「flock か mkdir-lock で排他」とし、特定コマンドの存在を前提にしない。

```sh
lock=/tmp/<project>-ticket.lock
if command -v flock >/dev/null 2>&1; then
  flock -x "$lock" bash ticket.sh "$@"
else                                   # macOS など flock 非同梱環境
  d="$lock.d"
  until mkdir "$d" 2>/dev/null; do sleep 0.2; done
  trap 'rmdir "$d" 2>/dev/null' EXIT
  bash ticket.sh "$@"
fi
```

## ticket close 後の後片付け（必須 3 点）

worker が ticket を close したら、次の ticket を割り当てる前に 3 点を実施する。

1. **その ticket のために起動したプロセスを止める。**dev server、検証用の `http.server`、`agent-browser` のセッション、その ticket 専用の Monitor が対象。「kickoff・note に記録された background」と「`ss -tlnp` で worktree 由来の listen port」の 2 経路で探す。**広いパターンの `pkill -f` を使わず、PID か port を特定して個別に kill する。**他 ticket・他 window のプロセスに触れず、誰が起動したか分からないプロセスはユーザに確認する。
2. **window を `/clear` する**（送り方は「送り方」節）。
3. **worker に `ExitWorktree()` を実行させ、main repo（main branch）へ戻す。**pane の処理が終わった時点で実行させる。Bash の `cd` でも `/clear` でも戻らない。`close --keep-worktree` で worktree 自体を残す場合も、worker の現在地は main に戻す。

## worker の /clear タイミング

| 状況 | 推奨アクション |
|---|---|
| Ticket close 直後（ctx 関係なし） | 必ず次 Ticket start 前に /clear。プロセス停止・main 復帰とセットで行う |
| worker ctx > 80% かつ bg task 実行中で Claude idle | 最低コストの /clear タイミング |
| worker ctx > 90% | Ticket 途中でも /clear を検討。Ticket 内進捗が commit 済なら手戻りほぼゼロ |

autonomous 連続走行（「T2-T6 まで自律で進めて」等）でも /clear gate をスキップしない。各 ticket close を察知して `/clear` → 次 Ticket kickoff の 2 段階を挟む。介入は hookbus Monitor から Stop event を受けたタイミング、または base_branch 切替依頼を受けたタイミングで行う。

手順: Escape（実行中の作業を停止）→ `send-keys '/clear'` → `send-keys Enter` → `sleep 2` → `send-keys '<resume kickoff>'` → `send-keys Enter`。

resume kickoff には次を含める。

- `EnterWorktree({path: "..."})` で worktree を再設定する（cwd は /clear で fallback する）
- 現状 state（branch、commit hash、残 Ticket、bg task があれば出力先パス）
- 次 phase の指示

## Director の wakeup 間隔（ScheduleWakeup / `/loop` 時）

- active（worker が blocker 質問を出しうる / 短い実装・レビューが終わりそう）: **240s**
- idle（全 worker が長時間の実装・レビューに入っている）: **1200s**
- **300s ちょうどは使わない。**270s 以下に抑えるか、1200s 以上にまとめる。

active / idle の判断は毎回行い、全 worker の状態が変わったタイミングで間隔を切り替える。Monitor Agent の 15 秒固定ループとは別レイヤである。

## 留意事項

- Director の window とワーカー window は異なる環境で動く可能性がある。ファイルパス、DB 接続、ポートアクセス、worktree の `.git` パスが環境間で異なることを前提にする
- Director は本 skill を起動した window であって、特定の window 番号ではない
- tmux capture で worker の入力欄に見える灰色のテキストは無視する。Tab で確定する補完候補であり、ユーザの書きかけ入力ではない
- PDH ワークフローから大きく外れる場合は、window への指示を止め、ユーザにその旨を伝えて判断を仰ぐ

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/claude/skills/tmux-director/SKILL.md
