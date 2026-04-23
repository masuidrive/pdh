# pdh-flowchart 技術計画と調査

調査日: 2026-04-23
対象 PRD: `product-brief.md`

## 1. 結論

MVP は TypeScript/Node.js の CLI ランタイムとして実装し、実行は Docker image 内に閉じ込める。Claude Code と Codex は最初から SDK 直結にせず、まず CLI adapter で非対話実行と JSON/JSONL stream を正規化する。状態機械は汎用 workflow engine を採用せず、YAML flow 定義を解釈する専用 Flow Engine と SQLite State Store で作る。

理由は以下。

- PRD の中心価値は汎用 orchestration ではなく、`pdh-dev` の gate semantics、note/ticket 正本、step 単位 resume である。
- Claude Code と Codex はどちらも非対話実行と機械可読 stream を提供しており、adapter 層で揃えられる。
- provider の自己申告ではなく guard の外部検証で step 完了を決めるため、provider SDK の内部状態より runtime 側の State Store が正本になる。
- Docker 内 permission bypass は便利だが危険なので、MVP でも container hardening と secret redaction を最初から入れる。

## 2. 調査結果

### 2.1 リポジトリ状況

- 現時点の作業ディレクトリには `product-brief.md` のみが存在する。
- ローカルの通常 PATH では `node` / `npm` / `codex` が見えないが、`source /home/masuidrive/.nvm/nvm.sh` 後は `node v24.14.0`、`npm 11.9.0`、`codex-cli 0.123.0` が使える。
- SQLite は Node.js の experimental `node:sqlite` を使えるため、初期実装は外部 DB dependency なしで進める。
- Docker image では Node.js、Codex CLI、Claude Code、SQLite runtime を明示的に含める前提にする。
- `product-brief.md` 末尾に不要な制御文字らしき行があるため、後で PRD の整形を推奨する。

### 2.2 Claude Code

使える実行形態:

- `claude -p "<prompt>"` で非対話実行できる。
- `--output-format json` は structured JSON、`--output-format stream-json` は newline-delimited JSON を返す。
- `--include-partial-messages` と `--verbose` により partial message や retry event を progress に反映できる。
- `--resume` / `--continue` で会話継続できる。
- `--bare` は scripted / SDK calls 向けに local hooks や plugins などの auto discovery を抑制する。
- `--dangerously-skip-permissions` は Docker 内に閉じた provider 実行 profile でのみ使う。

MVP 方針:

- review step の初期 provider にする。
- raw stream は `runs/<run_id>/steps/<step_id>/claude.raw.jsonl` に保存する。
- `session_id` は State Store の `provider_sessions` に保存し、resume 時に `--resume <session_id>` を使う。
- scripted 実行の再現性を優先する step では `--bare` を使い、明示的に必要な prompt/context/settings だけ渡す。

### 2.3 Codex

使える実行形態:

- `codex exec` は CI や scripted run 向けの非対話モードである。
- `codex exec --json` は JSONL stream を stdout に出し、`thread.started`、`turn.started`、`turn.completed`、`item.*`、`error` などを含む。
- item には agent message、reasoning、command execution、file changes、MCP tool calls、web searches、plan updates などが含まれる。
- `codex exec resume` で session ID または `--last` による再開ができる。
- `--full-auto` は `workspace-write` と `on-request` の低 friction preset。`--dangerously-bypass-approvals-and-sandbox` は isolated runner 内に限定する。
- TypeScript SDK もあり、Node.js 18 以上で thread start / resume を扱える。

MVP 方針:

- implement/edit step の初期 provider にする。
- raw stream は `runs/<run_id>/steps/<step_id>/codex.raw.jsonl` に保存する。
- `thread_id` は State Store の `provider_sessions` に保存し、resume 時に使う。
- 最初は CLI adapter を正本にし、SDK adapter は Phase 2 で検討する。CLI JSONL の方が Claude adapter と構造を揃えやすい。

### 2.4 State machine / engine

候補:

