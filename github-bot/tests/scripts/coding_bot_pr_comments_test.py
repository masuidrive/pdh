"""Run the PR-comment branch with a stub engine and a local merge conflict."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = next(p for p in Path(__file__).resolve().parents if (p / ".github/coding-bot/pr-comment.sh").is_file())
BOT = Path(os.environ.get('BOT_MODULE_PATH', ROOT / '.github/coding-bot'))
TMP = Path(tempfile.gettempdir())


def git(cwd, *args):
    return subprocess.check_output(['git', '-C', str(cwd), *args], text=True, stderr=subprocess.DEVNULL).strip()


class MergeProbe(unittest.TestCase):
    def run_case(self, decision, *, conflict=True, dirty=False, fail=False, unresolved=False, refused=False, request="🤖 解消して。質問もあります", raw=None, whitespace=False):
        with tempfile.TemporaryDirectory(dir=TMP) as temp:
            temp = Path(temp)
            seed, remote, work, run = [temp / name for name in ['seed', 'remote', 'work', 'run']]
            seed.mkdir(); run.mkdir()
            git(seed, 'init', '-b', 'main')
            git(seed, 'config', 'user.name', 'Test'); git(seed, 'config', 'user.email', 'test@example.invalid')
            (seed / 'conflict file.txt').write_text('base\n')
            (seed / 'other.txt').write_text('unchanged\n')
            git(seed, 'add', '.'); git(seed, 'commit', '-m', 'initial')
            git(seed, 'checkout', '-b', 'agent/issue-7')
            (seed / 'conflict file.txt').write_text('feature\n')
            git(seed, 'commit', '-am', 'feature')
            git(seed, 'checkout', 'main')
            (seed / ('conflict file.txt' if conflict else 'main.txt')).write_text('main\n')
            if whitespace: (seed / 'other.txt').write_text('main whitespace \n')
            git(seed, 'add', '.'); git(seed, 'commit', '-m', 'main')
            git(temp, 'clone', '--bare', str(seed), str(remote))
            git(temp, 'clone', '-b', 'agent/issue-7', str(remote), str(work))
            git(work, 'config', 'user.name', 'Test'); git(work, 'config', 'user.email', 'test@example.invalid')
            original = git(work, 'rev-parse', 'HEAD')
            env = {**os.environ, 'BOT': str(BOT), 'RUNNER_DIR': str(run), 'GITHUB_WORKSPACE': str(run),
                   'DECISION': json.dumps(decision), 'DIRTY': str(int(dirty)), 'FAIL': str(int(fail)),
                   'RAW': raw if raw is not None else '{"resolved":true}', 'UNRESOLVED': str(int(unresolved)), 'REFUSED': str(int(refused)),
                   'GITHUB_REPOSITORY': 'owner/repo', 'TRUSTED_LINKED_ISSUE': '7', 'ISSUE_NUMBER': '9',
                   'BASE_BRANCH': 'main', 'BRANCH_NAME': 'agent/issue-7', 'PROGRESS_COMMENT_ID': '77',
                   'RUN_TIMEOUT_SECONDS': '60', 'USER_REQUEST': request}
            script = r'''
set -euo pipefail
source "$BOT/pr-comment.sh"
SCRIPT_DIR="$BOT"
dispatch_branch_ci() { printf "ci\n" >> "$RUNNER_DIR/ci"; }
git() {
  if [[ " $* " == *" push "* ]]; then echo push >> "$RUNNER_DIR/pushes"; return 0; fi
  command git "$@"
}
gh() {
  printf '%s\n' "$*" >> "$RUNNER_DIR/gh"
  if [[ " $* " == *" --paginate "* ]]; then printf '[]'; fi
}
pr_comment_engine() {
  RESULT_OUTPUT_FILE="$RUNNER_DIR/result"
  if [ -f "$RUNNER_DIR/classified" ]; then
    if [ "$UNRESOLVED" != 1 ]; then printf 'resolved\n' > 'conflict file.txt'; fi
    if [ "$REFUSED" = 1 ]; then printf '{"resolved":false}' > "$RESULT_OUTPUT_FILE"; else printf '%s' "$RAW" > "$RESULT_OUTPUT_FILE"; fi
    if [ "$DIRTY" = 1 ]; then printf 'wrong\n' > other.txt; git add other.txt; fi
  else
    touch "$RUNNER_DIR/classified"
    if [ "$FAIL" = 1 ]; then return 1; fi
    printf '%s' "$DECISION" > "$RESULT_OUTPUT_FILE"
  fi
}
run_pr_comment
'''
            result = subprocess.run(['bash', '-c', script], cwd=work, env=env, text=True, capture_output=True)
            pushes = (run / 'pushes').read_text().splitlines() if (run / 'pushes').exists() else []
            calls = (run / 'gh').read_text() if (run / 'gh').exists() else ''
            head = git(work, 'rev-parse', 'HEAD')
            return result, pushes, calls, original == head



class PrCommentContract(MergeProbe):
    def test_only_requested_conflict_resolution_can_push(self):
        for decision, conflict, pushes in [
            ({"conflict":False,"other":True},True,[]),
            ({"conflict":False,"other":False},True,[]),
            ({"conflict":True,"other":True},True,["push"]),
            ({"conflict":True,"other":False},True,["push"]),
            ({"conflict":True,"other":False},False,[]),
        ]:
            with self.subTest(decision=decision,conflict=conflict):
                result, actual, calls, unchanged = self.run_case(decision,conflict=conflict)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(actual,pushes)
                if not pushes: self.assertTrue(unchanged)
                if decision["other"]: self.assertIn('issues/7',calls)

    def test_invalid_or_unsafe_results_stop_before_push(self):
        cases=[{"raw":""},{"raw":'{"resolved":false}\n{"resolved":true}'},
               {"raw":'{}'},{"raw":'false'},{"dirty":True},{"unresolved":True},
               {"refused":True},{"fail":True}]
        for args in cases:
            with self.subTest(args=args):
                result,pushes,calls,_=self.run_case({"conflict":True,"other":False},**args)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(pushes,[])
                self.assertIn('issues/7',calls)
                self.assertIn('PATCH',calls)

    def test_base_whitespace_does_not_block_a_valid_resolution(self):
        result,pushes,_,_=self.run_case({"conflict":True,"other":False},whitespace=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(pushes,['push'])

    def test_pr_engine_has_no_write_credentials_and_restores_git_config(self):
        for mode in ['classify','resolve']:
            for tamper in ['0','1']:
                with self.subTest(mode=mode,tamper=tamper), tempfile.TemporaryDirectory(dir=TMP) as d:
                    root=Path(d);git(root,'init','-b','main')
                    run=root/'run';run.mkdir()
                    git(root,'config','http.https://github.com/.extraheader','AUTHORIZATION: probe-only')
                    before=git(root,'config','--local','--list')
                    code=r'''source "$BOT/pr-comment.sh"
engine_run() {
 (
  printf '%s\n' "${GH_TOKEN:-absent}" "${GITHUB_TOKEN:-absent}" "${CODING_BOT_GH_PAT:-absent}" > "$RUNNER_DIR/child"
  git config --local --get-regexp '^(http.*extraheader|credential.*)' > "$RUNNER_DIR/git-auth" || true
  [ "$TAMPER" = 0 ] || git config --local credential.helper '!unexpected'
  printf '{"resolved":true}' > "$RESULT_OUTPUT_FILE"
 ) & ENGINE_PID=$!
}
engine_extract_result() { :; }
pr_comment_engine classify "$MODE"
'''
                    env={**os.environ,'BOT':str(BOT),'RUNNER_DIR':str(run),'USER_REQUEST':'probe',
                         'ISSUE_NUMBER':'9','RUN_TIMEOUT_SECONDS':'5','MODE':mode,'TAMPER':tamper,
                         'GH_TOKEN':'write-only-probe','GITHUB_TOKEN':'write-only-probe','CODING_BOT_GH_PAT':'write-only-probe'}
                    result=subprocess.run(['bash','-c',code],cwd=root,env=env,capture_output=True,text=True)
                    self.assertEqual(result.returncode==0,tamper=='0',result.stderr)
                    self.assertEqual((run/'child').read_text(),'absent\nabsent\nabsent\n')
                    self.assertEqual((run/'git-auth').read_text(),'')
                    self.assertEqual(git(root,'config','--local','--list'),before)

    def test_pr_engine_cli_uses_one_explicit_permission_mode(self):
        for engine in ['codex','claude']:
            for mode in ['classify','resolve']:
                with self.subTest(engine=engine,mode=mode), tempfile.TemporaryDirectory(dir=TMP) as d:
                    root=Path(d)
                    source=(BOT/'engines'/('_'+engine+'.sh')).read_text().replace('/tmp/',d+'/')
                    (root/'engine.sh').write_text(source)
                    (root/'prompt').write_text('probe')
                    code=r'''ISSUE_NUMBER=9
source "$PROBE/engine.sh"
SYSTEM_PROMPT=probe
PR_ENGINE_MODE="$MODE"
TIMEOUT_VALUE=5
JSON_OUTPUT_FILE="$PROBE/events"
PROGRESS_OUTPUT_FILE="$PROBE/progress"
TASK_STATUS_FILE="$PROBE/tasks"
ENGINE_PROMPT_FILE="$PROBE/prompt"
timeout() { printf '%s\0' "$@" > "$PROBE/args"; }
engine_run
wait "$ENGINE_PID"
'''
                    result=subprocess.run(['bash','-c',code],env={**os.environ,'PROBE':d,'MODE':mode},capture_output=True,text=True)
                    self.assertEqual(result.returncode,0,result.stderr)
                    args=(root/'args').read_bytes().decode().split('\0')[:-1]
                    self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',args)
                    self.assertNotIn('--dangerously-skip-permissions',args)
                    if engine=='codex':
                        self.assertEqual(args.count('--sandbox'),1)
                        self.assertEqual(args[args.index('--sandbox')+1],'read-only' if mode=='classify' else 'workspace-write')
                        self.assertIn('sandbox_workspace_write.network_access=false',args)
                        self.assertIn('approval_policy="never"',args)
                        if mode=='classify': self.assertIn('features.shell_tool=false',args)
                    else:
                        self.assertEqual(args.count('--tools'),1)
                        self.assertEqual(args[args.index('--tools')+1],'' if mode=='classify' else 'Read,Edit,Write')
                        self.assertIn('--strict-mcp-config',args)



if __name__ == '__main__':
    unittest.main(verbosity=2)
