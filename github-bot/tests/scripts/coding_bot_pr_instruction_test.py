"""Dispatched PR tasks preserve the normal bot trust and push boundaries."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]


class DispatchedPRTest(unittest.TestCase):
    def test_task_fallback_posts_to_linked_issue_before_progress_exists(self):
        steps = yaml.safe_load((ROOT / ".github/workflows/coding-bot.yml").read_text())["jobs"]["agent"]["steps"]
        fallback = next(s for s in steps if s.get("name") == "Report if the run left nothing")
        agent = next(s for s in steps if "CODING_BOT_CI_WORKFLOW" in s.get("env", {}))
        self.assertEqual(fallback["env"]["PR_INSTRUCTION"], agent["env"]["PR_INSTRUCTION"])
        for progress in (None, "", "invalid", "0"):
            with self.subTest(progress=progress), tempfile.TemporaryDirectory() as d:
                if progress is not None:
                    (Path(d) / ".coding-bot-task-progress").write_text(progress)
                result = self.bash('gh() { printf "CALL %s\\n" "$*"; }; ' + fallback["run"],
                    PR_INSTRUCTION="task", PR="34", REPO="team/repo", ISSUE="",
                    TRUSTED_ISSUE="12", EVENT_IS_PR="true",
                    CONCLUSION="failure", RUN_URL="run", GITHUB_WORKSPACE=d)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("repos/team/repo/issues/12/comments", result.stdout)
                self.assertNotIn("repos/team/repo/issues/34/comments", result.stdout)
                self.assertIn("指定仕事が結果を残さずに終了", result.stdout)
                self.assertNotIn("-X PATCH", result.stdout)

    def test_pr_task_ci_uses_configured_workflow_only_for_token_head_changes(self):
        source = (ROOT / ".github/coding-bot/run-action.sh").read_text()
        prefix = source.split("save_unpushed_commits() {", 1)[0]
        block = source.split("# A limited PR task must not enter", 1)[1].split("\n", 1)[1].split("# CI 自動修正では", 1)[0]
        with tempfile.TemporaryDirectory() as d:
            def git(*args):
                return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null",
                    "-c", "user.name=CI test", "-c", "user.email=ci@example.invalid", *args], cwd=d, text=True).strip()
            git("init", "-q", "-b", "task")
            (Path(d) / "output").write_text("start")
            git("add", "output")
            git("commit", "-qm", "start")
            starting = git("rev-parse", "HEAD")
            (Path(d) / "output").write_text("moved")
            git("commit", "-qam", "moved locally")
            moved = git("rev-parse", "HEAD")
            for auth, head, engine_exit, dispatch in (("github_token", moved, "0", True),
                    ("github_token", starting, "0", False), ("pat", moved, "0", False),
                    ("github_token", moved, "1", True)):
                with self.subTest(auth=auth, head=head, engine_exit=engine_exit):
                    git("update-ref", "refs/remotes/origin/agent/issue-12", head)
                    result = self.bash(prefix + '\ncd "$TEST_REPO"\ngh() { printf "CALL %s\\n" "$*"; };\n' + block,
                        PR_INSTRUCTION="task", GITHUB_REPOSITORY="team/repo", PROGRESS_COMMENT_ID="99",
                        GITHUB_WORKSPACE=d, CLAUDE_OUTPUT="done", ENGINE_EXIT_CODE=engine_exit,
                        HEAD_SHA=starting, TEST_REPO=d, BRANCH_NAME="agent/issue-12", ORIGIN_PUSH_AUTH=auth,
                        CI_WORKFLOW="custom-ci.yml")
                    self.assertEqual(result.returncode, int(engine_exit), result.stderr)
                    self.assertEqual("workflow run custom-ci.yml --ref agent/issue-12 --repo team/repo" in result.stdout, dispatch)

    def bash(self, script, **env):
        return subprocess.run(["bash", "-c", script], cwd=ROOT,
                              env={**os.environ, "GITHUB_OUTPUT": os.devnull, "RUNNER_TEMP": tempfile.gettempdir(), "TARGET_REASON":"", **env}, text=True, capture_output=True)

    def test_inputs_are_data_and_pr_requires_instruction(self):
        for issue, pr, instruction, valid in (
                ("12", "34", "line one\n$(exit 99); `exit 99`", True),
                ("12", "", "", True), ("", "", "", True),
                ("", "34", "task", False), ("", "34", "", False),
                ("", "0", "task", False), ("", "34; exit 0", "task", False),
                ("", "", "task", False)):
            with self.subTest(issue=issue, pr=pr, valid=valid):
                result = self.bash('source .github/coding-bot/resolve-target.sh; '
                                   'gh() { printf \'{"number":12}\\n\'; }; '
                                   'validate_dispatch_request "$TASK_ISSUE" "$TASK_PR" "$TASK_TEXT"',
                                   TASK_ISSUE=issue, TASK_PR=pr, TASK_TEXT=instruction,
                                   GITHUB_REPOSITORY="team/repo")
                self.assertEqual(result.returncode == 0, valid)

    def test_workflow_rejects_missing_task_paths_before_runner(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/coding-bot.yml").read_text())
        steps = workflow["jobs"]["agent"]["steps"]
        validate = next(step for step in steps if step.get("name") == "Validate dispatch task")
        self.assertEqual(validate["env"]["PR_TASK_ALLOWED_PATHS"], "${{ inputs.allowed_paths }}")
        for pr, instruction, paths, valid in (
                ("34", "task", "", False), ("34", "task", '["output.json"]', True),
                ("", "", "", True)):
            with self.subTest(pr=pr, paths=paths):
                result = self.bash('gh() { if [[ "$2" == */pulls/34 ]]; then echo \'{"state":"open","head":{"ref":"agent/issue-12","repo":{"full_name":"team/repo"}}}\'; else echo \'{"number":12}\'; fi; }; ' + validate["run"], DISPATCH_ISSUE="12" if pr else "", DISPATCH_PR=pr,
                                   PR_INSTRUCTION=instruction, PR_TASK_ALLOWED_PATHS=paths, RESOLVE_CONFLICT_PR="", GITHUB_REPOSITORY="team/repo")
                self.assertEqual(result.returncode == 0, valid, result.stderr)
                if not valid:
                    self.assertIn("allowed_paths is required", result.stdout)

    def test_pr_provenance_and_closed_pr_fail_closed(self):
        for state, branch, repo, valid in (
                ("open", "agent/issue-12", "team/repo", True),
                ("closed", "agent/issue-12", "team/repo", False),
                ("open", "feature/12", "team/repo", False),
                ("open", "agent/issue-12", "fork/repo", False)):
            with self.subTest(state=state, branch=branch, repo=repo):
                result = self.bash('''source .github/coding-bot/resolve-target.sh
gh() {
  case "$*" in
    *pulls/34*) jq -n --arg state "$TASK_STATE" --arg ref "$TASK_BRANCH" --arg repo "$TASK_REPO" '{state:$state,head:{ref:$ref,repo:{full_name:$repo}}}' ;;
    *issues/12*) echo '{"number":12}' ;;
    *) return 1 ;;
  esac
}
validate_pr_context team/repo 34 && [ "$TARGET_PR_STATE" = open ]
''', TASK_STATE=state, TASK_BRANCH=branch, TASK_REPO=repo, PR_INSTRUCTION="task")
                self.assertEqual(result.returncode == 0, valid)

    def test_partial_task_commits_are_never_salvaged(self):
        source = (ROOT / ".github/coding-bot/run-action.sh").read_text()
        function = source.split("save_unpushed_commits() {", 1)[1].split("\n}\n", 1)[0]
        result = self.bash('save_unpushed_commits() {' + function + '\n}\n'
                           'git() { exit 99; }; save_unpushed_commits', PR_INSTRUCTION="task")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_dispatched_task_hooks_have_no_stage_or_label_side_effects(self):
        for mode in ("start", "progress", "failed", "final"):
            with self.subTest(mode=mode):
                result = self.bash('gh() { echo unexpected-write >&2; return 99; }; export -f gh; '
                                   'bash "$HOOK_SCRIPT" "$TASK_MODE" 12 agent/issue-12 1',
                                   PR_INSTRUCTION="task", TASK_MODE=mode,
                                   HOOK_SCRIPT=str(next(p for p in (ROOT/".github/coding-bot/pdh-hooks.sh", ROOT/"pdh-hooks.sh") if p.is_file())))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr, "")

    def test_interrupted_task_does_not_enter_normal_reply_or_label_flow(self):
        job = yaml.safe_load((ROOT / ".github/workflows/coding-bot.yml").read_text())["jobs"]["agent"]
        step = next(s for s in job["steps"] if s.get("name") == "Report if the run left nothing")
        self.assertIn("inputs.instruction", step["env"]["PR_INSTRUCTION"])
        for conclusion in ("cancelled", "failure", "success"):
            with self.subTest(conclusion=conclusion), tempfile.TemporaryDirectory() as d:
                result = self.bash('gh() { printf "CALL %s\\n" "$*"; }; ' + step["run"],
                    PR_INSTRUCTION="task", GITHUB_WORKSPACE=d, GITHUB_STEP_SUMMARY=str(Path(d)/"summary"),
                    ISSUE="34", TRUSTED_ISSUE="12", REPO="team/repo", CONCLUSION=conclusion, RUN_URL="run")
                self.assertEqual(result.returncode, 0, result.stderr)
                if conclusion == 'success':
                    self.assertIn("issue comment 12", result.stdout)
                    self.assertIn("作業は終わりましたが、報告の投稿に失敗しました", result.stdout)
                else:
                    self.assertIn("repos/team/repo/issues/12/comments", result.stdout)
                self.assertNotIn("awaiting-reply", result.stdout)
                self.assertNotIn("もう一度やらせるには", result.stdout)
                summary=(Path(d)/"summary").read_text()
                self.assertIn('報告の投稿に失敗しました' if conclusion=='success' else conclusion,summary)

    def test_task_final_result_updates_existing_progress(self):
        source = (ROOT / ".github/coding-bot/run-action.sh").read_text()
        block = source.split("# A limited PR task must not enter", 1)[1].split("\n", 1)[1].split("# CI 自動修正では", 1)[0]
        for exit_code in (0, 1):
            with self.subTest(exit_code=exit_code), tempfile.TemporaryDirectory() as d:
                helper = source.split("report_pr_task_result() {", 1)[1].split("\n}\n", 1)[0]
                result = self.bash('report_pr_task_result() {' + helper + '\n}\n'
                                   'gh() { printf "CALL %s\\n" "$*"; jq -r .body; }; ' + block,
                    PR_INSTRUCTION="task", GITHUB_REPOSITORY="team/repo", ISSUE_NUMBER="34",
                    PROGRESS_COMMENT_ID="99", CLAUDE_OUTPUT="final result", ENGINE_EXIT_CODE=str(exit_code),
                    GITHUB_WORKSPACE=d)
                self.assertEqual(result.returncode, exit_code, result.stderr)
                self.assertIn("-X PATCH repos/team/repo/issues/comments/99 --input -", result.stdout)
                self.assertIn("final result", result.stdout)
                self.assertNotIn("issue comment", result.stdout)
                self.assertTrue((Path(d)/".coding-bot-reported").exists())

    def test_install_failure_reports_terminal_progress(self):
        source = (ROOT / ".github/coding-bot/run-action.sh").read_text()
        prefix = source.split("save_unpushed_commits() {", 1)[0]
        reporting = source.split("# Function to post error comments", 1)[1].split("# Resolve this script's directory", 1)[0]
        install_block = source.split('if [ -n "${PR_INSTRUCTION:-}" ]; then\n  install_pdh_pre_push_hook', 1)[1].split("# 実行（エンジン", 1)[0]
        install_block = 'if [ -n "${PR_INSTRUCTION:-}" ]; then\n  install_pdh_pre_push_hook' + install_block
        with tempfile.TemporaryDirectory() as d:
            result = self.bash(prefix + "\n" + reporting + """
