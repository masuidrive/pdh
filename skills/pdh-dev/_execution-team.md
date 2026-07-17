# PDH Dev — 実行モデル: Team (multi-agent CLI)

このファイルはteamの役割と実行方法だけを定義する。
フローとgateは`_principles.md`、`_reference.md`、`_flow.md`、`_review.md`、`_collaboration.md`を参照する。

---

## 役割定義

- PM (Director)：進行管理、判断、統合、ユーザ報告を担い、判断とdispatchに専念する
- Coding Engineer：`pdh-coding`に従い、1 agentでinvestigate、implement、testsを完遂する
- QA Engineer：test、E2E、doc再生成などの機械的検証を担う
- Devil's Advocate：実装後にuser視点の厳しいreviewを担う
- Code Reviewer：実装後に品質、regression、認可漏れ、整合性をreviewする
- AC裏取りAgent：`PDH-verify`で各ACの実達成をcode、test、noteから検証する
- Surface Observer：consumer視点の実機で外部surfaceを観察する。純backendで外部変更なしならskipできる

## PM の責務と禁止事項

PMが行うこと：

- review結果をtriageし、採否と修正方針を決める
- severityだけで修正せず、AC、current diff、user journeyとの因果で採用、follow-up、棄却を決める
- 修正前に複雑度差分を確認し、永続stateまたは公開surface追加案を削除、拒否、制約案と比較する
- workerをspawnしてdispatchする
- noteとticketの更新、commit、ユーザ報告を行う
- ticket提出前とspawn prompt提出前に`_reference.md`の成果物self-checkを行う
- worker結果を正典、ticket、diff、実コマンド出力、note証跡で検品し、stage遷移を判断する

PMが行わないこと：

- source codeの直接編集。Coding Engineerへ委譲する
- testの直接実行。QAへ委譲する
- doc再生成。QAへ委譲する
- review後のcode修正。Coding Engineerへ委譲する
- reviewer findingを未分類のままCoding Engineerへ渡すこと
- 修正確認ごとに全diffを再reviewし、新規findingを掘り続けること

### Director のモデル固定

Directorは自分のengine、model、profile、reasoning effortを自律変更しない。
当該作業でユーザが明示指定した場合だけ変更できる。
実行基盤が自動変更した場合は事実を記録して報告し、Directorの要求または追認扱いしない。
worker割当変更をDirector自身のmodel変更の代用にしない。

## エンジン割り当て（既定 = main と同一 / プロジェクト規約で上書き）

- worker engineは既定でmainと同一にする
- per-role engineまたはmodelの上書きと混在は、project規約で明示された場合だけ許す
- cross-model必須triggerでは、最低1 reviewを生成modelと異なるmodelへ割り当てる。不能時は`_review.md`の代替と理由をnoteへ残す
- cross-delegateはCoding Engineerだけに許す。逆engine CLIの存在を確認し、session初回implement時に1回だけユーザへ確認し、その回答を以後のticketへ適用する
- cross-delegate時もCoding Engineer以外はmainと同一engineを使う
- 特定engineをworkflowへhardcodeしない

## spawn 機構（engine 中立 = subprocess / 結果はファイル）

workerはCLI subprocessで起動し、結果を専用fileで回収する。
workerが起動できない場合はDirector単独でstage完了扱いせず、中止、報告、またはユーザ確認へ切り替える。

projectの実行profileとapproval policyを優先し、承認済みin-process subagent機構があれば優先する。
**`--dangerously-*`系bypass flagは、ユーザまたはsessionが明示許可した場合だけ使う。**

### worker prompt の組み立て

promptは「共通context + 役割別指示 + task固有依頼」で組み立てる。
共通contextは`_subagent-context.md`を使い、`<TICKET_FILE>`、`<NOTE_FILE>`、`<BRANCH>`、`<SCOPE>`、`<RESULT_FILE>`を実値で埋める。
promptはfileへ書き出し、stdinでworkerへ渡す。

### 起動コマンド（engine 別・権限は環境規約に従う）

承認待ちが発生したらbypassせず、ユーザ承認を得るか承認済みin-process機構へ切り替える。
起動commandは割当engineに従い、run環境の認証を継承する。

```bash
# claude
claude -p < "$promptfile" > "$d/result.txt" 2> "$d/stderr.log"

# codex
codex exec -o "$d/result.txt" < "$promptfile" 2> "$d/stderr.log"
```

