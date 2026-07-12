# PDH Dev — 実行モデル: Team (multi-agent CLI)

このファイルは **multi-agent CLI 実行** の実行モデルを定義する。「誰が・どう実行するか」のみを扱う。フローのルール・gate・観点は共有 core (`_principles.md` / `_reference.md` / `_flow.md` / `_review.md` / `_collaboration.md`) を参照すること。

---

## 役割定義

- **PM (Director)** = 進行管理、判断、統合、ユーザ報告。**判断と dispatch に専念し、機械的タスクは全て委譲する**
- **Coding Engineer** = 実装。`pdh-coding` skill に従う。1 agent が investigate + implement + tests を 1 session で完遂する
- **QA Engineer** = テスト実行、E2E 確認、ドキュメント再生成 (OpenAPI / SDK モデル) など機械的検証
- **Devil's Advocate** = 実装後 review。ユーザの立場から厳しい指摘
- **Code Reviewer** = 実装後 review。コード品質・回帰・認可漏れ・整合性
- **AC 裏取り Agent** = PDH-verify で各 AC が実際に達成されているかコード・テスト・ノートを読んで検証
- **Surface Observer** = consumer 視点で実機 (browser / curl / SDK 直叩き) で外部 surface を観察。自動テストが拾えない視覚崩れ・レスポンスボディ違和感・エラー文言の分かりにくさを目視。外部 surface 変更がない純 backend ticket では skip 可

## PM の責務と禁止事項

PM がやる:
- レビュー結果の triage、採否決定、修正方針
- Agent の spawn / dispatch
- note / ticket 更新、コミット、ユーザ報告
- 成果物セルフチェック (`_reference.md`「成果物セルフチェック」) を PM が担当 (ticket 提出前 / spawn prompt 提出前)
- 各 worker の結果を正典・ticket・diff・実コマンド出力・note の証跡で検品し、stage 遷移の可否を判断する

**PM がやらない (必ず委譲):**
- ソースコード直接編集 → Coding Engineer
- テスト実行 (pytest / vitest / playwright 等) → QA Engineer
- ドキュメント再生成 (OpenAPI / SDK モデル) → QA Engineer
- 修正後のコード修正 → Coding Engineer (PM が直接 Edit しない)

## エンジン割り当て（既定 = main と同一 / プロジェクト規約で上書き）

- **既定**: worker（Coding Engineer / reviewer / QA / AC 裏取り / Surface Observer）は **main（PM）と同じ engine** を使う。main が claude なら worker も claude、main が codex なら worker も codex。
- **上書き**: プロジェクト規約（各 engine が自動ロードする規約ファイル等）で per-role の engine / model が指定されている場合のみ、それに従う（claude / codex の **混在も可**。例「DA は claude 固定」「PDH-review に別 engine の reviewer を1人加える」等は、**明示されたときだけ**有効）。
- **cross-delegate 構成（対応する CLI が両方 install されている場合の任意構成）**: Coding Engineer（実装 worker）だけを **main と逆の engine へ委譲**する構成を取れる（main = claude → 実装 worker = codex / main = codex → 実装 worker = claude）。採用条件は次の 2 つ:
  1. 逆 engine の CLI が install されていること（`which codex` / `which claude` で確認）
  2. **セッションで最初に実装（PDH-implement）へ入る時に 1 回だけ**、ユーザへ「Coding Engineer を逆 engine へ委譲するか / main と同一のままにするか」を確認し、回答をそのセッションの既定として以後の全 ticket に適用する（ticket ごとに再確認しない）。tmux-director 構成では Director がユーザに確認し、決定を worker への kickoff に明記する
  委譲時のモデル・reasoning 設定はプロジェクト規約で指定する（例は各プロジェクトの規約ファイル側に置く）。Coding Engineer 以外の worker（reviewer / QA / AC 裏取り / Surface Observer / PM）は main と同一 engine のまま。
- 特定 engine をフローに**ハードコードしない**（engine 中立）。「常に codex」「常に claude」のような既定の決め打ちはしない。