1. XState v5
   - 長所: TypeScript と相性が良く、actor persistence があり、状態機械として表現しやすい。
   - 短所: PRD の flow は YAML/JSON の data-driven step graph であり、guard は外部コマンドやファイル差分評価が中心。XState の snapshot だけでは provider raw log、artifacts、resume token の正本にならない。

2. 専用 Flow Engine
   - 長所: `pdh-dev` の step/gate/note/ticket semantics を直接モデル化できる。永続化と guard evidence を DB schema に合わせやすい。
   - 短所: 状態遷移テストや可視化は自前で用意する必要がある。

判断:

- MVP は専用 Flow Engine を採用する。
- 将来の visualizer や model-based testing が必要になったら、YAML flow から XState machine を生成する compatibility layer を追加する。

### 2.5 pdh-dev 正本ドキュメント

`~/Develop/pdh/skills/pdh-dev/SKILL.md` と `~/Develop/pdh/skills/tmux-director/SKILL.md` を読んだ結果、PRD の `PD-C-3` 〜 `PD-C-10` は以下の既存 semantics に合わせる必要がある。

- flow は Light / Full の 2 種類。Light は `PD-C-2`、`PD-C-4`、`PD-C-8` を省略し、`PD-C-3` に調査を統合する。
- `PD-C-5` と `PD-C-10` は必ず user gate。過去に OK が続いていても推測承認は不可で、明示的な意思表示だけを承認とする。
- gate 報告前に `current-ticket.md` と `current-note.md` を読み、ユーザがその報告だけで判断できる包括的 summary を作る。
- step 遷移は `[PD-C-X] -> [PD-C-Y]` の形式で宣言し、gate 未達なら後続 step を「完了」「進めた」と扱わない。
- `current-note.md` は Status、調査結果、計画、レビュー結果、プロセス通過証跡、Discoveries の正本。
- `current-ticket.md` は Why / What / プロダクト AC / Implementation Notes / Related Links の正本。
- プロダクト AC は ticket、レビュー済み・テストパスなどのプロセス要件は note に置く。
- 各 step 完了時に `[PD-C-X] ...` 形式でコミットする運用が定義されている。
- `PD-C-9` では AC 裏取り表が必須で、`unverified` が 1 件でもあれば `PD-C-10` に進めない。

このため、MVP の flow 定義は PRD 付録の単純 graph だけでなく、Light / Full variant、required note section、required ticket update、required commit、required human gate summary を表現できる必要がある。

## 3. 採用技術

### 3.1 Runtime

- Language: TypeScript
- Runtime: Node.js 22 LTS 以上を Docker image に固定
- Package manager: pnpm または npm。初期は npm で十分
- CLI framework: `commander`
- Schema validation: `zod`
- YAML parser: `yaml`
- Process runner: Node.js `child_process.spawn`。必要なら後で `execa`
- Storage: SQLite
- DB access: 初期は `better-sqlite3`。将来、採用 Node.js の `node:sqlite` が十分安定していれば標準 module へ寄せる。
- Test: `vitest`
- Lint/format: `eslint` + `prettier`

### 3.2 Provider tools in image

- `@openai/codex` CLI
- Claude Code CLI
- `git`
- `bash`
- `jq`
- `sqlite`
- project test dependencies は target repo 側に任せる

## 4. アーキテクチャ

```
host shell
  |
  | pdh-flowchart run ...
  v
docker container
  |
  +-- CLI command layer
  |     run / status / approve / reject / request-changes / resume / logs
  |
  +-- Flow Engine
  |     load flow, choose step, persist transitions, evaluate guards
  |
  +-- Provider Adapter Layer
  |     ClaudeAdapter, CodexAdapter
  |
  +-- Progress Bus
  |     raw provider event -> normalized progress event -> DB/JSONL/console
  |
  +-- Guard Runner
  |     git diff, file existence, command exit code, note/ticket update, human decision
  |
  +-- Repo Integration
  |     current-note.md, current-ticket.md, artifacts, changed file list
  |
  +-- State Store
        .pdh-flowchart/state.sqlite
        .pdh-flowchart/runs/<run_id>/*
```

## 5. データモデル

