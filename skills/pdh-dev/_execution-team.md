# PDH Dev — 実行モデル: Team (multi-agent CLI)

## 役割

spawn する役は PM (Director)、Coding Engineer、QA Engineer、Devil's Advocate、Code Reviewer、AC 裏取り Agent、Surface Observer。各役の規則は `_subagent-context.md` が指す skill にある。

PM は source code の編集・test の実行・doc 再生成・review 後の修正を行わず、担当 worker へ委譲する。reviewer finding は判定（採用 / 起票 / 記録のみ / 棄却）を付けてから Coding Engineer へ渡す。ticket 提出前と spawn prompt 提出前に `_reference.md`「成果物セルフチェック」を行う。

## エンジン割り当て（既定 = main と同一 / プロジェクト規約で上書き）

- worker engine は既定で main と同一にする。per-role の engine / model 上書きと混在は project 規約に明示された場合だけ許す
- worker の model を最小能力の軽量 model へ落とさない
- cross-delegate は Coding Engineer だけに許す。逆 engine CLI の存在を確認し、session 初回 implement 時に 1 回だけユーザへ確認して、その回答を以後の ticket へ適用する
- main engine が未指定で曖昧なときだけ、利用可能な CLI を確認してユーザへ聞く。既指定なら聞かず session 中は継続する。headless / CI では、その実行系が定義する環境変数を main engine とする
- Coding Engineer（実装 worker）を最上位クラスの汎用 coding モデルで動かすときは reasoning effort を `medium` にする。探索・判断・review の役（architecture 検討、root cause 切り分け、review / verify）は既定の effort を使う

## spawn 機構（engine 中立 = subprocess / 結果はファイル）

worker は CLI subprocess で起動し、結果を専用 file で回収する。承認済み in-process subagent 機構があれば優先する。**`--dangerously-*` 系 bypass flag は、ユーザまたは session が明示許可した場合だけ使う。**承認待ちが発生したら bypass せず、承認を得るか in-process 機構へ切り替える。

### worker prompt の組み立て

prompt は「共通 context + 役割別指示 + task 固有依頼」で組み立てる。共通 context は `_subagent-context.md` を使い、`<TICKET_FILE>`、`<NOTE_FILE>`、`<BRANCH>`、`<SCOPE>`、`<RESULT_FILE>`、`<TESTS_DIR>`、`<TMP_DIR>` を実値で埋める。必須項目は `PDH-AGENTS.md`「Worker Instructions」にある。

- `<TMP_DIR>` は `ticket.sh start`/`restore` 出力の `tmp_dir:` パス、`<TESTS_DIR>` は同出力の `ticket_dir:` パス + `/tests/`（legacy flat layout では `tests/tickets/<id>/`）で導出する
- `<RESULT_FILE>` は worker が file tool で書く成果物 file であり、stdout とは別のパス（例: `$d/result.md`）を worker ごとに割り当てる
- レンズ1 reviewer には `<TICKET_FILE>`・`<NOTE_FILE>`・diff を渡さない。共通 context の該当 2 行は `(レンズ1のため非提供)` へ置き換え、役割別指示は「reviewer（レンズ1）」block を使い、Why の原文を prompt 本文へ転記する
- ユーザ指定の reviewer 構成を省略・短縮・統合で代替しない。複数 reviewer 指定時は各 reviewer が同じ diff 全体を見る（レンズ1 を除く）

配布の agent 定義が配置されているとき（Claude Code: `.claude/agents/pdh-*.md`、Codex: `.codex/agents/pdh-*.toml`）は、in-process spawn で定義名を指定して起動する（実装は `pdh-coding-engineer`、review は `pdh-reviewer`/`pdh-reviewer-lens1`、QA は `pdh-qa`、verify は `pdh-ac-verifier`/`pdh-surface-observer`、AC 読み手は `pdh-ac-reader`）。prompt は task 固有依頼だけでよいが、次は従来どおり含める。

