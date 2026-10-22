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
    def run_case(self, decision, *, conflict=True, dirty=False, fail=False, unresolved=False, refused=False, request="🤖 解消して。質問もあります", raw=None, whitespace=False, issue_run=False, extra=False, pat=False, fast_forward=False, ci_fail=False, deletion=False, resolved="resolved\n", outside_delete=False, renamed=False, fail_pr_post=False):
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
            if not fast_forward:
                if renamed: git(seed,'mv','conflict file.txt','renamed conflict file.txt')
                else: (seed / 'conflict file.txt').write_text('feature\n')
                git(seed, 'commit', '-am', 'feature')
            git(seed, 'checkout', 'main')
            if deletion: git(seed, 'rm', 'conflict file.txt')
            else: (seed / ('conflict file.txt' if conflict else 'main.txt')).write_text('main\n')
            if whitespace: (seed / 'other.txt').write_text('main whitespace \n')
            git(seed, 'add', '.'); git(seed, 'commit', '-m', 'main')
            git(temp, 'clone', '--bare', str(seed), str(remote))
            git(temp, 'clone', '-b', 'agent/issue-7', str(remote), str(work))
            git(work, 'config', 'user.name', 'Test'); git(work, 'config', 'user.email', 'test@example.invalid')
            original = git(work, 'rev-parse', 'HEAD')
            runner=(BOT/'run-action.sh').read_text()
            start=runner.index('# main を merge\n')
            (run/'merge-step.sh').write_text(runner[start:runner.index('\nCONFLICT_SECTION=""',start)])
            (run/'resolve-step.sh').write_text((BOT/'resolve-conflict.sh').read_text().replace('/tmp/agent-prompt-',str(run/'agent-prompt-')))
            env = {**os.environ, 'BOT': str(BOT), 'RUNNER_DIR': str(run), 'GITHUB_WORKSPACE': str(run),
                   'CI_FAIL':str(int(ci_fail)), 'FAIL_PR_POST':str(int(fail_pr_post)), 'CONFLICT_PATH':'renamed conflict file.txt' if renamed else 'conflict file.txt', 'DELETE':str(int(deletion)), 'RESOLVED':resolved, 'OUTSIDE_DELETE':str(int(outside_delete)), 'DECISION': json.dumps(decision), 'DIRTY': str(int(dirty)), 'FAIL': str(int(fail)),
                   'RAW': raw if raw is not None else json.dumps(decision), 'UNRESOLVED': str(int(unresolved)), 'REFUSED': str(int(refused)),
                   'ISSUE_RUN': str(int(issue_run)), 'CODING_BOT_GH_PAT': 'fake-pat' if pat else '', 'EXTRA': str(int(extra)), 'RESOLVE_CONFLICT_PR':'9', 'ENGINE_FILE': str(run/'engine.sh'), 'GITHUB_REPOSITORY': 'owner/repo', 'TRUSTED_LINKED_ISSUE': '7', 'ISSUE_NUMBER': '9',
                   'BASE_BRANCH': 'main', 'BRANCH_NAME': 'agent/issue-7', 'PROGRESS_COMMENT_ID': '77',
                   'RUN_TIMEOUT_SECONDS': '60', 'USER_REQUEST': request}
            script = r'''
set -euo pipefail
source "$BOT/pr-comment.sh"
SCRIPT_DIR="$BOT"
dispatch_branch_ci() { printf "ci-workflow\n" >> "$RUNNER_DIR/gh"; [ "$CI_FAIL" != 1 ]; }
use_pat_for_origin() { printf "pat-auth\n" >> "$RUNNER_DIR/gh"; }
git() {
  if [[ " $* " == *" push "* ]]; then echo push >> "$RUNNER_DIR/pushes"; return 0; fi
  command git "$@"
}
gh() {
  printf '%s\n' "$*" >> "$RUNNER_DIR/gh"
  if [ "${FAIL_PR_POST:-0}" = 1 ] && [ "$1 $2 $3" = "issue comment 9" ]; then return 1; fi
  if [[ " $* " == *" --paginate "* ]]; then printf '[]';
  elif [[ "$1 $2" == 'issue comment' ]]; then printf 'https://github.com/owner/repo/issues/%s#issuecomment-88\n' "$3"; fi
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
 source "$RUNNER_DIR/merge-step.sh"
 CONFLICT_FILES=$(git diff --name-only --diff-filter=U)
 CONFLICT_SECTION="FIXED CONFLICT TASK: $CONFLICT_FILES"
 cat > "$ENGINE_FILE" <<'ENGINE'
engine_setup_auth() { :; }
engine_run() {
 (
  echo resolve >> "$RUNNER_DIR/gh"
  if [ "$FAIL" = 1 ]; then exit 1; fi
  if [ "$DELETE" = 1 ]; then git rm "$CONFLICT_PATH";
  elif [ "$UNRESOLVED" != 1 ]; then printf '%s' "$RESOLVED" > 'conflict file.txt'; fi
  if [ "$OUTSIDE_DELETE" = 1 ]; then git rm other.txt; fi
  if [ "$DIRTY" = 1 ]; then printf 'wrong\n' > other.txt; fi
  if [ "$EXTRA" = 1 ]; then printf 'wrong\n' > added.txt; fi
  git add .
  if [ "$REFUSED" = 1 ]; then rm "$(git rev-parse --git-path MERGE_HEAD)"; fi
  git commit -m 'merge conflicts' || exit 1
 ) & ENGINE_PID=$!
}
ENGINE
 source "$RUNNER_DIR/resolve-step.sh"
 conflict_status=0
 resolve_issue_conflict || conflict_status=$?
 printf 'CODING_BOT_CONFLICT_RESULT {"result":"%s","sha":"%s"}\n' "$CONFLICT_RUN_RESULT" "$CONFLICT_PUSHED_SHA"
 exit "$conflict_status"
else
 run_pr_comment
fi
'''
            result = subprocess.run(['bash', '-c', script], cwd=work, env=env, text=True, capture_output=True)
            result.reported = (run / '.coding-bot-reported').exists()
            pushes = (run / 'pushes').read_text().splitlines() if (run / 'pushes').exists() else []
            calls = (run / 'gh').read_text() if (run / 'gh').exists() else ''
            head = git(work, 'rev-parse', 'HEAD')
            return result, pushes, calls, original == head


