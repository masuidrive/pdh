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
    def run_case(self, decision, *, conflict=True, dirty=False, fail=False, unresolved=False, refused=False, request="🤖 解消して。質問もあります", raw=None, whitespace=False, issue_run=False, extra=False, pat=False):
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
                   'RAW': raw if raw is not None else json.dumps(decision), 'UNRESOLVED': str(int(unresolved)), 'REFUSED': str(int(refused)),
                   'ISSUE_RUN': str(int(issue_run)), 'CODING_BOT_GH_PAT': 'fake-pat' if pat else '', 'EXTRA': str(int(extra)), 'RESOLVE_CONFLICT_PR':'9', 'ENGINE_FILE': str(run/'engine.sh'), 'GITHUB_REPOSITORY': 'owner/repo', 'TRUSTED_LINKED_ISSUE': '7', 'ISSUE_NUMBER': '9',
                   'BASE_BRANCH': 'main', 'BRANCH_NAME': 'agent/issue-7', 'PROGRESS_COMMENT_ID': '77',
                   'RUN_TIMEOUT_SECONDS': '60', 'USER_REQUEST': request}
            script = r'''
set -euo pipefail
source "$BOT/pr-comment.sh"
SCRIPT_DIR="$BOT"
dispatch_branch_ci() { printf "ci-workflow\n" >> "$RUNNER_DIR/gh"; }
use_pat_for_origin() { printf "pat-auth\n" >> "$RUNNER_DIR/gh"; }
git() {
  if [[ " $* " == *" push "* ]]; then echo push >> "$RUNNER_DIR/pushes"; return 0; fi
  command git "$@"
}
gh() {
  printf '%s\n' "$*" >> "$RUNNER_DIR/gh"
  if [[ " $* " == *" --paginate "* ]]; then printf '[]'; fi
}
pr_comment_engine() {
  echo classify >> "$RUNNER_DIR/gh"
  RESULT_OUTPUT_FILE="$RUNNER_DIR/result"
  [ "$FAIL" != 1 ] || return 1
  printf '%s' "$RAW" > "$RESULT_OUTPUT_FILE"
}
engine_run() { echo forbidden-working-engine >> "$RUNNER_DIR/gh"; return 97; }
if [ "$ISSUE_RUN" = 1 ]; then
 ISSUE_NUMBER=7
 CONFLICT_START_SHA=$(git rev-parse HEAD)
 CONFLICT_BASE_SHA=$(git rev-parse origin/main)
 MERGE_EXIT_CODE=0
 git merge origin/main --no-edit || MERGE_EXIT_CODE=$?
 CONFLICT_FILES=$(git diff --name-only --diff-filter=U)
 CONFLICT_SECTION="FIXED CONFLICT TASK: $CONFLICT_FILES"
 cat > "$ENGINE_FILE" <<'ENGINE'
engine_setup_auth() { :; }
engine_run() {
 (
  echo resolve >> "$RUNNER_DIR/gh"
  if [ "$FAIL" = 1 ]; then exit 1; fi
  if [ "$UNRESOLVED" != 1 ]; then printf 'resolved\n' > 'conflict file.txt'; fi
  if [ "$DIRTY" = 1 ]; then printf 'wrong\n' > other.txt; fi
  if [ "$EXTRA" = 1 ]; then printf 'wrong\n' > added.txt; fi
  git add .
  if [ "$REFUSED" = 1 ]; then rm "$(git rev-parse --git-path MERGE_HEAD)"; fi
  git commit -m 'merge conflicts' || exit 1
 ) & ENGINE_PID=$!
}
ENGINE
 source "$BOT/resolve-conflict.sh"
 resolve_issue_conflict
else
 run_pr_comment
fi
'''
            result = subprocess.run(['bash', '-c', script], cwd=work, env=env, text=True, capture_output=True)
            pushes = (run / 'pushes').read_text().splitlines() if (run / 'pushes').exists() else []
            calls = (run / 'gh').read_text() if (run / 'gh').exists() else ''
            head = git(work, 'rev-parse', 'HEAD')
            return result, pushes, calls, original == head