SQLite を正本にし、raw log と artifacts はファイルとして保存する。

主要 tables:

- `runs`
  - `id`, `flow_id`, `flow_variant`, `ticket_id`, `status`, `current_step_id`, `repo_path`, `created_at`, `updated_at`, `completed_at`
- `run_steps`
  - `id`, `run_id`, `step_id`, `attempt`, `round`, `provider`, `mode`, `status`, `started_at`, `finished_at`, `exit_code`, `summary`, `error`
- `provider_sessions`
  - `run_id`, `step_id`, `attempt`, `provider`, `session_id`, `resume_token`, `raw_log_path`
- `progress_events`
  - `id`, `run_id`, `step_id`, `attempt`, `ts`, `type`, `provider`, `message`, `payload_json`
- `guard_results`
  - `id`, `run_id`, `step_id`, `attempt`, `guard_id`, `status`, `evidence_json`, `checked_at`
- `human_gates`
  - `id`, `run_id`, `step_id`, `status`, `prompt`, `summary`, `decision`, `reason`, `created_at`, `resolved_at`
- `artifacts`
  - `id`, `run_id`, `step_id`, `kind`, `path`, `sha256`, `created_at`

Artifact layout:

```
.pdh-flowchart/
  state.sqlite
  flows/
    pdh-ticket-core.yaml
  runs/
    run-001/
      run.json
      progress.jsonl
      steps/
        PD-C-6/
          attempt-1/
            prompt.md
            codex.raw.jsonl
            final-message.md
            guard-results.json
            changed-files.json
            diff.patch
```

## 6. Flow 定義

PRD の YAML 例を拡張し、MVP では高度な DSL を入れない。ただし `pdh-dev` 正本に合わせて Light / Full variant と note/ticket guard を持つ。

```yaml
flow: pdh-ticket-core
version: 1
defaults:
  timeout_minutes: 60
  max_attempts: 2
  transition_log_format: "[{from}] -> [{to}]"

variants:
  light:
    initial: PD-C-3
    sequence: [PD-C-3, PD-C-5, PD-C-6, PD-C-7, PD-C-9, PD-C-10]
  full:
    initial: PD-C-2
    sequence: [PD-C-2, PD-C-3, PD-C-4, PD-C-5, PD-C-6, PD-C-7, PD-C-8, PD-C-9, PD-C-10]

steps:
  - id: PD-C-3
    provider: codex
    mode: read
    prompt_template: prompts/pd-c-3.md
    guards:
      - id: plan-recorded
        type: note_section_updated
        path: current-note.md
        section: "PD-C-3. 計画"
      - id: ticket-implementation-notes
        type: ticket_section_updated
        path: current-ticket.md
        section: "Implementation Notes"
      - id: step-commit
        type: git_commit_exists
        pattern: "^\\[PD-C-3\\]"
    on_success:
      light: PD-C-5
      full: PD-C-4
    on_failure: blocked

  - id: PD-C-5
    provider: runtime
    mode: human
    guards:
      - id: gate-summary
        type: artifact_exists
        kind: human_gate_summary
      - id: explicit-approval
        type: human_approved
    human_gate:
      prompt: "PD-C-5 implementation approval"
      required_sources: [current-ticket.md, current-note.md]
    on_human_approved: PD-C-6
    on_human_rejected: PD-C-3
    on_human_changes_requested: PD-C-3

  - id: PD-C-6
    provider: codex
    mode: edit
    prompt_template: prompts/pd-c-6-implement.md
    guards:
      - id: tests-pass
        type: command
        command: "npm test"
        optional: true
      - id: note-updated
        type: note_section_updated
        path: current-note.md
        section: "PD-C-6"
      - id: step-commit
        type: git_commit_exists
        pattern: "^\\[PD-C-6\\]"
    on_success: PD-C-7
    on_failure: PD-C-6
```

Guard types for MVP:

- `file_exists`
- `file_changed`
- `file_contains`
- `note_status_matches`
- `note_section_updated`
- `ticket_section_updated`
- `artifact_exists`
- `command`
- `git_clean_except`
- `git_commit_exists`
- `human_approved`

