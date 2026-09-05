# PDH Dev — Codex worker の実行

## 役割と割り当て

Director は目的、合意、担当範囲、結果を管理する。調査・実装は一つの文脈で進め、独立レビューと達成確認を実装者の自己判定から分ける。単純な作業を役割数だけに分割せず、必要な検証と利用可能な実行枠に応じて担当を置く。

配布の `.codex/agents/pdh-*.toml` が役割ごとの model と reasoning effort を定める。ユーザーが今回指定した方針を優先し、起動時に実効設定を確認する。親の高価なモデルを意図せず全 worker へ継承しない。軽量化だけを目的に能力を落とさず、再試行を含む品質・使用量・時間で割り当てを見直す。

Astra は困難な判断の再評価や明示された評価担当に限定する。通常の named agent 定義に固定された model は spawn 引数より優先されるため、異モデル評価には必要な規則と model を指定した別の実行を使う。起動できない model を別名で代用したり、要求した model を実測した model と称したりしない。

## worker prompt の組み立て

`PDH-AGENTS.md`「Worker Instructions」の入力と、`_subagent-context.md` の該当役の指示を渡す。`<TICKET_FILE>`、`<NOTE_FILE>`、`<BRANCH>`、`<SCOPE>`、`<RESULT_FILE>`、`<TESTS_DIR>`、`<TMP_DIR>` は実値へ置き換える。

- `<TMP_DIR>` は `ticket.sh start`/`restore` 出力の `tmp_dir:`、`<TESTS_DIR>` は `ticket_dir:` に `/tests/` を足す。legacy flat layout は `tests/tickets/<id>/` を使う。
- レンズ1 reviewer には Why の原文と対象の作業 tree を渡し、ticket・note・diff・実装者の結論は渡さない。共通指示の該当参照も除く。
- AC 読み手は親の会話履歴・project context を継承しない新規 context で起動し、該当規則、What の冒頭文、AC 全件だけを転記する。`_subagent-context.md` の共通コンテキストは渡さず、repo を探索させない。in-process でこの入力境界を保証できない場合は、下記の隔離した CLI 起動を使う。
- 書き込み担当と実行環境を明示する。read-only の担当は最終 message で結果を返し、結果ファイルへの書き込みを要求しない。
- 指定された reviewer 構成を省略・統合しない。各担当の起動、完了、結果の回収までを確認する。

## 起動と回収

利用可能な Codex の in-process subagent 機構を優先する。配布の定義名は実装 `pdh-coding-engineer`、レビュー `pdh-reviewer` / `pdh-reviewer-lens1`、検証 `pdh-qa` / `pdh-ac-verifier` / `pdh-surface-observer`、AC 読み手 `pdh-ac-reader`。

CLI が必要な場合は、担当ごとに固有の出力ディレクトリと prompt ファイルを用意し、通常は対象 worktree を cwd とする。AC 読み手の `$worker_worktree` は application の外にある中立な隔離 cwd とし、祖先ディレクトリからの自動読込も含め application の AGENTS・project context が入らないようにする。空の Git repo は CLI が要求する場合だけ初期化する。現在の `codex exec --help` とプロジェクトの権限規約を確認する。次の変数には選定済みの値と絶対パスを入れる。

```bash
codex exec --json --model "$worker_model" \
  -c "model_reasoning_effort=\"$worker_effort\"" \
  --cd "$worker_worktree" -o "$worker_output/result.md" \
  - < "$worker_prompt" > "$worker_output/events.jsonl" 2> "$worker_output/stderr.log"
```

CLI 呼び出しでは named agent の developer instructions が自動で適用されると仮定せず、担当の規則を prompt に含める。sandbox と承認は実行環境に従い、承認待ちを bypass flag で解決しない。

各実行の終了コード、最終回答、失敗理由を回収する。non-zero、出力欠落、途中終了は成功に数えない。JSON の当該実行に属する usage と経過時間を記録し、取得できない値は不明とする。親子の usage が別集計なら、その範囲も記録する。

独立した読み取りは実行枠の範囲で並行できる。書き込みは担当境界を分け、すべての起動に対して完了を待ち結果を回収する。共通の一時ファイル名で結果を上書きしない。

## 各 stage の出口

- **PDH-implement**: 実装担当が調査・実装・必要な検証を完遂する。QA には未確認の経路と既存の実行証拠を渡し、同じテストを理由なく重複させない。
- **PDH-review**: 対象の版を固定して独立レビューを行う。Director が指摘を裁定して実装担当へ戻し、修正確認は `_review.md` に従う。
- **PDH-verify**: AC 裏取りが各条件と証拠を突き合わせる。変更した外部 surface は実際の consumer 操作を観察し、不足を補う。
- その他の stage は Director が `_flow.md` に従って進める。worker を使えないときは独立性に関する制約を記録し、必要な検査の代替を検討する。