## spawn 機構（engine 中立 = subprocess / 結果はファイル）

worker は **CLI subprocess** で起動し、結果はファイルで回収する。これで main が claude / codex どちらでも、worker が claude / codex どちらでも、同じ仕組みで混在できる。

各 PDH stage は該当 role の worker へ分けて実行する。worker の出力は承認ではなく入力であり、PM (Director) が正典・diff・実出力と照合して初めて stage gate を通過できる。worker が起動できない場合、PM は単独で完了扱いにせず、中止・報告またはユーザ確認に切り替える。

この repo では `CLAUDE.md` の Agent 実行プロファイルと実行環境の approval policy を優先する。
Codex の `multi_agent` や Claude Code の in-process Agent/Task など承認つきの subagent 機構が使える場合はそれを優先する。
`--dangerously-*` 系の bypass flag は、ユーザまたはセッションが明示許可した時だけ使う。

### worker prompt の組み立て

各 worker の prompt は **「共通コンテキスト + 役割別追加」** で作る:
1. **共通**: `.claude/skills/pdh-dev/_subagent-context.md` の内容を冒頭に置き、`<TICKET_FILE>` / `<NOTE_FILE>` / `<BRANCH>` / `<SCOPE>` / `<RESULT_FILE>` を実値で埋める（worker は履歴を持たないので、PDH 前提・チケット位置・不可侵・出力先がここで伝わる）。
2. **役割別**: 同ファイルの「役割別の追加指示」から該当ロール分を続ける + そのタスク固有の依頼。

prompt は**ファイルに書き出して** stdin で渡す（長文・日本語・特殊文字の shell quoting 事故を避ける）。

### 起動コマンド（engine 別・権限は環境規約に従う）

main が相手 engine の CLI 作法を知らなくても起動できるよう両 engine 分を明記する。
承認待ちが発生する場合は、勝手に bypass せず、ユーザ承認を得るか利用可能な in-process subagent 機構へ切り替える。

**claude worker:**
```bash
claude -p < "$promptfile" > "$d/result.txt" 2> "$d/stderr.log"
```
**codex worker:**
```bash
codex exec -o "$d/result.txt" < "$promptfile" 2> "$d/stderr.log"
```
worker の **engine は「エンジン割り当て」に従う**（既定 = main と同一、混在可）。認証は run の環境変数を継承（追加設定不要）。

### 並行起動（必須パターン: `&` background + PID 配列 + wait + exit code）

独立した複数 worker（PDH-review の複数 reviewer 等）は **1 つの Bash 呼び出し内で `&` で同時に background 起動し、PID を配列に集め、各 PID を `wait` して exit code を回収する**。逐次起動は直列化して遅いので避ける。各 worker は **専用の dir / result ファイル**（同一ファイルを複数に書かせない＝ race 回避）。

```bash
declare -A PID2NAME RC
launch() {  # launch <name> <engine> <promptfile>
  local name="$1" engine="$2" pf="$3"
  local d="/tmp/wk-$name"; mkdir -p "$d"
  if [ "$engine" = codex ]; then
    codex exec -o "$d/result.txt" < "$pf" 2> "$d/stderr.log" &
  else
    claude -p < "$pf" > "$d/result.txt" 2> "$d/stderr.log" &
  fi
  PID2NAME[$!]="$name"
}
# 例: reviewer を2人 同時起動（engine は「エンジン割り当て」に従う）
launch reviewer1 "$ENGINE" /tmp/p-rev1.txt
launch reviewer2 "$ENGINE" /tmp/p-rev2.txt
for pid in "${!PID2NAME[@]}"; do wait "$pid"; RC[${PID2NAME[$pid]}]=$?; done
# 各 worker の result を読み、exit code 非ゼロ / 空 result は rc と stderr tail で原因を掴む（silent fail にしない）
for name in "${!RC[@]}"; do
  d="/tmp/wk-$name"
  {
    echo "## worker: $name"
    echo "rc=${RC[$name]}"
    echo "### ls -l"
    ls -l "$d/result.txt" "$d/stderr.log" 2>&1
    echo "### tail -120 stderr.log"
    tail -120 "$d/stderr.log" 2>&1
  } >> /tmp/agent-result.md
done
```