## 7. Provider Adapter Interface

```ts
export type AgentProviderName = "claude" | "codex";
export type StepProviderName = AgentProviderName | "runtime";
export type StepMode = "read" | "edit" | "review" | "human";

export interface ProviderRunInput {
  runId: string;
  stepId: string;
  attempt: number;
  provider: AgentProviderName;
  mode: Exclude<StepMode, "human">;
  cwd: string;
  promptPath: string;
  rawLogPath: string;
  resumeToken?: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export type ProviderEvent =
  | { type: "message"; text: string; partial?: boolean; raw: unknown }
  | { type: "tool_started"; tool: string; title?: string; raw: unknown }
  | { type: "tool_finished"; tool: string; exitCode?: number; raw: unknown }
  | { type: "file_changed"; path: string; raw: unknown }
  | { type: "retry"; attempt: number; reason?: string; raw: unknown }
  | { type: "completed"; finalMessage?: string; sessionId?: string; raw: unknown }
  | { type: "failed"; error: string; raw: unknown };

export interface ProviderAdapter {
  run(input: ProviderRunInput): AsyncIterable<ProviderEvent>;
  resume(input: ProviderRunInput): AsyncIterable<ProviderEvent>;
}
```

`provider: runtime` の human gate / metadata step は ProviderAdapter を通さず、Flow Engine が直接処理する。

Adapter command examples:

```sh
# Claude review. 実装では prompt text を argument array で渡す。
claude --bare -p "<prompt text>" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --permission-mode bypassPermissions

# Codex implement. `-` で stdin から prompt を渡す。
codex exec --json \
  --cd /workspace \
  --dangerously-bypass-approvals-and-sandbox \
  -
```

実装時は prompt を shell interpolation せず、stdin または argument array で渡す。

## 8. Human Gate

Human gate は provider 内の質問機能に寄せず、runtime の正式状態として扱う。

Flow:

1. Step provider run が完了する。
2. Guard Runner が evidence を生成する。
3. `human_gate` がある step は `needs_human` に遷移する。
4. `pdh-flowchart status <run_id>` が summary、変更ファイル、guard evidence、raw log path を表示する。
5. `approve`、`reject`、`request-changes`、`cancel` が `human_gates` に decision を保存する。承認はユーザの明示的な意思表示だけを有効にする。
6. Flow Engine が `on_human_approved` / `on_human_rejected` / `on_human_changes_requested` に遷移する。

Gate summary requirements:

- `current-ticket.md` と `current-note.md` を gate 直前に必ず読み直す。
- PD-C-5 は計画内容、設計判断、ファイル変更計画、テスト計画、実環境確認手順、懸念事項を提示する。
- PD-C-10 は AC 裏取り表、確認手順、作業サマリ、テスト結果、懸念事項、チケット化候補、Epic 残チケット状況を提示する。
- `current-note.md` の Status が gate 未達の後続 step に進んでいる場合は guard failure とする。

MVP では CLI のみ。簡易 Web UI は Phase 3 以降。

## 8.5 LLM 判定ポリシー

判定には LLM を使う。ただし LLM の出力だけで gate を通過させない。

Use LLM for:

- 計画レビュー、品質レビュー、目的妥当性確認、Surface Observer のような意味的判断
- gate summary、AC 裏取り表、note/ticket 更新案の生成
- `current-ticket.md` の AC と実装・テスト証跡の対応付け
- ambiguous な差し戻し理由の分類と次 step 候補の提案

Do not use LLM as sole authority for:

- human approval
- command / test の exit code
- file changed / section updated / git commit existence
- `unverified` AC の通過
- `ticket.sh start/close` の成否

Runtime rule:

- LLM 判定は `judgement_artifact` として保存する。
- Flow Engine は LLM artifact の schema、引用 evidence、対象ファイル・コマンドログの存在を guard で検証する。
- LLM が `verified` と言っても evidence がなければ `unverified` として扱う。
- LLM が迷った、または structured output が壊れた場合は fail closed にして `needs_human` または前 step 差し戻しにする。