class PrCommentContract(MergeProbe):
    def test_dispatched_conflict_has_a_start_notice_even_if_redirect_delivery_fails(self):
        result,pushes,calls,_=self.run_case({'conflict':True,'other':False})
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('conflict の解消を始めました',calls)
        self.assertIn('https://github.com/owner/repo/issues/7',calls)
        self.assertEqual(pushes,[])
        result,pushes,calls,_=self.run_case({'conflict':True,'other':False},fail_pr_post=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(result.reported)
        self.assertEqual(pushes,[])
        print('CONTRAST PASS: failed start notice cannot undo an accepted conflict dispatch',flush=True)

    def test_working_runs_take_history_and_images_from_issue_only(self):
        source=(BOT/'run-action.sh').read_text()
        history=source[source.index('# REST API で全コメント取得'):source.index('# main を merge\n')]
        images=source[source.index('# GraphQL API を使って bodyHTML'):source.index('# bodyHTML から画像URL')]
        with tempfile.TemporaryDirectory(dir=TMP) as temp:
            code=r'''set -e
BRANCH_NAME=agent/issue-7; GITHUB_REPOSITORY=owner/repo; COMMENT_ID=''; PR_INSTRUCTION=''
ISSUE_BODY=ISSUE_ACCEPTED_BODY; TRUSTED_LINKED_ISSUE=7; TARGET_ISSUE=7
[ "$IS_PR" != true ] || ISSUE_BODY=PR_UNACCEPTED_BODY
gh() {
 printf '%s\n' "$*" >> "$CALLS"
 case "$2" in
 *issues/9/comments) echo '[{"id":99,"login":"person","body":"PR_UNACCEPTED_IMAGE.png"}]';;
 *issues/7/comments) echo '[{"id":11,"login":"person","body":"ISSUE_ACCEPTED_IMAGE.png"}]';;
 *issues/7) echo ISSUE_ACCEPTED_BODY;;
 graphql) printf '%s' '{"data":{"repository":{"issue":{"bodyHTML":"ISSUE_HTML","comments":{"nodes":[]}}}}}' | jq -r "${@: -1}";;
 *) return 98;;
 esac
}
'''
            for event,is_pr,number,resolve in [('workflow_run','true','9',''),('workflow_dispatch','false','7','9'),('issues','false','7','')]:
                with self.subTest(event=event,resolve=resolve):
                    path=Path(temp)/'calls';path.write_text('')
                    env={**os.environ,'BOT':str(BOT),'CALLS':str(path),'EVENT_TYPE':event,'IS_PR':is_pr,
                         'ISSUE_NUMBER':number,'RESOLVE_CONFLICT_PR':resolve}
                    result=subprocess.run(['bash','-c',code+history+images+'\nprintf "%s\n" "$CONVERSATION_HISTORY_NOTE" "$ALL_COMMENTS_JSON" "$ISSUE_BODY" "$BODY_HTML"'],env=env,text=True,capture_output=True)
                    self.assertEqual(result.returncode,0,result.stderr)
                    self.assertIn('ISSUE_ACCEPTED_IMAGE',result.stdout)
                    self.assertNotIn('PR_UNACCEPTED',result.stdout)
                    self.assertNotIn('issues/9/comments',path.read_text())
                    self.assertNotIn('pullRequest(number:',path.read_text())
                    self.assertIn('issue(number: 7)',path.read_text())
                    self.assertIn('comments(last: 50) { nodes { bodyHTML } }',path.read_text())
            print('CONTRAST PASS: ordinary issue run still receives its own history and images')

    def test_resolver_never_posts_running_engine_result(self):
        for fail in [True,False]:
            with self.subTest(fail=fail):
                result,pushes,calls,_=self.run_case({},issue_run=True,fail=fail)
                self.assertEqual(result.returncode==0,not fail,result.stderr)
                self.assertEqual(calls.count('issue comment 9'),0)
                if fail:
                    self.assertEqual(pushes,[])
        print('CONTRAST PASS: success and failure both leave reporting to the host')

    def test_resolver_push_result_does_not_depend_on_comment_delivery(self):
        ordinary=self.run_case({'conflict':False,'other':True})
        self.assertEqual(ordinary[1],[])
        print('CONTRAST PASS: ordinary PR requests never push',flush=True)
        result,pushes,calls,_=self.run_case({},issue_run=True,fail_pr_post=True)
        self.assertEqual(pushes,['push'])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('issue comment',calls)

    def test_working_pr_tasks_use_issue_title_and_body(self):
        source=(BOT/'run-action.sh').read_text()
        start=source.index('  # PR の場合\n  PR_DATA=')
        block=source[start:source.index('  # PR の場合: head ブランチ名',start)]
        code=r'''GITHUB_REPOSITORY=owner/repo; ISSUE_NUMBER=9; TRUSTED_LINKED_ISSUE=7
gh() {
 if [ "$1" = pr ]; then echo '{"title":"PR_UNACCEPTED_TITLE","body":"PR_UNACCEPTED_BODY"}';
 else echo '{"title":"ISSUE_TITLE","body":"ISSUE_BODY","labels":[]}'; fi
}
'''
        normal='\n'.join(source[source.index('  ISSUE_TITLE=$(echo "$ISSUE_DATA"'):].splitlines()[:3])
        ordinary=subprocess.run(['bash','-c','ISSUE_DATA=\'{"title":"ISSUE_TITLE","body":"ISSUE_BODY","labels":[]}\'\n'+normal+'\nprintf "%s\n" "$ISSUE_TITLE" "$ISSUE_BODY"'],text=True,capture_output=True)
        self.assertEqual(ordinary.stdout,'ISSUE_TITLE\nISSUE_BODY\n')
        print('CONTRAST PASS: ordinary issue metadata remains intact',flush=True)
        for event,instruction in [('workflow_run',''),('workflow_dispatch','fixed script task')]:
            with self.subTest(event=event):
                env={**os.environ,'EVENT_TYPE':event,'PR_INSTRUCTION':instruction}
                result=subprocess.run(['bash','-c',code+block+'\nprintf "%s\n" "$ISSUE_TITLE" "$ISSUE_BODY"'],env=env,text=True,capture_output=True)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(result.stdout,'ISSUE_TITLE\nISSUE_BODY\n')
        print('CONTRAST PASS: task text remains the fixed internal instruction',flush=True)

    def test_conflict_paths_allow_deletion_and_literal_separator(self):
        for kwargs in [{'deletion':True},{'deletion':True,'renamed':True},{'resolved':'=======\n'},{'outside_delete':True},{'dirty':True},{'extra':True},{'unresolved':True},{}]:
            with self.subTest(kwargs=kwargs):
                result,pushes,calls,_=self.run_case({},issue_run=True,**kwargs)
                denied=any(kwargs.get(k) for k in ['outside_delete','dirty','extra','unresolved'])
                self.assertEqual(result.returncode==0,not denied,result.stderr)
                self.assertEqual(pushes,[] if denied else ['push'])
        print('CONTRAST PASS: outside additions/deletions/edits and unresolved markers remain rejected')

    def test_resolver_emits_the_result_only_after_verified_push(self):
        for options,expected in [({'conflict':False},'no_conflict'),({'fast_forward':True},'no_conflict'),({'fail':True},'failed'),({},'pushed')]:
            with self.subTest(options=options):
                result,pushes,calls,_=self.run_case({},issue_run=True,**options)
                last=result.stdout.splitlines()[-1]
                self.assertTrue(last.startswith('CODING_BOT_CONFLICT_RESULT '),result.stdout)
                value=json.loads(last.split(' ',1)[1])
                self.assertEqual(value['result'],expected)
                self.assertEqual(len(pushes),int(expected=='pushed'))
                if expected=='pushed':self.assertRegex(value['sha'],r'^[0-9a-f]{40}$')

    def test_successful_push_is_independent_of_ci_dispatch_delivery(self):
        for ci_fail in [False,True]:
            with self.subTest(ci_fail=ci_fail):
                result,pushes,_,_=self.run_case({},issue_run=True,ci_fail=ci_fail)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(pushes,['push'])
                self.assertEqual(json.loads(result.stdout.splitlines()[-1].split(' ',1)[1])['result'],'pushed')
        print('CONTRAST PASS: a successful CI dispatch retains the same pushed result',flush=True)

    def test_dispatched_conflict_is_not_failed_by_a_redirect_post(self):
        for conflict,expected in [(False,1),(True,0)]:
            with self.subTest(conflict=conflict):
                result,pushes,calls,_=self.run_case({'conflict':conflict,'other':True},fail_pr_post=True)
                self.assertEqual(result.returncode,expected,result.stderr)
                self.assertEqual(pushes,[])
                self.assertEqual('resolve_conflict_pr=9' in calls,conflict)
        print('CONTRAST PASS: an undelivered ordinary redirect still fails without dispatch',flush=True)

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
                if decision['conflict'] and not decision['other']: self.assertIn('conflict の解消を始めました',calls)
                self.assertNotIn('質問もあります',calls)

    def test_invalid_classifications_never_dispatch_or_push(self):
        for raw in ['', '{}', 'false', '{"conflict":"true","other":false}',
                    '{"conflict":true,"other":false}\n{"conflict":false,"other":true}']:
            with self.subTest(raw=raw):
                result,pushes,calls,unchanged=self.run_case({},raw=raw)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(pushes,[]);self.assertTrue(unchanged)
                self.assertNotIn('workflow run',calls);self.assertIn('issues/7',calls)
                self.assertIn('分類できなかったため',calls)

    def test_issue_run_only_pushes_a_verified_merge(self):
        for arguments in [{},{'whitespace':True},{'conflict':False},{'conflict':False,'fast_forward':True},{'pat':True}, {'dirty':True},
                          {'extra':True},{'unresolved':True},{'fail':True},{'refused':True}]:
            with self.subTest(arguments=arguments):
                result,pushes,calls,unchanged=self.run_case({},issue_run=True,**arguments)
                unsafe=any(arguments.get(key) for key in ['dirty','extra','unresolved','fail','refused'])
                self.assertEqual(result.returncode==0,not unsafe,result.stderr)
                self.assertEqual(pushes,[] if unsafe or arguments.get('conflict') is False else ['push'])
                self.assertNotIn('issue comment 7',calls)
                self.assertEqual(calls.count('issue comment 9'),0)
                self.assertNotIn('classify',calls)
                if arguments.get('conflict') is False:
                    self.assertNotIn('resolve',calls)
                    self.assertTrue(unchanged)
                    self.assertNotIn('ci-workflow',calls)
                if not unsafe and arguments.get('conflict') is not False:
                    self.assertIn('pat-auth' if arguments.get('pat') else 'ci-workflow',calls)
                    if arguments.get('pat'): self.assertNotIn('ci-workflow',calls)

    def test_pr_fallback_explains_failure_and_successful_dispatch_skips_it(self):
        import yaml,shutil
        result,_,_,_=self.run_case({'conflict':True,'other':True},fail_pr_post=True)
        self.assertEqual(result.returncode,0,result.stderr);self.assertTrue(result.reported)
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        block=next(x['run'] for x in steps if x.get('name')=='Report if the run left nothing')
        with tempfile.TemporaryDirectory() as d:
            path=Path(d);snap=path/'coding-bot-notification';snap.mkdir()
            for name in ['pr-comment.sh','discussion.py']:shutil.copy(BOT/name,snap/name)
            env={**os.environ,'RUNNER_TEMP':d,'GITHUB_WORKSPACE':d,'REPO':'owner/repo','TRUSTED_ISSUE':'7',
                 'TRUSTED_PR':'9','PR_COMMENT_ONLY':'true','PR_INSTRUCTION':'','RUN_URL':'https://github.com/owner/repo/actions/runs/123'}
            code=r'gh() { if [ "$1" = api ]; then echo "[]"; else printf "%s\n" "$*"; fi; }; '
            failed=subprocess.run(['bash','-c',code+block],env=env,text=True,capture_output=True)
            self.assertEqual(failed.returncode,0,failed.stderr)
            self.assertIn('結果を残さずに終わりました',failed.stdout)
            self.assertIn('conflict の解消が始まったかは確かめられていません',failed.stdout)
            self.assertIn('もう一度',failed.stdout);self.assertIn('issues/7',failed.stdout)
            (path/'.coding-bot-reported').touch()
            success=subprocess.run(['bash','-c',code+block],env=env,text=True,capture_output=True)
            self.assertEqual(success.returncode,0,success.stderr);self.assertNotIn('issue comment',success.stdout)
        print('CONTRAST PASS: dispatched work has its marker and does not enter the PR failure fallback',flush=True)

    def test_interrupted_pr_runs_redirect_without_marking_issue_waiting(self):
        import textwrap
        workflow=(BOT.parent/'workflows/coding-bot.yml').read_text()
        block=workflow.split('- name: Report if the run left nothing',1)[1].split('        run: |',1)[1].split('\n      - name:',1)[0]
        block=textwrap.dedent(block)
        for comment_only,resolve in [('true',''),('false','')]:
            with self.subTest(comment_only=comment_only,resolve=resolve),tempfile.TemporaryDirectory(dir=TMP) as d:
                snapshot=Path(d)/'coding-bot-notification';snapshot.mkdir()
                for name in ['pr-comment.sh','discussion.py']:(snapshot/name).write_text((BOT/name).read_text())
                env={**os.environ,'PR_COMMENT_ONLY':comment_only,'RESOLVE_CONFLICT_PR':resolve,
                     'PR_INSTRUCTION':'','REPO':'owner/repo','ISSUE':'7','TRUSTED_ISSUE':'7','TRUSTED_PR':'9',
                     'EVENT_IS_PR':'true' if comment_only=='true' else 'false',
                     'CONCLUSION':'failure','RUN_URL':'run','GITHUB_WORKSPACE':d,'RUNNER_TEMP':d,'CALLS':str(Path(d)/'calls')}
                code=r'''gh() {
 printf '%s\n' "$*" >> "$CALLS"
 if [[ "$1 $2" == 'issue comment' ]]; then printf 'https://github.com/owner/repo/issues/%s#issuecomment-88\n' "$3";
 elif [[ "$1 $2" == 'issue view' ]]; then echo OPEN;
 elif [[ "$2" == *comments* ]]; then echo '[]'; else echo '{"number":7}'; fi
}
'''
                result=subprocess.run(['bash','-c',code+block],cwd=ROOT,env=env,text=True,capture_output=True)
                self.assertEqual(result.returncode,0,result.stderr)
                calls=Path(env['CALLS']).read_text()
                if comment_only=='true':
                    self.assertIn('issue comment 9',calls);self.assertIn('issues/7',calls)
                    self.assertNotIn('依頼を受け付けられませんでした',calls)
                    self.assertNotIn('conflict 解消が起動したかは',calls)
                    self.assertNotIn('issue edit',calls)
                elif resolve:
                    self.assertIn('issue comment 7',calls);self.assertIn('issue comment 9',calls)
                    self.assertIn('issues/7#issuecomment-88',calls)
                else:self.assertIn('issue edit 7',calls)
        print('CONTRAST PASS: interrupted ordinary issue work still leaves its waiting label')

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
        start=source.index('if [ "$IS_PR" = true ]; then\n  if [ "${PR_COMMENT_ONLY')
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
TRUSTED_LINKED_ISSUE=7; TARGET_ISSUE=7
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