python3() { if [ "$2" = install ]; then return 1; else command python3 "$@"; fi; }
git() { printf '%s\n' "$TEST_HOOKS"; }
gh() { printf 'PATCH %s\n' "$*"; jq -r .body; }
""" + install_block, PR_INSTRUCTION="task", SCRIPT_DIR=str(ROOT/".github/coding-bot"),
                BRANCH_NAME="agent/issue-12", HEAD_SHA="base", PR_ALLOWED_PATHS="allowed/.*",
                PROGRESS_COMMENT_ID="99", GITHUB_REPOSITORY="team/repo", GITHUB_RUN_ID="123",
                GITHUB_WORKSPACE=d, TEST_HOOKS=str(Path(d) / "hooks"))
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn("-X PATCH repos/team/repo/issues/comments/99", result.stdout)
            self.assertIn("Exit Code**: 1", result.stdout)
            self.assertTrue((Path(d) / ".coding-bot-reported").exists())

    def test_normal_completion_delivery_preserves_engine_result(self):
        source=(ROOT/'.github/coding-bot/run-action.sh').read_text()
        prefix=source[:source.index('# Resolve this script')]
        start=source.index('  # 最終結果を投稿（ブランチ情報付き）')
        block=source[start:source.index('\nelse\n  echo "❌ Task failed',start)]
        for failures in (0,1,3):
            with self.subTest(failures=failures),tempfile.TemporaryDirectory() as d:
                code=prefix+r"""
