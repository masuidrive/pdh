"""Conflict reports belong to the host and describe observed PR state once."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import yaml

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'.github/coding-bot/pr-comment.sh').is_file())
BOT=Path(os.environ.get('BOT_MODULE_PATH',ROOT/'.github/coding-bot'))

class HostProbe:
    def setUp(self):
        self.temp=self.enterContext(tempfile.TemporaryDirectory())
        self.dir=Path(self.temp);self.state=self.dir/'state.json';self.bindir=self.dir/'bin';self.bindir.mkdir()
        self.data={'pr':{'number':9,'state':'open','mergeable':True,'head':{'ref':'agent/issue-7','sha':'b'*40,'repo':{'full_name':'owner/repo'}}},'posts':[],'fail_pr':False,'calls':[]}
        self.state.write_text(json.dumps(self.data))
        gh=self.bindir/'gh';gh.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
p=Path(os.environ['GH_STATE']);s=json.loads(p.read_text());a=sys.argv[1:];s['calls'].append(a)
def done(value=None,code=0):
 p.write_text(json.dumps(s))
 if value is not None:print(json.dumps(value) if not isinstance(value,str) else value)
 sys.exit(code)
if a[0]=='issue' and a[1]=='comment':
 n=int(a[2]);body=a[a.index('--body')+1]
elif a[0]=='api':
 path=next(x for x in a if x.startswith('repos/'))
 if '/pulls/' in path:done(s['pr'])
 if path.endswith('/issues/7'):done({'number':7})
 if '/comments' in path:
  n=int(path.split('/issues/')[1].split('/')[0])
  if '--input' in a:body=json.load(sys.stdin)['body']
  else:
   entries=[x for x in s['posts'] if x['target']==n]
   done([entries] if '--slurp' in a else entries)
 else:done({},98)
else:done({},98)
if n==9 and s['fail_pr']:
 s['fail_pr']=False;done(None,1)
id=100+len(s['posts']);url=f'https://github.com/owner/repo/issues/{n}#issuecomment-{id}'
entry={'id':id,'target':n,'body':body,'html_url':url,'user':{'login':'github-actions[bot]','type':'Bot'}}
s['posts'].append(entry)
done(entry if a[0]=='api' else url)
''');gh.chmod(0o755)
        self.env={**os.environ,'PATH':str(self.bindir)+':'+os.environ['PATH'],'GH_STATE':str(self.state),
                  'REPO':'owner/repo','GITHUB_REPOSITORY':'owner/repo','RESOLVE_CONFLICT_PR':'9','CONFLICT_START_HEAD':'a'*40,
                  'GITHUB_RUN_ID':'123','RUN_URL':'https://github.com/owner/repo/actions/runs/123','GITHUB_ENV':str(self.dir/'env'),
                  'RUNNER_TEMP':self.temp,'GITHUB_WORKSPACE':self.temp,'PR_INSTRUCTION':'','PR_COMMENT_ONLY':'false',
                  'ISSUE':'7','TRUSTED_ISSUE':'7','TRUSTED_PR':'9','EVENT_IS_PR':'false','CONCLUSION':'failure'}
        trusted=self.dir/'coding-bot-conflict';trusted.mkdir()
        for name in ['conflict-report.py','discussion.py']:
            if (BOT/name).exists():shutil.copy(BOT/name,trusted/name)

    def save(self):self.state.write_text(json.dumps(self.data))
    def load(self):return json.loads(self.state.read_text())
    def report(self):
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        step=next((s for s in steps if s.get('name')=='Report conflict resolution'),None)
        if step is None:step=next(s for s in steps if s.get('name')=='Report if the run left nothing')
        return subprocess.run(['bash','-c',step['run']],cwd=ROOT,env=self.env,text=True,capture_output=True)

class HostReport(HostProbe,unittest.TestCase):
    def test_closed_pr_reports_even_when_dispatch_validation_failed(self):
        self.env.update(TRUSTED_ISSUE='',TRUSTED_PR='')
        self.data['pr']['head']['ref']='human-feature';self.save()
        self.report();self.assertEqual(self.load()['posts'],[])
        print('CONTRAST PASS: non-bot PR is never a report target',flush=True)
        self.data['pr']['head']['ref']='agent/issue-7';self.data['pr']['state']='closed';self.save()
        self.env.update(TRUSTED_ISSUE='',TRUSTED_PR='')
        result=self.report();posts=self.load()['posts']
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([x['target'] for x in posts],[7])
        self.assertIn('PR が閉じているため解消しませんでした',posts[0]['body'])

    def test_partial_delivery_is_idempotent_on_rerun(self):
        self.data['fail_pr']=True;self.save()
        self.report()
        self.assertEqual([x['target'] for x in self.load()['posts']],[7])
        print('CONTRAST PASS: a failed PR delivery preserves the issue report',flush=True)
        self.report()
        posts=self.load()['posts']
        self.assertEqual([x['target'] for x in posts],[7,9])
        self.assertIn('conflict を解消して push しました',posts[0]['body'])
        self.assertIn(posts[0]['html_url'],posts[1]['body'])
        self.assertTrue(all('<!-- coding-bot:conflict-report run=123 -->' in x['body'] for x in posts))
        self.report();self.assertEqual(self.load()['posts'],posts)
        print('CONTRAST PASS: a completed report is never duplicated',flush=True)

class HostStateContract(HostProbe,unittest.TestCase):
    def test_observed_head_and_mergeability_determine_report(self):
        import importlib.util
        from unittest.mock import patch
        spec=importlib.util.spec_from_file_location('conflict_report',BOT/'conflict-report.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        for state,changed,mergeable,expected in [
            ('open',True,True,'conflict を解消して push しました'),
            ('open',False,True,'解消を完了できませんでした'),
            ('open',False,False,'解消を完了できませんでした'),
            ('open',False,None,'解消を完了できませんでした'),
            ('open',True,False,'push したが、まだ merge できる状態か確かめられません'),
            ('open',True,None,'push したが、まだ merge できる状態か確かめられません'),
            ('closed',True,True,'PR が閉じているため解消しませんでした')]:
            with self.subTest(state=state,changed=changed,mergeable=mergeable):
                self.data['posts']=[];self.data['calls']=[]
                self.data['pr'].update(state=state,mergeable=mergeable)
                self.data['pr']['head']['sha']=('b' if changed else 'a')*40;self.save()
                with patch.dict(os.environ,self.env),patch.object(module.time,'sleep'):
                    module.report('owner/repo','9','a'*40,'123')
                data=self.load();posts=data['posts']
                self.assertEqual([x['target'] for x in posts],[7] if state=='closed' else [7,9])
                self.assertIn(expected,posts[0]['body'])
                if changed and mergeable is None and state=='open':
                    self.assertEqual(sum(any('/pulls/9' in x for x in a) for a in data['calls']),4)
                if state=='open' and changed and mergeable is not True:
                    self.assertNotIn('完了できません',posts[0]['body'])

    def test_host_observation_survives_validation_and_runner_failure(self):
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        names=[x.get('name') for x in steps]
        start=steps[names.index('Record conflict starting head')]
        end=steps[names.index('Report conflict resolution')]
        fallback=steps[names.index('Report if the run left nothing')]
        self.assertLess(names.index('Record conflict starting head'),names.index('Validate dispatch task'))
        self.assertLess(names.index('Report conflict resolution'),names.index('Report if the run left nothing'))
        self.assertIn('always()',end['if'])
        self.assertIn("inputs.resolve_conflict_pr != ''",end['if'])
        self.assertIn("inputs.resolve_conflict_pr == ''",fallback['if'])
        self.assertIn('git show',start['run']);self.assertIn('$RUNNER_TEMP',start['run'])
        with tempfile.TemporaryDirectory() as d:
            env={**self.env,'GITHUB_ENV':str(Path(d)/'env')}
            result=subprocess.run(['python3','-I',str(BOT/'conflict-report.py'),'start'],env=env,text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(Path(env['GITHUB_ENV']).read_text(),'CONFLICT_START_HEAD='+'b'*40+'\n')

class EngineAuthContract(unittest.TestCase):
    def test_pr_auth_failure_does_not_run_issue_failed_hook(self):
        for engine in ['_claude.sh','_codex.sh']:
            for pr_only in ['false','true']:
                with self.subTest(engine=engine,pr_only=pr_only),tempfile.TemporaryDirectory() as d:
                    root=Path(d);(root/'tickets').mkdir();(root/'product-brief.md').touch()
                    (root/'pdh-hooks.sh').write_text('echo failed >> "$AUTH_LOG"\n')
                    code='''post_error_comment() { :; }
codex_prepare_auth() { CODEX_AUTH_STATUS=unavailable; }
codex_report_auth_failure() { :; }
source "$ENGINE_SOURCE"
engine_setup_auth
'''
                    env={**os.environ,'SCRIPT_DIR':d,'ISSUE_NUMBER':'7','GITHUB_REPOSITORY':'owner/repo','BRANCH_NAME':'agent/issue-7',
                         'RESOLVE_CONFLICT_PR':'','PR_COMMENT_ONLY':pr_only,'CLAUDE_CODE_OAUTH_TOKEN':'',
                         'ENGINE_SOURCE':str(BOT/'engines'/engine),'AUTH_LOG':str(root/'auth.log')}
                    result=subprocess.run(['bash','-c',code],cwd=root,env=env,text=True,capture_output=True)
                    self.assertEqual(result.returncode,1)
                    self.assertEqual((root/'auth.log').exists(),pr_only=='false')

if __name__=='__main__':unittest.main(verbosity=2)