## 9. Progress Event

Normalized event schema:

```json
{
  "ts": "2026-04-23T12:00:00.000Z",
  "run_id": "run-001",
  "step_id": "PD-C-6",
  "attempt": 1,
  "provider": "codex",
  "type": "tool_started",
  "message": "npm test",
  "payload": {
    "tool": "shell",
    "command": "npm test"
  }
}
```

Required event types:

- `step_started`
- `status`
- `message`
- `tool_started`
- `tool_finished`
- `file_changed`
- `retry`
- `ask_human`
- `step_finished`
- `guard_started`
- `guard_finished`
- `run_failed`
- `run_completed`

## 10. Docker 実行設計

MVP image:

```Dockerfile
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git bash ca-certificates jq sqlite3 bubblewrap \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex
# Claude Code CLI installation は公式 install 手順に合わせて固定する

WORKDIR /app
COPY . /app
RUN npm ci && npm run build

ENTRYPOINT ["node", "/app/dist/cli.js"]
```

Runtime options:

- repo mount: `/workspace`
- state: `/workspace/.pdh-flowchart`
- user: non-root UID/GID
- capabilities: `--cap-drop=ALL`
- rootfs: `--read-only` + writable tmpfs
- pids/memory/cpu limit を設定
- credentials は env または read-only secret mount
- raw logs には credential redaction filter を通す

Security note:

- Claude の `--dangerously-skip-permissions` と Codex の `--dangerously-bypass-approvals-and-sandbox` は、provider 内の安全境界を外す。
- Docker 内でも network egress が広いと被害範囲が残る。MVP では少なくとも target repo 以外を mount しない。Phase 1 完了条件として、egress proxy または Docker network policy による provider API / package registry 以外の制限を検討する。
- egress 制限が用意できない環境では、初期 profile を `codex --full-auto` と Claude `--permission-mode acceptEdits` に落とす運用 profile も持つ。

## 11. CLI UX

Commands:

```sh
pdh-flowchart init
pdh-flowchart run --flow pdh-ticket-core --ticket ticket-123
pdh-flowchart status run-001
pdh-flowchart logs run-001 --follow
pdh-flowchart approve run-001 --step PD-C-5
pdh-flowchart reject run-001 --step PD-C-5 --reason "Need more tests"
pdh-flowchart request-changes run-001 --step PD-C-10 --reason "Update current-note.md"
pdh-flowchart resume run-001
pdh-flowchart guards run-001 --step PD-C-6
```

Status view should show:

- run status
- current step
- provider / mode
- attempt number
- last normalized message
- running command if any
- changed files
- guard results
- human gate decision state
- resume hint

## 12. 実装マイルストーン

### Phase 0: 技術検証

Goal: provider stream と state persistence の実現性を潰す。

Tasks:

- Docker image prototype
- `ClaudeAdapter` spike: stream-json capture、session_id 保存、resume 確認
- `CodexAdapter` spike: `codex exec --json` capture、thread_id 保存、resume 確認
- raw event から normalized event への mapper 作成
- SQLite schema 初版
- `file_changed` / `command` guard prototype
- `note_section_updated` / `human_approved` guard prototype

Exit criteria:

- Claude と Codex の sample prompt が Docker 内で走る。
- raw log と progress log が保存される。
- provider process kill 後、step 単位で `resume` または再実行できる。
- fake run で `PD-C-5` の明示承認なしに `PD-C-6` へ進めない。

### Phase 1: MVP

Goal: Full flow の `PD-C-2` から `PD-C-10` を CLI で通す。Light flow は variant として残すが、MVP の実運用 smoke は Full を基準にする。

Tasks:

- `pdh-flowchart run/status/resume/logs` 実装
- YAML flow schema と validation
- Flow Engine の transition 実装
- Guard Runner 実装
- Human Gate commands 実装
- `current-note.md` / `current-ticket.md` 読込、Status guard、section update guard
- PD-C-5 / PD-C-10 gate summary artifact
- AC 裏取り表 guard
- step 完了 commit guard
- `./ticket.sh start/close` の runtime 実行
- provider step は patch 提案、runtime-controlled metadata と gate summary は自動書込する update policy
- LLM judgement artifact と evidence guard
- PD-C core flow と prompt templates
- unit tests for transition / guards / adapters mapper

