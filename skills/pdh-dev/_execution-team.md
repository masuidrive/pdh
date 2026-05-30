# PDH Dev — 実行モデル: Team (multi-agent CLI)

このファイルは **multi-agent CLI 実行** の実行モデルを定義する。「誰が・どう実行するか」のみを扱う。フローのルール・gate・観点は共有 core (`_principles.md` / `_reference.md` / `_flow.md` / `_review.md` / `_collaboration.md`) を参照すること。

---

## 役割定義

- **PM (Director)** = 進行管理、判断、統合、ユーザ報告。**判断と dispatch に専念し、機械的タスクは全て委譲する**
- **Coding Engineer** = 実装。`pdh-coding` skill に従う。1 agent が investigate + implement + tests を 1 session で完遂する
- **QA Engineer** = テスト実行、E2E 確認、ドキュメント再生成 (OpenAPI / SDK モデル) など機械的検証
- **Devil's Advocate** = 実装後 review。ユーザの立場から厳しい指摘
- **Code Reviewer** = 実装後 review。コード品質・回帰・認可漏れ・整合性
- **AC 裏取り Agent** = PD-C-9 で各 AC が実際に達成されているかコード・テスト・ノートを読んで検証
- **Surface Observer** = consumer 視点で実機 (browser / curl / SDK 直叩き) で外部 surface を観察。自動テストが拾えない視覚崩れ・レスポンスボディ違和感・エラー文言の分かりにくさを目視。外部 surface 変更がない純 backend ticket では skip 可

## PM の責務と禁止事項

PM がやる:
- レビュー結果の triage、採否決定、修正方針
- Agent の spawn / dispatch
- note / ticket 更新、コミット、ユーザ報告
- 成果物セルフチェック (`_reference.md`「成果物セルフチェック」) を PM が担当 (ticket 提出前 / spawn prompt 提出前)

**PM がやらない (必ず委譲):**
- ソースコード直接編集 → Coding Engineer
- テスト実行 (pytest / vitest / playwright 等) → QA Engineer
- ドキュメント再生成 (OpenAPI / SDK モデル) → QA Engineer
- 修正後のコード修正 → Coding Engineer (PM が直接 Edit しない)

## エンジン割り当て（既定 = main と同一 / プロジェクト規約で上書き）

- **既定**: worker（Coding Engineer / reviewer / QA / AC 裏取り / Surface Observer）は **main（PM）と同じ engine** を使う。main が claude なら worker も claude、main が codex なら worker も codex。
- **上書き**: プロジェクト規約（各 engine が自動ロードする規約ファイル等）で per-role の engine / model が指定されている場合のみ、それに従う（claude / codex の **混在も可**。例「DA は claude 固定」「PD-C-7 に別 engine の reviewer を1人加える」等は、**明示されたときだけ**有効）。
- 特定 engine をフローに**ハードコードしない**（engine 中立）。「常に codex」「常に claude」のような既定の決め打ちはしない。

## spawn 機構（engine 中立 = subprocess / 結果はファイル）

worker は **CLI subprocess** で起動し、結果はファイルで回収する。これで main が claude / codex どちらでも、worker が claude / codex どちらでも、同じ仕組みで混在できる。

### worker prompt の組み立て

各 worker の prompt は **「共通コンテキスト + 役割別追加」** で作る:
1. **共通**: `.claude/skills/pdh-dev/_subagent-context.md` の内容を冒頭に置き、`<TICKET_FILE>` / `<NOTE_FILE>` / `<BRANCH>` / `<SCOPE>` / `<RESULT_FILE>` を実値で埋める（worker は履歴を持たないので、PDH 前提・チケット位置・不可侵・出力先がここで伝わる）。
2. **役割別**: 同ファイルの「役割別の追加指示」から該当ロール分を続ける + そのタスク固有の依頼。

prompt は**ファイルに書き出して** stdin で渡す（長文・日本語・特殊文字の shell quoting 事故を避ける）。

### 起動コマンド（engine 別・bypass 権限・this の通りに使う）

main が相手 engine の CLI 作法を知らなくても起動できるよう両 engine 分を明記する。worker は **bypass 権限**（headless で承認に止まらない）。

**claude worker:**
```bash
claude -p --dangerously-skip-permissions < "$promptfile" > "$d/result.txt" 2> "$d/stderr.log"
```
**codex worker:**
```bash
codex exec --dangerously-bypass-approvals-and-sandbox -o "$d/result.txt" < "$promptfile" 2> "$d/stderr.log"
```
worker の **engine は「エンジン割り当て」に従う**（既定 = main と同一、混在可）。認証は run の環境変数を継承（追加設定不要）。

### 並行起動（必須パターン: `&` background + PID 配列 + wait + exit code）

