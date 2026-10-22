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
        self.data={'pr':{'number':9,'state':'open','mergeable':True,'head':{'ref':'agent/issue-7','sha':'b'*40,'repo':{'full_name':'owner/repo'}}},'posts':[],'fail_pr':False,'calls':[],'ref':'b'*40}
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
 if '/pulls/' in path:done(None,1) if s.get('fail_pr_get') else done(s['pr'])
 if '/git/ref/heads/' in path:done({'object':{'sha':s['ref']}})
 if path.endswith('/issues/7'):done(None,1) if s.get('fail_issue_get') else done({'number':7})
 if '/comments' in path:
  if '/issues/comments/' in path:
   entry=next(x for x in s['posts'] if str(x['id'])==path.split('/')[-1]);entry['body']=json.load(sys.stdin)['body'] if '--input' in a else a[a.index('-f')+1].removeprefix('body=');done(entry)
  n=int(path.split('/issues/')[1].split('/')[0])
  if '--input' in a:body=json.load(sys.stdin)['body']
  elif '-f' in a:body=a[a.index('-f')+1].removeprefix('body=')
  else:
   if s.get('fail_list',False):done(None,1)
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
                  'REPO':'owner/repo','GITHUB_REPOSITORY':'owner/repo','RESOLVE_CONFLICT_PR':'9',
                  'TRUSTED_CONFLICT_ISSUE':'7','TRUSTED_CONFLICT_PR':'9','GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'123','RUN_URL':'https://github.com/owner/repo/actions/runs/123','GITHUB_ENV':str(self.dir/'env'),
                  'RUNNER_TEMP':self.temp,'GITHUB_WORKSPACE':self.temp,'PR_INSTRUCTION':'','PR_COMMENT_ONLY':'false',
                  'ISSUE':'7','TRUSTED_ISSUE':'7','TRUSTED_PR':'9','EVENT_IS_PR':'false','CONCLUSION':'failure'}
        trusted=self.dir/'coding-bot-conflict';trusted.mkdir()
        self.result_file=trusted/'result.json'
        self.result_file.write_text(json.dumps({'result':'pushed','sha':'b'*40}))
        for name in ['conflict-report.py','discussion.py']:
            if (BOT/name).exists():shutil.copy(BOT/name,trusted/name)
        self.validate_context()

    def validate_context(self):
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        step=next(s for s in steps if s.get('name')=='Preserve conflict reporter on host')
        output=self.dir/'context-outputs';output.write_text('')
        env={**self.env,'BOT':str(BOT),'GITHUB_OUTPUT':str(output)}
        code=step['run'].replace('${{ github.event.repository.default_branch }}','main')
        result=subprocess.run(['bash','-c','git() { cat "$BOT/${2##*/}"; }; '+code],env=env,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        context=dict(line.split('=',1) for line in output.read_text().splitlines())
        self.env.update(TRUSTED_CONFLICT_ISSUE=context.get('issue',''),TRUSTED_CONFLICT_PR=context.get('pr',''))

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
        self.data['pr']['head']['ref']='human-feature';self.save();self.validate_context()
        self.report();self.assertEqual(self.load()['posts'],[])
        print('CONTRAST PASS: non-bot PR is never a report target',flush=True)
        self.data['pr']['head']['ref']='agent/issue-7';self.data['pr']['state']='closed';self.save();self.validate_context()
        self.env.update(TRUSTED_ISSUE='',TRUSTED_PR='')
        self.result_file.write_text(json.dumps({'result':'failed'}))
        result=self.report();posts=self.load()['posts']
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([x['target'] for x in posts],[7])
        self.assertIn('PR が閉じているため解消しませんでした',posts[0]['body'])

    def test_partial_delivery_is_idempotent_on_rerun(self):
        self.data['fail_pr']=True;self.save()
        self.report();first=self.load()['posts']
        self.assertEqual([p['target'] for p in first],[7])
        self.assertIn('conflict を解消して push しました',first[0]['body'])
        self.report();before=self.load()['posts']
        self.assertEqual([p['target'] for p in before],[7,9])
        print('CONTRAST PASS: retry inside one attempt completes only its missing PR notice',flush=True)
        fresh=self.dir/'attempt-2';trusted=fresh/'coding-bot-conflict';trusted.mkdir(parents=True)
        for name in ['conflict-report.py','discussion.py']:shutil.copy(BOT/name,trusted/name)
        (trusted/'result.json').write_text(json.dumps({'result':'no_conflict'}))
        self.env.update(RUNNER_TEMP=str(fresh),GITHUB_RUN_ATTEMPT='2')
        result=self.report();posts=self.load()['posts']
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([p['target'] for p in posts],[7,9,7,9])
        self.assertEqual(posts[:2],before)
        self.assertIn('解消する conflict はありません',posts[2]['body'])
        self.assertIn('attempt=1',posts[0]['body']);self.assertIn('attempt=2',posts[2]['body'])
        self.report();self.assertEqual(self.load()['posts'],posts)

class DeliveryIsolationContract(HostProbe,unittest.TestCase):
    def test_pr_delivery_failure_never_rewrites_the_issue_result(self):
        self.data['fail_pr']=True;self.save()
        first=self.report();posts=self.load()['posts']
        self.assertEqual(first.returncode,3,first.stderr)
        self.assertEqual([p['target'] for p in posts],[7])
        self.assertIn('conflict を解消して push しました',posts[0]['body'])
        self.report();posts=self.load()['posts']
        self.assertEqual([p['target'] for p in posts],[7,9])
        self.assertIn('conflict を解消して push しました',posts[0]['body'])
        print('CONTRAST PASS: a rerun completes only the missing PR delivery',flush=True)

    def test_fallback_posts_once_when_only_the_comment_list_get_fails(self):
        self.data['fail_list']=True;self.save()
        result=self.report();posts=self.load()['posts']
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([p['target'] for p in posts],[7])
        self.assertIn('結果を確かめられませんでした',posts[0]['body'])
        print('CONTRAST PASS: POST remains available while list GET fails',flush=True)

    def test_fallback_never_patches_an_existing_report(self):
        self.report();before=self.load()['posts']
        (self.dir/'coding-bot-conflict/conflict-report.py').unlink()
        result=self.report()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.load()['posts'],before)
        print('CONTRAST PASS: a missing script preserves an existing result byte for byte',flush=True)

    def test_issue_event_fallback_survives_checkout_and_api_failure(self):
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        context=next(x for x in steps if x.get('id')=='notification_context')
        fallback=next(x for x in steps if x.get('name')=='Report if the run left nothing')
        env={**self.env,'EVENT_NUMBER':'7','EVENT_IS_PR':'false','GITHUB_EVENT_NAME':'issues','GITHUB_OUTPUT':str(self.dir/'outputs')}
        result=subprocess.run(['bash','-c',context['run']],cwd=self.dir,env=env,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('issue=7',Path(env['GITHUB_OUTPUT']).read_text())
        # The issue event supplied the destination even though checkout left no scripts.
        result=subprocess.run(['bash','-c',fallback['run']],cwd=self.dir,env=env,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([p['target'] for p in self.load()['posts']],[7])
        env.update(EVENT_NUMBER='9',EVENT_IS_PR='true',TRUSTED_ISSUE='')
        (self.dir/'outputs').write_text('');self.data['posts']=[];self.save()
        subprocess.run(['bash','-c',context['run']],cwd=self.dir,env=env,text=True,capture_output=True)
        subprocess.run(['bash','-c',fallback['run']],cwd=self.dir,env=env,text=True,capture_output=True)
        self.assertEqual(self.load()['posts'],[])
        print('CONTRAST PASS: unresolved PR events still never receive issue reports',flush=True)

    def test_dispatch_fallback_reuses_validated_issue_without_api(self):
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        context=next(x for x in steps if x.get('id')=='notification_context')
        for validated, is_pr in [('7','false'),('','false'),('7','true'),('','true')]:
            with self.subTest(validated=validated,is_pr=is_pr):
                env={**self.env,'GITHUB_EVENT_NAME':'workflow_dispatch','EVENT_NUMBER':'9' if is_pr=='true' else '7','EVENT_IS_PR':is_pr,'DISPATCH_ISSUE':'7',
                     'VALIDATED_ISSUE':validated,'GITHUB_OUTPUT':str(self.dir/'outputs')}
                (self.dir/'outputs').write_text('')
                result=subprocess.run(['bash','-c',context['run']],cwd=self.dir,env=env,text=True,capture_output=True)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertIn('issue=7',Path(env['GITHUB_OUTPUT']).read_text())
        validate=next(x for x in steps if x.get('name')=='Validate dispatch task')
        self.assertIn('id',validate);self.assertIn('GITHUB_OUTPUT',validate['run'])
        self.assertIn('outputs.issue',context['env']['VALIDATED_ISSUE'])
        print('CONTRAST PASS: issues event and an uncompleted dispatch validation retain their event issue',flush=True)

    def test_known_delivery_blocks_fallback_even_when_list_get_fails(self):
        self.report();before=self.load()['posts']
        self.data=self.load();self.data['fail_list']=True;self.save()
        result=self.report()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.load()['posts'],before)
        print('CONTRAST PASS: a genuinely missing report still gets one POST when list GET fails',flush=True)

    def test_verified_conflict_target_survives_observation_api_failure(self):
        for failure in ['fail_pr_get','fail_issue_get']:
            with self.subTest(failure=failure):
                self.data['posts']=[];self.data['calls']=[];self.data['fail_pr_get']=False;self.data['fail_issue_get']=False
                self.data[failure]=True;self.save()
                result=self.report();posts=self.load()['posts']
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertTrue(posts,result.stderr);self.assertEqual(posts[0]['target'],7)
                self.assertIn('結果を確かめられませんでした' if failure=='fail_pr_get' else 'push しました',posts[0]['body'])
                self.assertFalse(any(a[1]=='repos/owner/repo/issues/7' for a in self.load()['calls']))
        self.env.update(TRUSTED_CONFLICT_ISSUE='',TRUSTED_CONFLICT_PR='')
        self.data['posts']=[];self.save();self.report();self.assertEqual(self.load()['posts'],[])
        print('CONTRAST PASS: an unverified dispatch never becomes a conflict reporting target',flush=True)

    def test_fallback_only_patches_a_bot_comment_on_its_trusted_issue(self):
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        block=next(x['run'] for x in steps if x.get('name')=='Report if the run left nothing')
        for valid in ['yes','wrong_issue','human','unavailable']:
            with self.subTest(valid=valid),tempfile.TemporaryDirectory() as d:
                (Path(d)/'.coding-bot-task-progress').write_text('99')
                resource={'id':99,'issue_url':'https://api.github.com/repos/team/repo/issues/'+('34' if valid=='wrong_issue' else '12'),
                          'user':{'login':'person' if valid=='human' else 'github-actions[bot]','type':'User' if valid=='human' else 'Bot'}}
                stub='gh() { if [ "$1 $2" = "api repos/team/repo/issues/comments/99" ]; then '+('return 1' if valid=='unavailable' else "printf '%s' '"+json.dumps(resource)+"'")+r'; else printf "CALL %s\\n" "$*"; fi; }; '
                result=subprocess.run(['bash','-c',stub+block],env={**self.env,'PR_INSTRUCTION':'task','REPO':'team/repo','TRUSTED_ISSUE':'12','CONCLUSION':'failure','RUN_URL':'run','GITHUB_WORKSPACE':d,'GITHUB_STEP_SUMMARY':str(Path(d)/'summary')},text=True,capture_output=True)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual('-X PATCH repos/team/repo/issues/comments/99' in result.stdout,valid=='yes',result.stdout)
                if valid!='yes':self.assertIn('repos/team/repo/issues/12/comments',result.stdout)
        print('CONTRAST PASS: a verified bot progress comment remains patchable',flush=True)

    def test_notification_helpers_come_from_the_host_snapshot(self):
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        context=next(x for x in steps if x.get('id')=='notification_context')
        fallback=next(x for x in steps if x.get('name')=='Report if the run left nothing')
        for script in [context['run'],fallback['run']]:
            self.assertNotIn('source .github/coding-bot/',script)
            self.assertIn('$RUNNER_TEMP/coding-bot-notification/',script)
        snapshot=self.dir/'coding-bot-notification';snapshot.mkdir()
        for name in ['discussion.py','trigger-source.sh','pr-comment.sh']:shutil.copy(BOT/name,snapshot/name)
        malicious=self.dir/'.github/coding-bot';malicious.mkdir(parents=True)
        (malicious/'trigger-source.sh').write_text('touch "$GITHUB_WORKSPACE/WORKSPACE_EXECUTED"')
        env={**self.env,'EVENT_NUMBER':'9','EVENT_IS_PR':'true','GITHUB_EVENT_NAME':'pull_request','GITHUB_OUTPUT':str(self.dir/'outputs')}
        result=subprocess.run(['bash','-c',context['run']],cwd=self.dir,env=env,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('issue=7',Path(env['GITHUB_OUTPUT']).read_text())
        self.assertFalse((self.dir/'WORKSPACE_EXECUTED').exists())

class HostStateContract(HostProbe,unittest.TestCase):
    def test_observed_head_and_mergeability_determine_report(self):
        import importlib.util
        from unittest.mock import patch
        spec=importlib.util.spec_from_file_location('conflict_report',BOT/'conflict-report.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        for state,changed,mergeable,expected in [
            ('open',True,True,'conflict を解消して push しました'),
            ('open',False,True,'解消する conflict はありません'),
            ('open',False,False,'解消を完了できませんでした'),
            ('open',False,None,'解消を完了できませんでした'),
            ('open',True,False,'push しましたが、まだ merge できる状態か確かめられません'),
            ('open',True,None,'push しましたが、まだ merge できる状態か確かめられません'),
            ('closed',True,True,'conflict を解消して push しました')]:
            with self.subTest(state=state,changed=changed,mergeable=mergeable):
                self.data['posts']=[];self.data['calls']=[]
                self.data['pr'].update(state=state,mergeable=mergeable)
                self.data['pr']['head']['sha']=('b' if changed else 'a')*40;self.save()
                self.result_file.write_text(json.dumps({'result':'pushed','sha':'b'*40} if changed else {'result':'no_conflict'} if mergeable is True else {'result':'failed'}))
                with patch.dict(os.environ,self.env),patch.object(module.time,'sleep'):
                    module.report('owner/repo','9','123',7)
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
        start=steps[names.index('Preserve conflict reporter on host')]
        end=steps[names.index('Report conflict resolution')]
        fallback=steps[names.index('Report if the run left nothing')]
        self.assertLess(names.index('Preserve conflict reporter on host'),names.index('Validate dispatch task'))
        self.assertLess(names.index('Report conflict resolution'),names.index('Report if the run left nothing'))
        self.assertIn('steps.conflict_context.outputs.issue',end['env']['TRUSTED_CONFLICT_ISSUE'])
        self.assertIn('steps.conflict_context.outputs.pr',end['env']['TRUSTED_CONFLICT_PR'])
        self.assertIn('always()',end['if'])
        self.assertIn("inputs.resolve_conflict_pr != ''",end['if'])
        self.assertIn("inputs.resolve_conflict_pr == ''",fallback['if'])
        self.assertIn('git show',start['run']);self.assertIn('$RUNNER_TEMP',start['run'])
        self.assertNotIn('CONFLICT_START_HEAD',(BOT/'conflict-report.py').read_text())
        self.assertNotIn('conflict-report.py" start',start['run'])

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


class RunnerResultContract(HostProbe,unittest.TestCase):
    def outcome(self, value):
        self.result_file.write_text(json.dumps(value))

    def text(self):
        result=self.report()
        self.assertEqual(result.returncode,0,result.stderr)
        posts=self.load()['posts']
        self.assertTrue(posts)
        return posts[0]['body']

    def test_report_describes_this_run_not_other_writers_or_closed_pr(self):
        self.outcome({'result':'pushed','sha':'b'*40})
        self.assertIn('conflict を解消して push しました',self.text())
        print('CONTRAST PASS: verified push remains success',flush=True)
        for outcome,state,head,expected in [
            ({'result':'no_conflict'},'open','a','解消する conflict はありません。'),
            ({'result':'failed'},'open','b','conflict の解消を完了できませんでした。'),
            ({'result':'pushed','sha':'b'*40},'closed','b','conflict を解消して push しました。')]:
            with self.subTest(outcome=outcome,state=state):
                self.data['posts']=[];self.data['pr']['state']=state;self.data['pr']['head']['sha']=head*40;self.save()
                self.outcome(outcome);self.assertIn(expected,self.text())

    def test_missing_result_script_or_api_uses_host_fallback(self):
        self.data['pr']['head']['ref']='human-feature';self.save();self.validate_context()
        self.assertEqual(self.report().returncode,0)
        self.assertEqual(self.load()['posts'],[])
        print('CONTRAST PASS: unrelated PR stays silent',flush=True)
        self.data['pr']['head']['ref']='agent/issue-7';self.save();self.validate_context()
        for missing in ['result','script','api']:
            with self.subTest(missing=missing):
                self.data['posts']=[];self.save()
                for record in self.result_file.parent.glob('issue-comment-*'):record.unlink()
                self.outcome({'result':'pushed','sha':'b'*40})
                script=self.dir/'coding-bot-conflict/conflict-report.py'
                script.write_text((BOT/'conflict-report.py').read_text())
                if missing=='result':self.result_file.unlink()
                if missing=='script':script.unlink()
                if missing=='api':script.write_text('raise RuntimeError("report API unavailable")')
                text=self.text()
                self.assertIn('conflict の解消の結果を確かめられませんでした。このスレッドで対応を相談してください。',text)
                self.assertIn('/actions/runs/123',text)

    def test_rerun_patches_both_reports_without_duplicates(self):
        self.data['pr']['head']['sha']='a'*40;self.save()
        self.outcome({'result':'failed'});self.text()
        self.data=self.load();self.data['pr']['head']['sha']='b'*40;self.save()
        self.outcome({'result':'pushed','sha':'b'*40});text=self.text()
        posts=self.load()['posts']
        self.assertEqual([x['target'] for x in posts],[7,9])
        self.assertIn('conflict を解消して push しました',text)
        self.assertIn(posts[0]['html_url'],posts[1]['body'])
        before=posts;self.text();self.assertEqual(self.load()['posts'],before)
        print('CONTRAST PASS: repeated identical outcome remains one comment per target',flush=True)

    def test_pushed_sha_is_checked_against_branch_ref_not_stale_pr_head(self):
        self.data['pr']['head']['sha']='a'*40;self.save()
        self.assertIn('conflict を解消して push しました',self.text())
        self.data['posts']=[];self.data['ref']='c'*40;self.save()
        text=self.text()
        self.assertNotIn('conflict を解消して push しました',text)
        print('CONTRAST PASS: unmatched branch ref is never called success',flush=True)

    def test_failed_resolution_explains_where_to_continue(self):
        self.outcome({'result':'pushed','sha':'b'*40})
        self.assertIn('conflict を解消して push しました',self.text())
        print('CONTRAST PASS: verified success remains successful',flush=True)
        self.data['posts']=[];self.save();self.outcome({'result':'failed'})
        self.assertIn('conflict の解消を完了できませんでした。このスレッドで対応を相談してください。',self.text())

    def test_host_capture_uses_final_runner_result_and_rejects_partial_output(self):
        import importlib.util
        from unittest.mock import patch
        spec=importlib.util.spec_from_file_location('report_capture',BOT/'conflict-report.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        log=self.dir/'runner.log'
        for content,status,valid in [
            ('engine log\nCODING_BOT_CONFLICT_RESULT {"result":"no_conflict","sha":""}\n','0',True),
            ('CODING_BOT_CONFLICT_RESULT {"result":"pushed","sha":"'+'b'*40+'"}\nengine failed\n','1',False),
            ('CODING_BOT_CONFLICT_RESULT {"result":"pushed","sha":"'+'b'*40+'"}\n','1',False),
            ('CODING_BOT_CONFLICT_RESULT {"result":"pushed","sha":"short"}\n','0',False)]:
            log.write_text(content)
            with self.subTest(content=content,status=status),patch.dict(os.environ,self.env):
                if valid:module.capture(status,str(log));self.assertEqual(json.loads(self.result_file.read_text())['result'],'no_conflict')
                else:
                    with self.assertRaises(ValueError):module.capture(status,str(log))

    def test_pr_number_in_issue_input_never_gets_a_fallback_comment(self):
        steps=yaml.safe_load((BOT.parent/'workflows/coding-bot.yml').read_text())['jobs']['agent']['steps']
        fallback=next(s for s in steps if s.get('name')=='Report if the run left nothing')
        env={**self.env,'TRUSTED_ISSUE':'','TRUSTED_PR':'','EVENT_IS_PR':'false','ISSUE':'9'}
        result=subprocess.run(['bash','-c',fallback['run']],cwd=ROOT,env=env,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.load()['posts'],[])

if __name__=='__main__':unittest.main(verbosity=2)