Exit criteria:

- fake provider adapter で全 transition test が通る。
- real Claude / Codex adapter で smoke flow が 1 周する。
- review NG から fix step に戻る。
- human approval で停止し、approve 後に再開する。
- `unverified` AC がある状態では `PD-C-10` に進めない。
- `ticket.sh close` と step commit が runtime から直接実行され、失敗時は guard failure になる。

### Phase 2: 実運用対応

Goal: 長時間運用、失敗回復、note/ticket 正本性を強化する。

Tasks:

- step lock と concurrent run 防止
- retry/backoff policy
- secret redaction
- provider timeout と orphan process cleanup
- `current-note.md` / `current-ticket.md` patch apply mode と auto-write mode の policy 分離
- failed step の artifact summary
- structured review report schema
- optional Codex SDK / Claude Agent SDK adapter 評価

### Phase 3: 拡張

Goal: visualization と実チーム運用。

Tasks:

- simple web status UI
- flow graph export
- Epic flow support
- parallel reviewer
- GitHub/Slack/Linear integration

## 13. テスト計画

Unit tests:

- flow schema validation
- transition selection
- guard evaluation
- normalized event mapper
- state store migration

Integration tests:

- fake provider で success/failure/human/retry/resume
- temporary git repo で `file_changed` / `git_clean_except`
- Docker smoke test

Manual smoke tests:

- Claude review step
- Codex edit step
- provider crash and resume
- human approve/reject/request-changes

## 14. 未解決事項

### 決定済み

- MVP の初期実行対象は Full flow。Light は variant としてサポートする。
- note/ticket 更新の default policy は、provider step は patch 提案、runtime-controlled metadata と gate summary は自動書込。
- `./ticket.sh start/close` と step commit は runtime が直接実行する。
- 意味的判断には LLM を使う。ただし LLM 出力は evidence artifact であり、最終 gate は Flow Engine guard が判定する。
- `.env` の `OPENAI_API_KEY` は provider smoke / 動作確認でのみ使用する。通常の unit-style check では実 API を叩かない。
- 開発中は Docker 外で直接実行してよい。Codex smoke は既存の認証済み Codex CLI session を使い、`codex login` は実行しない。

### 実装済みメモ

- Node.js CLI skeleton、Codex adapter、SQLite state store、Full flow JSON、guard skeleton、calculator smoke を追加済み。
- `node src/cli.mjs smoke-calc` により Codex が `/tmp/pdh-flowchart-calc-smoke` に `uv run calc "1+2"` 対応の小アプリを作成し、Codex 内と wrapper verification の両方で `3` を確認済み。

### 未解決

1. Docker で permission bypass する場合の network egress 制限をどこまで MVP に入れるか。
2. Codex CLI と Claude Code CLI の version pinning 方法。Docker build 時の latest install は再現性が弱い。
3. State Store を repo 内 `.pdh-flowchart` に置くか、外部 volume に置くか。MVP は repo 内でよい。

## 15. 参照ソース

- OpenAI Codex non-interactive mode: https://developers.openai.com/codex/noninteractive
- OpenAI Codex CLI reference: https://developers.openai.com/codex/cli/reference
- OpenAI Codex SDK: https://developers.openai.com/codex/sdk
- OpenAI Codex sandboxing: https://developers.openai.com/codex/concepts/sandboxing
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-usage
- Claude Code programmatic usage: https://code.claude.com/docs/en/headless
- Claude Agent SDK overview: https://code.claude.com/docs/en/agent-sdk
- XState docs: https://stately.ai/docs
- XState persistence: https://stately.ai/docs/persistence
- pdh-dev skill source: `/home/masuidrive/Develop/pdh/skills/pdh-dev/SKILL.md`
- tmux-director gate source: `/home/masuidrive/Develop/pdh/skills/tmux-director/SKILL.md`