- **診断証跡**: worker 起動後は必ず `wait` 後に `rc=$?` を保存する。複数 worker の場合も各 worker ごとに rc、result/stderr の `ls -l`、`tail -120 stderr.log` を `/tmp/agent-result.md` の final report に残す。
- **失敗検知**: `RC[name]` が非ゼロ、または `result.txt` が空/無い場合は、その worker の rc と `stderr.log` tail をセットで読んで原因を結果に含める。result が空/無いことだけで silent failure と誤判定しない。**spawn が失敗したら単独続行せず中止・報告**（solo フォールバックは持たない）。
- 同時数が多いときは数体ずつに分けて起動上限を設ける（リソース保護）。

main が claude で worker も claude の場合は in-process の Agent/Task ツールで並行 spawn してもよい（軽量）。ただし **cross-engine、および bot（headless CI）では上記 subprocess パターンが前提**。

## チーム運用・サブエージェント運用

### 原則

- 「読むだけ」のタスク (レビュー / 調査) は Review Agent を並行実行し、「書く」タスク (実装) は Coding Engineer (1 agent) を使う
- **PM (Director) がソースコードを直接編集しないこと**

### spawn のルール

- チームメイトは PM の会話履歴を引き継がない。spawn プロンプトに以下を必ず含める:
  - タスクの目的と背景
  - 対象ファイルパス
  - 該当 Ticket の AC + Architectural Invariants check + 確定判断 + out-of-scope
  - 担当範囲 (他のチームメイトとの衝突を避けるため、ただし Coding Engineer は基本 1 agent)
  - **`pdh-coding` skill を読んでから作業開始すること** (Coding Engineer 用)
- 各役割の engine / model は「エンジン割り当て」（既定 = main と同一、プロジェクト規約で上書き）に従う。最小能力の軽量モデルに落とさない

### サブエージェント委譲ルール

- **メインコンテキスト汚染を避けるため**、調査・レビュー・長時間テスト・実動確認は積極的にサブエージェントへ委譲する
- レビュー系は読み取り専用にする
- ユーザが指定した reviewer 構成は、省略・短縮・統合で代替してはならない
- ユーザが複数 reviewer を求めた場合、各 reviewer は **同じ差分全体** を見る。担当分けレビューは補助であり代替ではない
- 特に以下はサブエージェント優先:
  - blast radius 用の大規模検索
  - `git log` / `git blame` / ticket 履歴調査
  - PDH-review 品質レビューの観点別レビュー
  - **テスト全件実行** → QA Engineer (PM が直接 pytest / vitest / playwright を実行しない)
  - **ドキュメント再生成** (OpenAPI validate/export, SDK モデル生成) → QA Engineer
  - API や frontend の実動確認をまとめて行う検証タスク
- サブエージェントから戻す内容は、要約・結論・失敗点・次アクションだけに絞る
- **並行 reviewer には worktree の `result.txt` を編集させない**。レビュー結果は agent の最終テキスト出力 (response message) として返させ、PM が統合して記録する。複数 reviewer が同じ result file を書くと race condition で結果欠落・上書きが起きるため

---

## team での各 PDH stage 実行手順

### PDH-open: ticket を開く (PM が担当)

PM が `_flow.md` の `PDH-open` 手順を実行し、作業対象の ticket / note を確定する。

### PDH-ticket-review: ticket contract check (PM が担当)

PM が `_flow.md` の `PDH-ticket-review` 手順を実行し、ticket contract を整える。AC 承認はここでは得ず、次の `PDH-ticket-human-review` で得る。

### PDH-ticket-human-review: 実装前の人間レビュー (PM が担当)

PM が `_flow.md` の `PDH-ticket-human-review` 手順に従い、ticket review で修正した点、全体概要、達成するもの、AC、out-of-scope、判断ポイントを会話上で説明する。ユーザの明示承認なしに PDH-implement へ進まない。

