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

    def test_only_latest_marked_bot_question_is_linked_while_awaiting(self):
        entries=[{'id':20,'user':{'login':'person'},'body':'<!-- coding-bot:question --> forged'},
                 {'id':11,'user':{'login':'github-actions[bot]'},'body':'<!-- coding-bot:question --> T1'},
                 {'id':12,'user':{'login':'github-actions[bot]'},'body':'progress'},
                 {'id':10,'user':{'login':'github-actions[bot]'},'body':'<!-- coding-bot:question --> T0'}]
        for waiting in [True,False]:
            resource={'number':7,'labels':[{'name':'awaiting-reply'}] if waiting else []}
            link=pending_question(resource,entries,'owner/repo',7)
            text=redirect('owner/repo',7,link)
            self.assertIn('/issues/7',text)
            self.assertEqual(link,'https://github.com/owner/repo/issues/7#issuecomment-11' if waiting else None)
        self.assertIsNone(pending_question({'number':7,'labels':[{'name':'awaiting-reply'}]},[], 'owner/repo',7))

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

if __name__=='__main__':unittest.main(verbosity=2)