class PrCommentContract(MergeProbe):
    def test_pr_comments_only_classify_redirect_and_dispatch(self):
        for decision in [{"conflict":False,"other":True},{"conflict":False,"other":False},
                         {"conflict":True,"other":True},{"conflict":True,"other":False}]:
            with self.subTest(decision=decision):
                result,pushes,calls,unchanged=self.run_case(decision)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(pushes,[]); self.assertTrue(unchanged)
                self.assertEqual(calls.count('classify'),1)
                self.assertNotIn('forbidden-working-engine',calls)
                self.assertEqual('resolve_conflict_pr=9' in calls,decision['conflict'])
                if decision['other']: self.assertIn('issues/7',calls)
                if decision['conflict'] and not decision['other']: self.assertNotIn('issue comment',calls)
                self.assertNotIn('質問もあります',calls)

    def test_invalid_classifications_never_dispatch_or_push(self):
        for raw in ['', '{}', 'false', '{"conflict":"true","other":false}',
                    '{"conflict":true,"other":false}\n{"conflict":false,"other":true}']:
            with self.subTest(raw=raw):
                result,pushes,calls,unchanged=self.run_case({},raw=raw)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(pushes,[]);self.assertTrue(unchanged)
                self.assertNotIn('workflow run',calls);self.assertIn('issues/7',calls)

    def test_issue_run_only_pushes_a_verified_merge(self):
        for arguments in [{},{'whitespace':True},{'conflict':False},{'pat':True}, {'dirty':True},
                          {'extra':True},{'unresolved':True},{'fail':True},{'refused':True}]:
            with self.subTest(arguments=arguments):
                result,pushes,calls,_=self.run_case({},issue_run=True,**arguments)
                unsafe=any(arguments.get(key) for key in ['dirty','extra','unresolved','fail','refused'])
                self.assertEqual(result.returncode==0,not unsafe,result.stderr)
                self.assertEqual(pushes,[] if unsafe else ['push'])
                self.assertIn('issue comment 7',calls)
                self.assertEqual(calls.count('issue comment 9'),0 if unsafe else 1)
                self.assertNotIn('classify',calls)
                if not unsafe:
                    self.assertIn('pat-auth' if arguments.get('pat') else 'ci-workflow',calls)
                    if arguments.get('pat'): self.assertNotIn('ci-workflow',calls)

    def test_classifier_has_no_tools_or_github_credentials(self):
        for engine in ['codex','claude']:
            with self.subTest(engine=engine), tempfile.TemporaryDirectory(dir=TMP) as d:
                root=Path(d)
                code=r'''source "$BOT/pr-comment.sh"
SCRIPT_DIR="$BOT"
RESULT_OUTPUT_FILE="$RUNNER_DIR/result"
timeout() {
 printf '%s\0' "$@" > "$RUNNER_DIR/args"
 printf '%s\n' "${GH_TOKEN:-absent}" "${GITHUB_TOKEN:-absent}" "${CODING_BOT_GH_PAT:-absent}" > "$RUNNER_DIR/credentials"
 if [ "$ENGINE" = codex ]; then printf '{"conflict":false,"other":true}' > "$RESULT_OUTPUT_FILE"
 else printf '%s' '{"result":"{\"conflict\":false,\"other\":true}"}'; fi
}
pr_comment_engine 'classify only'
'''
                env={**os.environ,'BOT':str(BOT),'RUNNER_DIR':d,'ENGINE':engine,
                     'RUN_TIMEOUT_SECONDS':'60','USER_REQUEST':'untrusted request',
                     'GH_TOKEN':'fake-token','GITHUB_TOKEN':'fake-token','CODING_BOT_GH_PAT':'fake-token'}
                result=subprocess.run(['bash','-c',code],cwd=root,env=env,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual((root/'credentials').read_text(),'absent\nabsent\nabsent\n')
                args=(root/'args').read_bytes().decode().split('\0')[:-1]
                if engine=='codex':
                    self.assertEqual(args.count('--sandbox'),1)
                    self.assertIn('read-only',args);self.assertIn('features.shell_tool=false',args)
                    self.assertIn('--ignore-rules',args)
                else:
                    self.assertEqual(args.count('--tools'),1)
                    self.assertEqual(args[args.index('--tools')+1],'')
                    self.assertIn('--strict-mcp-config',args)
                self.assertNotIn('--dangerously-skip-permissions',args)
                self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',args)

    def test_pr_runner_exits_before_branch_work_or_working_engine(self):
        source=(BOT/'run-action.sh').read_text()
        start=source.index('if [ "$IS_PR" = true ]; then\n  # ⚠ PR')
        block=source[start:source.index('\nelse\n  # Issue の場合',start)]+'\nfi\necho forbidden-continuation\n'
        with tempfile.TemporaryDirectory(dir=TMP) as d:
            code=r'''set -euo pipefail
SCRIPT_DIR="$BOT"
IS_PR=true
PR_COMMENT_ONLY=true
ENGINE=codex
RUN_TIMEOUT_SECONDS=60
ENGINE_FILE=/dev/null
BASE_BRANCH=main
validate_pr_context() { TRUSTED_LINKED_ISSUE=7; }
fetch_trigger_context() { echo '{"body":"🤖 other request"}'; }
engine_setup_auth() { :; }
engine_run() { echo forbidden-working-engine; return 97; }
gh() {
 printf '%s\n' "$*" >> "$RUNNER_DIR/gh"
 if [[ "$*" == *--paginate* ]]; then echo '[]';
 elif [[ "$*" == *'api repos/owner/repo/issues/7'* ]]; then echo '{"number":7}'; fi
}
timeout() { printf '{"conflict":false,"other":true}' > "$RESULT_OUTPUT_FILE"; }
'''
            env={**os.environ,'BOT':str(BOT),'RUNNER_DIR':d,'GITHUB_WORKSPACE':d,'ISSUE_NUMBER':'9',
                 'GITHUB_REPOSITORY':'owner/repo','EVENT_TYPE':'issue_comment','COMMENT_ID':'77','PR_INSTRUCTION':''}
            result=subprocess.run(['bash','-c',code+block],env=env,text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertNotIn('forbidden-',result.stdout)
            calls=(Path(d)/'gh').read_text()
            self.assertIn('issue comment 9',calls)
            self.assertNotIn('pr view',calls)

    def test_guide_read_failure_cannot_create_a_duplicate(self):
        code='''source "$BOT/pr-comment.sh"
gh() { if [ "$1" = api ]; then return 1; else echo forbidden-post; fi; }
pr_comment_guide 9 https://github.com/owner/repo/issues/7#issuecomment-11
'''
        result=subprocess.run(['bash','-c',code],capture_output=True,text=True,
            env={**os.environ,'BOT':str(BOT),'GITHUB_REPOSITORY':'owner/repo','REPORT_ISSUE':'7'})
        self.assertNotEqual(result.returncode,0);self.assertNotIn('forbidden-post',result.stdout)


if __name__=='__main__': unittest.main(verbosity=2)
