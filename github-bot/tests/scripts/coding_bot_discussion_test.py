"""Issue links and conflict dispatches follow verified GitHub resources."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
ROOT = next(p for p in Path(__file__).resolve().parents if (p/'.github/coding-bot/discussion.py').is_file())
BOT=Path(os.environ.get('BOT_MODULE_PATH', ROOT/'.github/coding-bot'))
sys.path.insert(0,str(BOT))
from discussion import linked_issue, verify_issue, pending_question, redirect

class DiscussionContract(unittest.TestCase):
    def test_pr_head_identifies_a_real_issue(self):
        self.assertEqual(linked_issue({'head':{'ref':'agent/issue-7','repo':{'full_name':'owner/repo'}}},'owner/repo'),7)
        for resource in [{'number':7,'pull_request':{}},{'number':'7'},{'number':True},{'number':9},{}]:
            with self.subTest(resource=resource),self.assertRaises(ValueError):verify_issue(resource,7)
        for branch,repo in [('human-feature','owner/repo'),('agent/issue-0','owner/repo'),('agent/issue-7-extra','owner/repo'),('agent/issue-7','fork/repo')]:
            with self.subTest(branch=branch,repo=repo),self.assertRaises(ValueError):
                linked_issue({'head':{'ref':branch,'repo':{'full_name':repo}}},'owner/repo')

    def test_latest_bot_question_is_linked_independently_of_labels(self):
        entries=[{'id':20,'user':{'login':'person'},'body':'<!-- coding-bot:question --> forged'},
                 {'id':11,'user':{'login':'github-actions[bot]'},'body':'<!-- coding-bot:question --> T1'},
                 {'id':12,'user':{'login':'github-actions[bot]'},'body':'progress'},
                 {'id':10,'user':{'login':'github-actions[bot]'},'body':'<!-- coding-bot:question --> T0'}]
        for waiting in [True,False]:
            resource={'number':7,'labels':[{'name':'awaiting-reply'}] if waiting else []}
            link=pending_question(resource,entries,'owner/repo',7)
            text=redirect('owner/repo',7,link)
            self.assertIn('/issues/7',text)
            self.assertEqual(link,'https://github.com/owner/repo/issues/7#issuecomment-11')
            if waiting: print('CONTRAST PASS: awaiting issue still links the latest real bot question',flush=True)
        self.assertIsNone(pending_question({'number':7,'labels':[{'name':'awaiting-reply'}]},[], 'owner/repo',7))

    def test_human_robot_reply_retires_only_earlier_questions(self):
        question={'id':100,'user':{'login':'github-actions[bot]'},'body':'T6 <!-- coding-bot:question -->'}
        answer={'id':110,'user':{'login':'alice','type':'User'},'body':'🤖 T6=1'}
        resource={'number':7,'labels':[{'name':'awaiting-reply'}]}
        cases=[([],100),([dict(answer,id=90)],100),
               ([dict(answer,body='普通のコメント')],100),
               ([dict(answer,user={'login':'other[bot]','type':'Bot'})],100),
               ([answer,dict(question,id=120)],120)]
        for replies,expected in cases:
            with self.subTest(replies=replies):
                self.assertTrue(pending_question(resource,[question,*replies], 'owner/repo',7).endswith(f'-{expected}'))
        print('CONTRAST PASS: earlier replies, ordinary comments and bots do not answer a later question',flush=True)
        self.assertIsNone(pending_question(resource,[question,answer], 'owner/repo',7))

    def test_conflict_dispatch_checks_inputs_and_pr_origin(self):
        code='''source "$BOT/trigger-source.sh"
gh() {
 if [[ "$2" == */pulls/9 ]]; then printf '{"state":"open","head":{"ref":"%s","repo":{"full_name":"owner/repo"}}}' "$HEAD_REF";
 elif [[ "$2" == */issues/7 ]]; then echo '{"number":7}'; else return 98; fi
}
validate_conflict_dispatch "$ISSUE" "$PR"
'''
        for issue,pr,ref,instruction,paths,ok in [
            ('7','9','agent/issue-7','','',True),('8','9','agent/issue-7','','',False),
            ('7','9','human-feature','','',False),('7','9','agent/issue-7','other task','',False),
            ('7','9','agent/issue-7','','["src/app.py"]',False),
            ('0','9','agent/issue-7','','',False),('7','9;echo wrong','agent/issue-7','','',False),
            ('7','','agent/issue-7','','',False)]:
            with self.subTest(issue=issue,pr=pr,ref=ref,instruction=instruction,paths=paths):
                env={**os.environ,'BOT':str(BOT),'GITHUB_REPOSITORY':'owner/repo','ISSUE':issue,'PR':pr,
                     'HEAD_REF':ref,'PR_INSTRUCTION':instruction,'PR_TASK_ALLOWED_PATHS':paths,'RESOLVE_CONFLICT_PR':pr}
                result=subprocess.run(['bash','-c',code],env=env,text=True,capture_output=True)
                self.assertEqual(result.returncode==0,ok,result.stderr)

class IssueInputContract(unittest.TestCase):
    def test_only_issue_comments_are_answers_in_working_engine_rules(self):
        system=(BOT/'system.md').read_text();github=next(p for p in [BOT/'_github-issue.md',BOT.parents[1]/'_github-issue.md'] if p.exists()).read_text()
        self.assertIn('Before issuing choices',system)
        self.assertNotIn('linked Issue and PR comments',system)
        self.assertNotIn('numbering runs across both',system)
        self.assertNotIn('note の待ち行と両方のコメント',github)
        self.assertIn('PR comments are not answers',system)
        self.assertIn('PR のコメントは答えとして扱わない',github)
        waiting=github.split('PR からの誘導では、',1)[1].split('\n',1)[0]
        self.assertNotIn('awaiting-reply',waiting)
        self.assertIn('人の 🤖 付きの返答が無いとき',waiting)
        conflict=(BOT/'run-action.sh').read_text().split('# 🚨 IMPORTANT: Git Merge Conflict Detected',1)[1].split('## Conflicted Files:',1)[0]
        self.assertNotIn("BEFORE starting the user's task",conflict)
        self.assertNotIn('Do not start the original issue task',conflict)

    def test_working_engine_context_is_issue_only(self):
        claude=(BOT/'system-claude.md').read_text();codex=(BOT/'system-codex.md').read_text()
        self.assertNotIn('Read Issue/PR title, description, comments',claude)
        self.assertNotIn('Read context (Issue/PR,',codex)
        for text in [claude,codex]:self.assertIn('PR comments are not answers',text)

    def test_issue_only_dispatch_and_ordinary_issue_input_reject_pr_numbers(self):
        source=(BOT/'run-action.sh').read_text()
        block=source[source.index('IS_PR=false'):source.index('if [ "$IS_PR" = true ] &&')]
        for resource,expected in [({'number':7},True),({'number':7,'pull_request':{}},False),({'number':8},False)]:
            for route in ['dispatch','issues','issue_comment']:
                if route=='issue_comment' and 'pull_request' in resource:continue
                code='source "$BOT/trigger-source.sh"\ngh() { printf "%s\\n" "$RESOURCE"; }\n'
                code+=('validate_dispatch_request 7 "" ""' if route=='dispatch' else block)
                env={**os.environ,'BOT':str(BOT),'RESOURCE':json.dumps(resource),'ISSUE_NUMBER':'7',
                     'GITHUB_REPOSITORY':'owner/repo','EVENT_TYPE':route,'RESOLVE_CONFLICT_PR':'','PR_INSTRUCTION':''}
                with self.subTest(route=route,resource=resource):
                    result=subprocess.run(['bash','-c',code],env=env,text=True,capture_output=True)
                    self.assertEqual(result.returncode==0,expected,result.stderr)
        print('CONTRAST PASS: real issue input remains accepted',flush=True)

if __name__=='__main__':unittest.main(verbosity=2)