CI_RED_MARKER='';CLAUDE_OUTPUT_CLEAN='完成報告: 作業と push は成功しました'
REPORT_ISSUE=7;BRANCH_NAME=agent/issue-7
branch_footer() { :; }
gh() {
 [ "$1 $2" != 'pr list' ] || return 0
 body=$(jq -r .body)
 printf '%s body=%s\n' "$*" "$body" >> "$GITHUB_WORKSPACE/calls"
 n=$(wc -l < "$GITHUB_WORKSPACE/calls")
 [ "$n" -gt "$FAILURES" ]
}
"""+block+'\nexit "$ENGINE_EXIT_CODE"'
                result=self.bash(code,FAILURES=str(failures),GITHUB_WORKSPACE=d,ENGINE_EXIT_CODE='0',
                    GITHUB_REPOSITORY='team/repo',GITHUB_RUN_ID='123',ISSUE_NUMBER='7',TARGET_ISSUE='7',
                    PROGRESS_COMMENT_ID='100',PR_INSTRUCTION='')
                calls=(Path(d)/'calls').read_text()
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertNotIn('Unexpected Error',calls)
                self.assertIn('完成報告: 作業と push は成功しました',calls)
                self.assertEqual((Path(d)/'.coding-bot-reported').exists(),failures<2)
        print('CONTRAST PASS: delivered completion is marked, undelivered completion allows fallback',flush=True)

    def test_successful_work_keeps_success_when_completion_and_fallback_run(self):
        source=(ROOT/'.github/coding-bot/run-action.sh').read_text()
        prefix=source[:source.index('# Resolve this script')]
        start=source.index('  # 最終結果を投稿（ブランチ情報付き）')
        completion=source[start:source.index('\nelse\n  echo "❌ Task failed',start)]
        steps=yaml.safe_load((ROOT/'.github/workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        fallback=next(x['run'] for x in steps if x.get('name')=='Report if the run left nothing')
        stub=r"""