独立した複数 worker（PD-C-7 の複数 reviewer 等）は **1 つの Bash 呼び出し内で `&` で同時に background 起動し、PID を配列に集め、各 PID を `wait` して exit code を回収する**。逐次起動は直列化して遅いので避ける。各 worker は **専用の dir / result ファイル**（同一ファイルを複数に書かせない＝ race 回避）。

```bash
declare -A PID2NAME RC
launch() {  # launch <name> <engine> <promptfile>
  local name="$1" engine="$2" pf="$3"
  local d="/tmp/wk-$name"; mkdir -p "$d"
  if [ "$engine" = codex ]; then
    codex exec --dangerously-bypass-approvals-and-sandbox -o "$d/result.txt" < "$pf" 2> "$d/stderr.log" &
  else
    claude -p --dangerously-skip-permissions < "$pf" > "$d/result.txt" 2> "$d/stderr.log" &
  fi
  PID2NAME[$!]="$name"
}
# 例: reviewer を2人 同時起動（engine は「エンジン割り当て」に従う）
launch reviewer1 "$ENGINE" /tmp/p-rev1.txt
launch reviewer2 "$ENGINE" /tmp/p-rev2.txt
for pid in "${!PID2NAME[@]}"; do wait "$pid"; RC[${PID2NAME[$pid]}]=$?; done
# 各 worker の result を読み、exit code 非ゼロ / 空 result は stderr.log で原因を掴む（silent fail にしない）
```

- **失敗検知**: `RC[name]` が非ゼロ、または `result.txt` が空なら、その `stderr.log` を読んで原因を結果に含める。**spawn が失敗したら単独続行せず中止・報告**（solo フォールバックは持たない）。
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
  - PD-C-7 品質レビューの観点別レビュー
  - **テスト全件実行** → QA Engineer (PM が直接 pytest / vitest / playwright を実行しない)
  - **ドキュメント再生成** (OpenAPI validate/export, SDK モデル生成) → QA Engineer
  - API や frontend の実動確認をまとめて行う検証タスク
- サブエージェントから戻す内容は、要約・結論・失敗点・次アクションだけに絞る
- **並行 reviewer には worktree の `result.txt` を編集させない**。レビュー結果は agent の最終テキスト出力 (response message) として返させ、PM が統合して記録する。複数 reviewer が同じ result file を書くと race condition で結果欠落・上書きが起きるため

---

## team での各 PD-C step 実行手順

### PD-C-1: 開始前チェック + AC 承認 (PM が担当)

PM が `_flow.md` の PD-C-1 手順を実行する。AC 承認はユーザへの明示確認で得る。

### PD-C-6: 実装

PM は「エンジン割り当て」に従って **Coding Engineer (1 agent) を spawn** する（既定 engine = main）。

spawn prompt に `_flow.md` の「実行指示の必須内容」を含める。

完了後、PM は整合性 gate を確認してから、**QA Engineer を spawn** して完了チェックを委譲する。

全パスなら実装チームを解散し、コミット (例: `[PD-C-6] Implementation`)。失敗があれば Coding Engineer に差し戻す。

### PD-C-7: 品質検証

**1 人以上の reviewer を並行起動**する（依存関係がないため「spawn 機構」の `&`+`wait` で並行）。各 reviewer の engine は「エンジン割り当て」に従う（既定 = main と同一、プロジェクト規約で上書き・混在可）:
- **Devil's Advocate**: セキュリティ脆弱性、設計上の論理バグ、AC 達成の実質判定。
- **Ticket 不可侵 check**: implementor が AC / out-of-scope / Architectural Invariants を勝手に書き換えていないか。
- 各 reviewer は **同じ差分全体**を見る。複数回 / 複数観点で union を取る（`_review.md`）。

修正は **Coding Engineer に委譲**（PM が直接コードを編集しない）。テスト再実行は **QA Engineer に委譲**。指摘 → 修正 → 再レビューを **No Critical/Major になるまでループ**（`_review.md` の収束ルール）。

ステップ遷移の宣言はユーザに行う。

### PD-C-9: 完了検証

**AC 裏取り Agent ×1 を spawn**（engine は「エンジン割り当て」に従う）。各 AC 項目が実際に達成されているかコード・テスト結果・ノートを読んで検証させる。

外部 surface 変更がある場合、**Surface Observer を spawn** し consumer 視点の違和感を観察させる。

### PD-C-10: クローズ

`_flow.md` の PD-C-10 手順に従い、ユーザに報告してクローズ承認を得る。承認後 `./ticket.sh close`。

### ステップ遷移の宣言

step を移動するたびに **ユーザに宣言**する (`_reference.md` 「ステップ遷移の宣言」参照)。

### main engine の選択

main（PM）の engine が未指定で曖昧な場合のみ、`which codex` で codex CLI の存在を確認し、ユーザに「claude / codex どちらで進めますか」と確認する（既指定なら不要）。worker は既定で main と同一 engine（上の「エンジン割り当て」）。bot 文脈では `CODING_ROBOT_ENGINE` が main engine。
