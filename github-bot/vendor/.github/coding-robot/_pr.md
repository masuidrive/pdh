# PR モード = 実装（ticket を読んで実装・テスト）

PR に 🤖 が付いたときのあなたの仕事は、その PR の head ブランチ上で **チケットを実装**すること。

フロー正本は `.claude/skills/pdh-dev/_flow.md`（PD-C-6/7/9/10）/ `_review.md`（収束性診断・スコープ外既存問題の扱い・裏取りルール）/ `_execution-team.md`（spawn 機構・並行起動・worker prompt の組み立て）/ `_subagent-context.md`（worker 共通プロンプト）。**正本に従う**。以下は coding-robot harness 固有の補足のみ：

1. このブランチ（`agent/issue-<N>`）に対応するチケットを特定する。`tickets/` 内の `*issue-<N>*.md`（または「PDH モード」の式で算出した `TICKET_NAME`）。見つからない場合は実装に進まず、先に Issue でチケットを作るよう報告する。`current-ticket.md` / `current-note.md` の symlink を張り直し、frontmatter の `started_at` が未設定なら今（UTC）を設定。
2. **harness の hard timeout 対策（PD-C-6 中）**:
   - **Commit 早期義務**: worker は spawn 後の最初の意味ある変更で *先に commit + push してから* scoped テストを回す（最初の commit は spawn から *15 分以内*が目安）。push されていない作業は harness の hard timeout（`DEADLINE_UNIX`）で消失する。
   - **長時間 gate の前に push**: `scripts/test-all.sh` 等の長時間ジョブを回す前に、未 push の変更があれば必ず push してから実行する。
   - **test-all 前の deadline チェック**: Environment Variables の `DEADLINE_UNIX` を見て、残時間が test-all の想定実行時間 + 5 分のマージンを下回るなら、フル実行せず scoped に留めて「deadline 不足のため test-all はスキップ／scoped で代替、PD-C-9 に委譲」を note に記録して進める（kill されるより合理的）。
   - test cadence 本体（scoped中／test-all 1回／失敗時 triage）と round escalation policy は `_flow.md` PD-C-7 / `_review.md` 収束性診断・スコープ外既存問題の扱い に従う。
3. **worker spawn の失敗報告**: worker 起動後は必ず `wait` 後に `rc=$?` を保存し、最終レポートには各 worker の rc、result/stderr の `ls -l`、`tail -120 stderr.log` を含める。result が空/無い場合も、それだけで silent failure と扱わず rc と stderr tail をセットで報告する。spawn が失敗/不可能なら単独で続行せず中止し原因を報告する。
4. **最終レポートは PD-C-9 到達状況で分岐**：
   - **到達 + 自己チェック通過** → `_flow.md` PD-C-10 の「完了報告の必須要素」に従う（実装内容・PD-C-7/C-9 結果・各 AC の達成状況）。PR モードなので PR は既にある → 追加コメントとして post。
   - **到達できず途中終了** → 共通 `system.md` の「For Incomplete / Early Termination」テンプレートに切り替え。category は time / decision / blocker / non-convergence / spawn-failure から 1 つを 1 行目に出し、`What was done (committed)` / `What was NOT done (remaining)` / `Decision needed from user` / `Evidence pointers` を埋める。次回 `🤖` の続行で何を再開すればよいか分かる状態にする。Issue モード step 4 と同じ category 分類とトリガー（DEADLINE_UNIX 近接、AC 解釈の分岐、pre-existing major、3+ round 同型再発、worker 起動失敗）。
5. クローズ（`tickets/<TICKET_NAME>.md` を `tickets/done/` へ移動 + `closed_at` 設定）は **AC 達成 + ユーザー承認後**（PD-C-10）。原則 **PR マージで完了**とし、未承認の段階では done に移動しない。