gh() {
 case "$1 $2" in
  'pr list') return 0;;
  'api -X') cat >/dev/null; return 1;;
  'issue comment') printf '%s\n' "$*" >> "$GITHUB_WORKSPACE/calls"; echo 'https://github.com/team/repo/issues/7#issuecomment-101';;
  'issue view') echo OPEN;;
  'issue edit') printf '%s\n' "$*" >> "$GITHUB_WORKSPACE/calls";;
  *) return 98;;
 esac
}
branch_footer() { :; }
"""
        for conclusion in ('failure','success'):
            with self.subTest(conclusion=conclusion),tempfile.TemporaryDirectory() as d:
                env=dict(GITHUB_WORKSPACE=d,GITHUB_REPOSITORY='team/repo',GITHUB_RUN_ID='123',
                    CI_RED_MARKER='',CLAUDE_OUTPUT_CLEAN='作業と push は成功しました',ENGINE_EXIT_CODE='0',
                    REPORT_ISSUE='7',ISSUE_NUMBER='7',TARGET_ISSUE='7',PROGRESS_COMMENT_ID='100',
                    PR_INSTRUCTION='',BRANCH_NAME='agent/issue-7',REPO='team/repo',TRUSTED_ISSUE='7',
                    TRUSTED_PR='',TARGET_REASON='',PR_COMMENT_ONLY='false',CONCLUSION=conclusion,RUN_URL='run')
                result=self.bash(prefix+stub+completion+'\nexit "$ENGINE_EXIT_CODE"',**env)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertFalse((Path(d)/'.coding-bot-reported').exists())
                result=self.bash(stub+fallback,**env)
                self.assertEqual(result.returncode,0,result.stderr)
                calls=(Path(d)/'calls').read_text()
                notice=Path(d)/'.coding-bot-notify'
                if conclusion=='success':
                    self.assertIn('作業は終わりましたが、報告の投稿に失敗しました',calls)
                    self.assertNotIn('作業は進んでいません',calls)
                    self.assertNotIn('awaiting-reply',calls)
                    self.assertFalse(notice.exists())
                    self.assertIn('[実行ログ](run)',calls)
                    self.assertIn('branch',calls)
                else:
                    self.assertIn('作業は進んでいません',calls)
                    self.assertIn('awaiting-reply',calls)
                    self.assertIn('kind=failed',notice.read_text())
                    print('CONTRAST PASS: a genuinely failed run retains its failure notice and label',flush=True)

    def test_final_report_fits_comment_limit_and_preserves_valid_bodies(self):
        source=(ROOT/'.github/coding-bot/run-action.sh').read_text()
        prefix=source[:source.index('# Resolve this script')]
        for length in (0,65535,65536,80000):
            for char in ('a','界','🤖'):
                with self.subTest(length=length,char=char),tempfile.TemporaryDirectory() as d:
                    body=Path(d)/'body';body.write_text(char*length)
                    code=prefix+r"""