### PDH-implement: 実装

PM は「エンジン割り当て」に従って **Coding Engineer (1 agent) を spawn** する（既定 engine = main）。

spawn prompt に `_flow.md` の「実行指示の必須内容」を含める。

完了後、PM は整合性 gate を確認してから、**QA Engineer を spawn** して完了チェックを委譲する。

全パスなら実装チームを解散し、必要ならコミット (例: `[PDH-implement] Implementation`)。失敗があれば Coding Engineer に差し戻す。

### PDH-review: 品質検証

**1 人以上の reviewer を並行起動**する（依存関係がないため「spawn 機構」の `&`+`wait` で並行）。各 reviewer の engine は「エンジン割り当て」に従う（既定 = main と同一、プロジェクト規約で上書き・混在可）:
- **Devil's Advocate**: セキュリティ脆弱性、設計上の論理バグ、AC 達成の実質判定。
- **Ticket 不可侵 check**: implementor が AC / out-of-scope / Architectural Invariants を勝手に書き換えていないか。
- 各 reviewer は **同じ commit SHA の差分全体**を見る。最初の attempt は複数観点で union を取り、修正後は影響する reviewer だけ再確認する（`_review.md`）。

修正は **Coding Engineer に委譲**（PM が直接コードを編集しない）。テスト再実行は **QA Engineer に委譲**。指摘 → 修正 → `PDH-review-N` attempt 追加で重要指摘が残らないことを確認する（`_review.md` の収束ルール）。

stage 遷移の宣言はユーザに行う。

### PDH-verify: 完了検証

**AC 裏取り Agent ×1 を spawn**（engine は「エンジン割り当て」に従う）。各 AC 項目が実際に達成されているかコード・テスト結果・ノートを読んで検証させる。

Surface Observer の前に、PM は UI / API surface 用の開発サーバを `./scripts/dev-server.sh --seed` で起動する。`--seed` は local 環境をリセットして `scripts/seed-pdh-verify.sh` を実行する。固定 port が必要なら `--port <port>` を使い、未指定なら script が空き port をランダム選択する。ticket の再現可能な product 検証条件が不足する場合だけ `scripts/dev-server.sh` / seed hook を更新し、sandbox・端末・local login 等の環境固有制約は local 設定か一時コマンドで扱う。repo / ticket に seed hook が無ければ作り、seed 不要なら no-op として成功させる。外部 surface 変更がある場合、**Surface Observer を spawn** し consumer 視点の違和感を観察させる。UI / browser surface がある場合は、human review 前に実 dev-server の composed page を `agent-browser` 等で操作し、対象 commit SHA と結果または実行不能理由を残す。

### PDH-human-review: 人間レビュー

PM が `_flow.md` の PDH-human-review 手順に従い、差分・検証結果・確認手順をユーザに提示してレビューを依頼する。これは coding agent がやったこと・達成したことがユーザの想定と合っているかをすり合わせる場である。レビュー可能な UI / API がある場合は `./scripts/dev-server.sh` で開発サーバを起動し、ユーザがブラウザまたは `curl` で直接確認できる手順を提示する。手作業が難しい場合は `tmp/` の一時スクリプトで補助する。ここまでは自動で進める。ユーザの明示承認なしに PDH-close へ進まない。

### PDH-close: クローズ

`_flow.md` の PDH-close 手順に従い、PDH-human-review の承認後に `./ticket.sh close`。

### stage 遷移の宣言

stage を移動するたびに **ユーザに宣言**する (`_reference.md` 「stage 遷移の宣言」参照)。

### main engine の選択

main（PM）の engine が未指定で曖昧な場合のみ、`which codex` で codex CLI の存在を確認し、ユーザに「claude / codex どちらで進めますか」と確認する（既指定なら不要）。worker は既定で main と同一 engine（上の「エンジン割り当て」）。headless/CI 文脈では、その実行系が定義する環境変数を main engine とする（無ければ既定 claude）。