### 並行起動（必須パターン: `&` background + PID 配列 + wait + exit code）

独立workerは同一Bash呼出し内でbackground並行起動し、PIDごとに`wait`してexit codeを回収する。
各workerへ専用dirとresult fileを割り当て、同一fileへの同時書込みを避ける。

```bash
declare -A PID2NAME RC
launch() { # launch <name> <engine> <promptfile>
  local name="$1" engine="$2" pf="$3" d="/tmp/wk-$1"
  mkdir -p "$d"
  if [ "$engine" = codex ]; then
    codex exec -o "$d/result.txt" < "$pf" 2> "$d/stderr.log" &
  else
    claude -p < "$pf" > "$d/result.txt" 2> "$d/stderr.log" &
  fi
  PID2NAME[$!]="$name"
}
for pid in "${!PID2NAME[@]}"; do
  wait "$pid"
  RC[${PID2NAME[$pid]}]=$?
done
```

workerごとにrc、resultとstderrの`ls -l`、stderr末尾120行を診断証跡へ残す。
non-zero rcまたは空もしくは欠落resultでは、rcとstderrを併読して報告する。
spawn失敗時は単独続行しない。

同時worker数が多い場合はbatch分割して起動上限を設ける。
mainとworkerが同じengineならin-process並行spawnを使える。
cross-engineとheadless CIはsubprocessを使う。

## チーム運用・サブエージェント運用

### 原則

read-only taskは並行Review Agentへ、write taskは1人のCoding Engineerへ割り当てる。
PMはsource codeを直接編集しない。

### spawn のルール

workerのengineとmodelはprojectのrole規約に従い、最小能力の軽量modelへ落とさない。
spawn promptには次を必ず含める。

- taskの目的と背景
- 対象file path
- ticketのAC、Architectural Invariants check、確定判断、Out-of-scope
- 衝突しない担当範囲
- Coding Engineerには`pdh-coding`を先に読む指示

### サブエージェント委譲ルール

- review系workerはread-onlyにする
- ユーザ指定reviewer構成を省略、短縮、統合で代替しない
- 複数reviewer指定時は各reviewerが同じdiff全体を見て、担当分けだけで代替しない
- 大規模検索、history調査、品質review、全test、doc再生成、実動確認はsubagentを優先する
- subagent結果は要約、結論、失敗点、次actionだけに絞る
- 並行reviewerに同じ`result.txt`を編集させず、各responseをPMが統合する

---

## team での各 PDH stage 実行手順

### PDH-open: ticket を開く (PM が担当)

PMは`_flow.md`の`PDH-open`に従い、ticketとnoteを確定する。

### PDH-ticket-review: ticket contract check (PM が担当)

PMはticket contractを整える。
AC承認は次のhuman reviewまで得ない。

### PDH-ticket-human-review: 実装前の人間レビュー (PM が担当)

PMはticket修正点、概要、達成内容、AC、Out-of-scope、判断点を会話で説明し、明示承認までimplementへ進まない。

### PDH-implement: 実装

PMはCoding Engineer 1人をspawnする。
整合性gate後にQAをspawnして完了checkし、失敗はCoding Engineerへ戻す。

### PDH-review: 品質検証

初回reviewは1人以上を並行起動し、同一SHAのdiff全体を見せる。
修正後は元finding、再現条件、修正diffだけを同じreviewerへ確認させる。
finding修正はCoding Engineer、test再実行はQAへ委譲し、重要findingが残らないまでattemptを記録する。

stage遷移をユーザへ宣言する。

### PDH-verify: 完了検証

AC裏取りAgentを1人spawnし、各ACの実達成を検証させる。
Surface Observer前に`./scripts/dev-server.sh --seed`を実行する。
外部surface変更時はObserverをspawnし、browser surfaceは実composed pageで対象SHA付き証跡を残す。

### PDH-human-review: 人間レビュー

PMは差分、検証結果、ユーザ自身の確認手順を提示し、明示承認までcloseへ進まない。

### PDH-close: クローズ

`PDH-human-review`承認後に`_flow.md`へ従い`./ticket.sh close`を実行する。

### stage 遷移の宣言

stageを移るたびにユーザへ宣言する（`_reference.md`「stage 遷移の宣言」）。

### main engine の選択

main engineが未指定で曖昧な場合だけ`which codex`でCLI存在を確認し、ユーザへclaudeまたはcodexの選択を求める。
headless環境では実行系の指定を使い、指定がなければ既定claudeとする。