gh() {
 if [[ " $* " == *' --input - '* ]]; then jq -j .body > "$GITHUB_WORKSPACE/delivered";
 else for value in "$@"; do case "$value" in body=*) printf '%s' "${value#body=}" > "$GITHUB_WORKSPACE/delivered";; esac; done; fi
 python3 -c 'import sys; from pathlib import Path; sys.exit(len(Path(sys.argv[1]).read_text())>=65536)' "$GITHUB_WORKSPACE/delivered"
}
report_pr_task_result "$(cat "$GITHUB_WORKSPACE/body")"
"""
                    result=self.bash(code,GITHUB_WORKSPACE=d,GITHUB_REPOSITORY='team/repo',GITHUB_RUN_ID='123',PROGRESS_COMMENT_ID='100',SCRIPT_DIR=str(ROOT/'.github/coding-bot'))
                    self.assertEqual(result.returncode,0,result.stderr)
                    delivered=(Path(d)/'delivered').read_text()
                    self.assertLess(len(delivered),65536)
                    if length<65536:self.assertEqual(delivered,char*length)
                    else:
                        self.assertTrue(delivered.endswith('[実行ログ](https://github.com/team/repo/actions/runs/123)'))
                        self.assertTrue(delivered.startswith(char))
        print('CONTRAST PASS: valid empty and 65535-character bodies remain unchanged, including Unicode',flush=True)

    def test_ci_fallback_explains_closed_pr_after_decision(self):
        steps=yaml.safe_load((ROOT/'.github/workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        fallback=next(x['run'] for x in steps if x.get('name')=='Report if the run left nothing')
        for conclusion in ('success','failure'):
            with self.subTest(conclusion=conclusion),tempfile.TemporaryDirectory() as d:
                stub=r"""gh() { printf '%s\n' "$*" >> "$GITHUB_WORKSPACE/calls"; [ "$1 $2" != 'issue view' ] || echo OPEN; }; """
                result=self.bash(stub+fallback,GITHUB_WORKSPACE=d,REPO='team/repo',TRUSTED_ISSUE='7',TRUSTED_PR='9',
                    TARGET_REASON='PR が閉じています',CONCLUSION=conclusion,RUN_URL='run',EVENT_TYPE='workflow_run')
                self.assertEqual(result.returncode,0,result.stderr)
                calls=(Path(d)/'calls').read_text()
                self.assertIn('PR が閉じているため',calls)
                self.assertIn('/pull/9',calls)
                self.assertNotIn('作業は進んでいません',calls)
                self.assertNotIn('awaiting-reply',calls)

    def test_task_patch_failure_retries_and_never_marks_an_unposted_result(self):
        source = (ROOT / ".github/coding-bot/run-action.sh").read_text()
        prefix = source.split("save_unpushed_commits() {", 1)[0]
        block = source.split("# A limited PR task must not enter", 1)[1].split("\n", 1)[1].split("# CI 自動修正では", 1)[0]
        for failures, expected_exit, expected_calls, reported in ((0, 0, 1, True), (1, 0, 2, True),
                                                                  (2, 0, 2, False), (4, 0, 2, False)):
            with self.subTest(failures=failures), tempfile.TemporaryDirectory() as d:
                result = self.bash(prefix + """
