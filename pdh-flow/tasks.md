# pdh-flow タスク

## Phase 1: Repo-Centric Runtime

- [x] runtime metadata block を `current-note.md` の frontmatter に置き換える。
- [x] `current-ticket.md` には runtime state を持ち込まない。
- [x] canonical state model から SQLite を外す。
- [x] `.pdh-flow/` は一時的なローカル artifact のみを保持する。
- [x] run state、progress event、attempt、gate、cleanup のための repo-centric runtime helper を追加する。
- [x] prompt 生成は compiled flow semantics ベースのまま維持する。
- [x] canonical file の全文を provider prompt に inline するのをやめる。

## Phase 2: CLI Redesign

- [x] `run`、`run-next`、`status`、`run-provider`、`resume` を repo-centric にする。
- [x] `run-next` をデフォルトの自動進行コマンドとして維持する。
- [x] 明示的な human gate と interruption answer を維持する。
- [x] runtime signal 経由で制御を戻す stop-state assist command を追加する。
- [x] prompt、judgement、verify、gate summary 用の debug command を維持する。
- [x] 一時的な run artifact の cleanup 挙動を追加する。
- [x] `smoke-calc` は意図的な real-provider check のみとして維持する。

## Phase 3: Web UI Redesign

- [x] DB-backed な run list UI を、単一の active repo dashboard に置き換える。
- [x] Web UI は read-only のまま維持する。
- [x] current step、次アクション、flow progress、log、artifact、git summary を表示する。
- [x] 指定された dashboard の visual direction をベーススタイルとして使う。
- [x] 右ペインの step contract を `flows/pdh-ticket-core.yaml` に移す。
- [x] provider が書く `ui-output.yaml` と runtime が書く `ui-runtime.yaml` を追加する。
- [x] 右ペインの mock を、実際の merged UI data に置き換える。
- [x] Web UI から stop-state assist session を browser 内 terminal で起動できるようにする。

## Phase 4: Verification

- [x] fixture runtime test を repo-centric command 向けに書き直す。
- [x] gate open -> approve -> stop-after-step の user flow を検証する。
- [x] provider の success / failure / resume / interruption handling を検証する。
- [x] Web UI API と read-only 挙動を検証する。
- [x] `npm run check` を実行する。
- [x] `npm run test:runtime` を実行する。

## Phase 5: Documentation

- [x] frontmatter-first state model に合わせて `product-brief.md` を書き直す。
- [x] repo-centric CLI と transient artifact に合わせて `technical-plan.md` を書き直す。
- [x] 新しい user flow に合わせて `README.md` を書き直す。
- [ ] example fixture docs と sample canonical file を更新する。
- [ ] この repo 内の `current-ticket.md` と `current-note.md` を新しい model に合わせて更新する。

## Deferred

- [ ] Docker 化した実行環境と hardening。
- [ ] Epic flow support。
- [x] reviewer の並列実行 support。
- [x] runtime 主導の review repair / re-review loop。
- [ ] より豊かな review result schema。
- [ ] CLI path が安定した後の optional SDK adapter。

## Next: Structured Runtime Artifacts

- [ ] `current-note.md` の frontmatter を拡張し、gate summary status や rerun target のような current-state field をコンパクトに持たせる。
- [ ] `runtime-supervisor.json` の lifecycle check を close / cleanup path に追加し、cleanup が完了しない場合は fail safe にする。
- [ ] `step-record.json` を step ごとの主要な record guard input として追加する。
- [ ] `step-commit.json` を主要な commit guard input として追加し、commit subject regex を主 authority から外す。
- [ ] `ac-verification.json` を追加し、markdown AC table を primary authority として扱うのをやめる。
- [ ] markdown section diff ベースの rerun 判定を、structured gate baseline artifact と git file change ベースに置き換える。
- [ ] structured artifact が揃った後、markdown body section guard を廃止する。