- `PDH-AGENTS.md`「Worker Instructions」の必須項目と上記 placeholder の実値
- AC 読み手（`pdh-ac-reader`）は read tool を持たないので、`pdh-verifying`「AC 読み手（復元テスト）」節の本文を prompt へ転記する
- read-only sandbox の定義で動く役（Codex の reviewer / AC 裏取り / AC 読み手）には `<RESULT_FILE>` を割り当てず、結果を最終 message で回収する

prompt は file へ書き出し、stdin で worker へ渡す。

### 起動コマンド（engine 別・権限は環境規約に従う）

```bash
# claude（stdout は診断 log。成果物は worker が <RESULT_FILE>=$d/result.md へ書く）
claude -p < "$promptfile" > "$d/stdout.log" 2> "$d/stderr.log"

# codex（-o は最終 message の控え。成果物は同上）
codex exec -o "$d/last-message.txt" < "$promptfile" > "$d/stdout.log" 2> "$d/stderr.log"
```

回収は `<RESULT_FILE>` を読む。無ければ無言終了として扱い、`stdout.log`/`last-message.txt`/`stderr.log` の末尾から原因を診断する。

### main = Claude Code のときの codex worker 起動

Bash ツールで直接実行する。codex plugin 等の別経路があっても使わない。

- `run_in_background: true` で非同期にし、`timeout` は 7200000（120 分）にする
- 長文・複数段落・特殊文字・日本語主体の prompt は file へ書き出し `< <dir>/prompt.txt` で渡す。短く quoting が安全なものだけ引数で渡してよく、その場合だけ stdin を `< /dev/null` にする
- worktree 中の ticket へ実行するときは `cd <worktree> && codex exec ...` の形にする
- 完了通知後は `<RESULT_FILE>` だけ Read する。stderr.log は失敗時に `tail -50` 程度で部分読みする

### 並行起動（必須パターン: `&` background + PID 配列 + wait + exit code）

独立 worker は同一 Bash 呼出し内で background 並行起動し、PID ごとに `wait` して exit code を回収する。

```bash
# ⚠ 連想配列 (declare -A) を使わない — macOS 既定の bash 3.2 に無い
pids=/tmp/wk-pids; rcs=/tmp/wk-rc; : > "$pids"; : > "$rcs"
launch() { # launch <name> <engine> <promptfile>
  local name="$1" engine="$2" pf="$3" d="/tmp/wk-$1"
  mkdir -p "$d"
  if [ "$engine" = codex ]; then
    codex exec -o "$d/last-message.txt" < "$pf" > "$d/stdout.log" 2> "$d/stderr.log" &
  else
    claude -p < "$pf" > "$d/stdout.log" 2> "$d/stderr.log" &
  fi
  echo "$! $name" >> "$pids"
}
# …launch を worker の数だけ呼ぶ…
while read -r pid name; do
  wait "$pid"; echo "$name $?" >> "$rcs"
done < "$pids"
```

worker ごとに rc と stderr 末尾を診断証跡へ残す。non-zero rc または空・欠落 result では、rc と stderr を併読して報告する。

同時worker数が多い場合はbatch分割して起動上限を設ける。

## team での各 PDH stage 実行手順

- **PDH-implement**：Coding Engineer 1 人を spawn する。整合性 gate 後に QA を spawn して完了 check し、失敗は Coding Engineer へ戻す
- **PDH-review**：初回 review は 1 人以上を並行起動し、同一 SHA の diff 全体を見せる（レンズ1 を除く）。finding 修正は Coding Engineer、test 再実行は QA へ委譲する。attempt 運用と修正確認の範囲は `_review.md` に従う
- **PDH-verify**：AC 裏取り Agent を 1 人 spawn する。Surface Observer 前に `./scripts/dev-server.sh --seed` を実行し、外部 surface 変更時は Observer を spawn する
- 上記以外の stage は PM が担当し、`_flow.md` に従う