calls=0
gh() { calls=$((calls + 1)); echo "CALL $calls"; [ "$calls" -gt "$FAILURES" ]; }
""" + block, PR_INSTRUCTION="task", GITHUB_REPOSITORY="team/repo", GITHUB_RUN_ID="123",
                    PROGRESS_COMMENT_ID="99", CLAUDE_OUTPUT="final result", ENGINE_EXIT_CODE="0",
                    GITHUB_WORKSPACE=d, FAILURES=str(failures))
                self.assertEqual(result.returncode, expected_exit, result.stderr)
                self.assertIn(f"CALL {expected_calls}", result.stdout)
                self.assertEqual((Path(d) / ".coding-bot-reported").exists(), reported)

    def test_workflow_fallback_creates_task_report_without_reply_or_labels(self):
        job = yaml.safe_load((ROOT / ".github/workflows/coding-bot.yml").read_text())["jobs"]["agent"]
        block = next(s for s in job["steps"] if s.get("name") == "Report if the run left nothing")["run"]
        for conclusion in ("cancelled", "failure"):
            with self.subTest(conclusion=conclusion), tempfile.TemporaryDirectory() as d:
                (Path(d) / ".coding-bot-task-progress").write_text("99\n")
                stub = """gh() { if [ "$1 $2" = "api repos/team/repo/issues/comments/99" ]; then
                  echo '{"issue_url":"https://api.github.com/repos/team/repo/issues/12","user":{"login":"github-actions[bot]"}}'
                else printf 'CALL %s\\n' "$*"; fi; }; """
                result = self.bash(stub + block,
                    PR_INSTRUCTION="task", REPO="team/repo", ISSUE="34", TRUSTED_ISSUE="12", CONCLUSION=conclusion,
                    RUN_URL="run", GITHUB_WORKSPACE=d, GITHUB_STEP_SUMMARY=str(Path(d) / "summary"))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("-X PATCH", result.stdout)
                self.assertIn("repos/team/repo/issues/12/comments", result.stdout)
                self.assertNotIn("awaiting-reply", result.stdout)
                self.assertNotIn("もう一度やらせるには", result.stdout)
