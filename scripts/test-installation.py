#!/usr/bin/env python3
"""Execute marked INSTALL shell blocks in isolated consuming projects."""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import tempfile
import tomllib

ROOT=Path(__file__).resolve().parents[1]
executed=set()
env=dict(os.environ, GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_TEMPLATE_DIR='',
         GIT_AUTHOR_NAME='PDH Test',GIT_AUTHOR_EMAIL='test@example.invalid',
         GIT_COMMITTER_NAME='PDH Test',GIT_COMMITTER_EMAIL='test@example.invalid')
for name in list(env):
    if name in ('GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR'):del env[name]


def run(cwd,*args,code=0):
    result=subprocess.run(args,cwd=cwd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    assert result.returncode==code,(args,result.returncode,result.stdout)
    return result.stdout


def shell_block(engine, name):
    guide=(ROOT/engine/'INSTALL.md').read_text()
    blocks=re.findall(r'<!-- pdh-shell: '+re.escape(name)+r' -->\n```bash\n(.*?)\n```',guide,re.S)
    assert len(blocks)==1, (engine,name,'requires exactly one marked shell block')
    return blocks[0]


def documented(target, engine, name, code=0):
    script=shell_block(engine,name)
    run(target,'bash','-n','-c',script)
    output=run(target,'bash','-euo','pipefail','-c',script,code=code)
    executed.add((engine,name))
    return output


def verify_install(target, engine):
    documented(target,engine,'verify')
    if engine=='codex':documented(target,engine,'verify-layout')


def payload(target):
    return {str(p.relative_to(target)): (os.readlink(p) if p.is_symlink() else p.read_bytes())
            for p in target.rglob('*') if (p.is_file() or p.is_symlink())
            and p.relative_to(target).parts[0] not in ('.git','tmp')}


def stage_docs(target, code):
    for stage in ('ticket-write','ticket-review','implement','review','verify'):
        output=run(target,'bash','scripts/docs-toc.sh','--stage','PDH-'+stage,code=code)
        if code:
            assert 'docs/plain.md' in output and 'frontmatter' in output,output
        else:
            assert len(output.splitlines())==1 and '採用していない' in output,output
    record=target/'tmp/skip-record.md'
    output=run(target,'python3','scripts/docs-policy.py','record','docs/plain.md',
               '--base','HEAD','--resolution','unchanged','--reason','project document',
               '--output',str(record),code=code)
    assert not record.exists(),'no-op/failed record created a file'
    if code:
        assert 'docs/plain.md' in output and 'frontmatter' in output,output
    else:
        assert len(output.splitlines())==1 and '採用していない' in output,output


with tempfile.TemporaryDirectory(prefix='pdh-install-') as temporary:
    temp=Path(temporary)
    upstream=temp/'upstream'
    upstream.mkdir()
    # Snapshot only distributed payload; write requires a committed upstream.
    for engine in ('claude','codex','docs','github-bot'):
        shutil.copytree(ROOT/engine,upstream/engine)
    run(upstream,'git','init','-q','-b','main')
    run(upstream,'git','add','.')
    run(upstream,'git','-c','commit.gpgsign=false','commit','-qm','fixture distribution')
    (upstream/'scripts').mkdir()
    shutil.copy2(ROOT/'scripts/check-placement.py', upstream/'scripts/check-placement.py')
    run(upstream,'python3','scripts/check-placement.py')
    guide=upstream/'claude/INSTALL.md'; original=guide.read_text()
    guide.write_text(original.replace('| 上書き |', '| invalid |', 1))
    run(upstream,'python3','scripts/check-placement.py',code=1)
    guide.write_text(original)
    mapping=upstream/'claude/lock-map.tsv';original=mapping.read_text()
    mapping.write_text('\n'.join(original.splitlines()[1:])+'\n')
    run(upstream,'python3','scripts/check-placement.py',code=1)
    mapping.write_text(original)
    run(upstream,'python3','scripts/check-placement.py')
    # Exercise the exact clone/fetch/curl commands without external services.
    # Only transport is substituted: ticket.sh init uses the real vendored script.
    bins=temp/'bin';bins.mkdir()
    curl=bins/'curl'
    curl.write_text('''#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 4 ] && [ "$1" = -sL ] && [ "$3" = -o ]
[ "$2" = https://raw.githubusercontent.com/masuidrive/ticket.sh/main/ticket.sh ]
cp "$PDH_TICKET_FIXTURE" "$4"
''')
    curl.chmod(0o755)
    env.update(PATH=str(bins)+os.pathsep+env['PATH'],
               PDH_TICKET_FIXTURE=str(ROOT/'tests/fixtures/ticket.sh'),
               GIT_CONFIG_COUNT='1',GIT_CONFIG_KEY_0=f'url.{upstream}.insteadOf',
               GIT_CONFIG_VALUE_0='https://github.com/masuidrive/pdh.git')
    for engine in ('claude','codex'):
        # Install into an existing project with unrelated rules and permissions.
        # These deliberately are not PDH templates: preservation precedes merging.
        existing=temp/(engine+'-existing')
        existing.mkdir()
        run(existing,'git','init','-q','-b','main')
        originals={name: '# Project-owned '+name+'\n' for name in
                   ('CLAUDE.md','AGENTS.md','product-brief.md','scripts/test-all.sh',
                    'scripts/dev-server.sh','scripts/seed-pdh-verify.sh',
                    'docs/pdh-review-eval/README.md','scripts/checks/required-pdh-files.check')}
        originals['.ticket-config.yaml']='tickets_dir: tickets\nproject_value: retained\n'
        user_hook={'type':'command','command':'echo project hook','timeout':42}
        user_settings={'permissions':{'allow':['Bash(project-command)']},
                       'hooks':{'SessionStart':[{'matcher':'startup|resume|compact','hooks':[user_hook]}]},
                       'project_setting':True}
        for name,body in originals.items():
            path=existing/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(body)
        json_paths=['.codex/hooks.json','.claude/settings.json']
        for name in json_paths:
            path=existing/name;path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text(json.dumps(user_settings))
        documented(existing,engine,'prepare')
        # Parse every input before writing any hook settings, including templates.
        merge_paths=json_paths if engine=='claude' else json_paths[:1]
        for invalid_source in (False,True):
            for name in merge_paths:
                broken=(existing/'tmp/pdh'/engine/'templates'/Path(name).name
                        if invalid_source else existing/name)
                original=broken.read_bytes()
                broken.write_text('{ invalid JSON\n')
                before={name:(existing/name).read_bytes() for name in json_paths}
                assert 'JSONDecodeError' in documented(existing,engine,'install',code=1)
                assert before=={name:(existing/name).read_bytes() for name in json_paths},(engine,name,'partial JSON write')
                broken.write_bytes(original)
        if engine=='claude':
            # A missing first destination must not be created if the second is invalid.
            first=existing/json_paths[0];original=first.read_bytes();first.unlink()
            second=existing/json_paths[1];body=second.read_bytes();second.write_text('{ invalid JSON\n')
            documented(existing,engine,'install',code=1)
            assert not first.exists(),'created hooks.json before validating settings.json'
            assert second.read_text()=='{ invalid JSON\n'
            first.write_bytes(original);second.write_bytes(body)
        print(engine+': invalid destination/template JSON leaves all hook settings untouched')
        for iteration in range(2):
            documented(existing,engine,'install')
            for name,body in originals.items():
                assert (existing/name).read_text()==body,(engine,name,'existing content overwritten')
            for name in json_paths:
                settings=json.loads((existing/name).read_text())
                assert settings['permissions']==user_settings['permissions']
                assert settings['project_setting'] is True
                hooks=settings['hooks']['SessionStart'][0]['hooks']
                assert hooks[0]==user_hook
                expected=2 if name=='.codex/hooks.json' or engine=='claude' else 1
                assert len(hooks)==expected,(engine,name,hooks)
                if expected==2:assert 'pdh-session-hook.sh' in hooks[1]['command']
            if iteration==0:initial=payload(existing)
            else:assert initial==payload(existing),'second install changed existing project'
        print(engine+': existing rules, config, permissions and hooks preserved; PDH hooks added once')
        # Existing PDH hooks can use a different matcher or shell quoting.
        for matcher in ('startup','startup|resume|compact'):
            settings=json.loads(json.dumps(user_settings))
            settings['hooks']['SessionStart'].append({
                'matcher':matcher,
                'hooks':[{'type':'command','command':"bash './scripts/pdh-session-hook.sh'",'timeout':9}]})
            for name in merge_paths:(existing/name).write_text(json.dumps(settings))
            for iteration in range(2):
                documented(existing,engine,'install')
                for name in merge_paths:
                    actual=json.loads((existing/name).read_text())
                    assert actual==settings,(engine,name,matcher,'duplicate PDH hook or changed existing settings')
        print(engine+': alternate matcher/quoting keeps the existing PDH hook and unrelated settings unchanged')
        target=temp/engine
        target.mkdir()
        run(target,'git','init','-q','-b','main')
        (target/'.gitignore').write_text('tmp/\n')
        (target/'docs').mkdir()
        (target/'docs/plain.md').write_text('# Existing project document\nNo frontmatter.\n')
        custom={'.codex/agents/my-custom-agent.toml': 'project-owned agent\n'}
        if engine=='claude':custom['.claude/agents/my-custom-agent.md']='project-owned agent\n'
        for name,body in custom.items():
            path=target/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(body)
        run(target,'git','add','.')
        run(target,'git','-c','commit.gpgsign=false','commit','-qm','existing project')
        documented(target,engine,'runtime-check')
        documented(target,engine,'prepare')
        documented(target,engine,'install')
        if engine=='claude':
            documented(target,engine,'symlinks')
            documented(target,engine,'config')
        else:
            documented(target,engine,'ancestry')
            documented(target,engine,'local-ignore')
            documented(target,engine,'local-ignore')
            assert (target/'.gitignore').read_text().splitlines().count('AGENTS.local.md')==1
            documented(target,engine,'worker-resume-check')
            documented(target,engine,'worker-resume-install')
            documented(target,engine,'worker-resume-check')
            documented(target,engine,'merge-diff')
            # Optional bot update: absent installation, then four PDH files only.
            documented(target,engine,'bot-update')
            bot=target/'.github/coding-bot';bot.mkdir(parents=True)
            (bot/'_pdh.md').write_text('old shared protocol\n')
            (bot/'system.md').write_text('project-owned bot setup\n')
            (target/'.codex/skills/my-custom-skill').mkdir(parents=True)
            documented(target,engine,'bot-update')
            for name in ('_pdh.md','_github-issue.md','pdh-hooks.sh'):
                assert (bot/name).read_bytes()==(upstream/'github-bot'/name).read_bytes()
            assert (target/'.codex/skills/pdh-gh-pull/SKILL.md').is_file()
            assert (bot/'system.md').read_text()=='project-owned bot setup\n'
            assert (target/'.codex/skills/my-custom-skill').is_dir()
            before=payload(target);documented(target,engine,'bot-update')
            assert payload(target)==before
        skill_dir=target/('.claude/skills' if engine=='claude' else '.agents/skills')
        # Placement is a separate assertion; the installer is never synthesized from it.
        for src,dst,mode in re.findall(r'^\| `tmp/pdh/([^`]+)` \| `([^`]+)` \| [^|]+ \| (上書き|差分マージ|初回だけ) \|$', (ROOT/engine/'INSTALL.md').read_text(), re.M):
            assert (target/dst).exists(), (engine,dst,'documented install omitted placement')
        verify_install(target,engine)
        documented(target,engine,'references-check')
        if engine=='codex':
            role=target/'.codex/agents/pdh-qa.toml';body=role.read_bytes();role.unlink()
            documented(target,engine,'verify-layout',code=1)
            role.write_bytes(body)
        stage_docs(target,code=0)
        # Either active check means adoption, just as in check-pdh-ticket.sh.
        for name in ('docs-metadata','docs-references'):
            active=target/f'scripts/checks/{name}.check'
            shutil.copy2(active.with_suffix('.check.example'),active)
            stage_docs(target,code=1)
            active.unlink()
            stage_docs(target,code=0)
        print(engine+': five stage TOCs and record skip by default, reject plain docs with either adopted check, name offending file')
        assert (target/'scripts/checks/required-pdh-source-files.check').is_file()
        # Actual disappearance must fail the installed registry.
        guard=target/'scripts/pdh-lock.sh';body=guard.read_bytes();guard.unlink()
        assert 'scripts/pdh-lock.sh' in run(target,'bash','scripts/fast-checks.sh',code=1)
        guard.write_bytes(body)
        # Activating examples must reject the same docs that passed by default.
        output=documented(target,engine,'docs-opt-in',code=1)
        assert 'docs/plain.md' in output and 'frontmatter' in output,output
        plain=target/'docs/plain.md';plain_body=plain.read_text()
        plain.write_text('---\nkind: reference\nstatus: active\nread-when: project development\n'
                         'read-at: [PDH-implement]\nstale-when: [{event: before-use}]\n---\n'+plain_body)
        run(target,'bash','scripts/fast-checks.sh')
        documented(target,engine,'docs-opt-in')
        plain.write_text(plain_body)
        for name in ('docs-metadata','docs-references'):
            (target/f'scripts/checks/{name}.check').unlink()
        # Lock checks ignore changes and additions to project-owned agents too.
        for name in custom:
            (target/name).write_text(custom[name]+'project customization\n')
        run(target,'bash','scripts/pdh-lock.sh','check')
        # Verify session resumption can read actual output lines in both layouts.
        for stage in ('ticket-write','open','ticket-review','ticket-human-review','implement','review','verify','human-review','close'):
            out=run(target,'bash','scripts/pdh-stage-checklist.sh','PDH-'+stage)
            assert '- [ ] PDH-'+stage+':' in out
        run(target,'bash','scripts/pdh-lock.sh','write','--upstream',str(upstream),'--map',str(upstream/engine/'lock-map.tsv'))
        original=(target/'.pdh-lock').read_bytes()
        run(target,'bash','scripts/pdh-lock.sh','check')
        run(target,'bash','scripts/pdh-lock.sh','write','--upstream',str(upstream),'--map',str(upstream/engine/'lock-map.tsv'))
        assert original==(target/'.pdh-lock').read_bytes(),'second write changed lock'
        changed=skill_dir/'pdh-resume/SKILL.md'
        content=changed.read_bytes()
        changed.write_bytes(content+b'\ndrift\n')
        run(target,'bash','scripts/pdh-lock.sh','check',code=1)
        run(target,'bash','scripts/pdh-lock.sh','write','--upstream',str(upstream),'--map',str(upstream/engine/'lock-map.tsv'),code=1)
        assert original==(target/'.pdh-lock').read_bytes(),'failed write corrupted existing lock'
        changed.write_bytes(content)
        run(target,'bash','scripts/check-ticket-template-drift.sh','--upstream-file',str(upstream/engine/'templates/.ticket-config.yaml'))
        if engine=='claude':
            # The guide initializes this project-owned setting before generation.
            (target/'.codex/config.toml').write_text('project_doc_max_bytes = 131072\n')
            run(target,'bash','scripts/gen-agents-md.sh')
            run(target,'bash','scripts/gen-agents-md.sh','--check')
            run(target,'bash','scripts/gen-codex-agents.sh')
            run(target,'bash','scripts/gen-codex-agents.sh','--check')
        # Refresh from a real newer local commit and repair an outdated shared script.
        shared=target/'scripts/pdh-related-docs.sh'
        stale=shared.read_bytes()+b'\n# old local copy\n';shared.write_bytes(stale)
        source=upstream/engine/'templates/pdh-related-docs.sh'
        source.write_bytes(source.read_bytes()+b'\n# updated distribution fixture\n')
        run(upstream,'git','add','.')
        run(upstream,'git','-c','commit.gpgsign=false','commit','-qm',f'{engine} update fixture')
        for name in ('AGENTS.md','product-brief.md','.ticket-config.yaml','scripts/test-all.sh'):
            path=target/name;path.write_bytes(path.read_bytes()+b'\n# project customization\n')
        preserved={name:(target/name).read_bytes() for name in ('AGENTS.md','product-brief.md','.ticket-config.yaml','scripts/test-all.sh',*custom)}
        run(target,'git','add','.')
        run(target,'git','-c','commit.gpgsign=false','commit','-qm','before update')
        for iteration in range(2):
            documented(target,engine,'runtime-check')
            documented(target,engine,'refresh')
            output=documented(target,engine,'backup')
            backup=target/next(line.removeprefix('backup: ') for line in output.splitlines() if line.startswith('backup: '))
            assert (backup/'AGENTS.md').read_bytes()==preserved['AGENTS.md']
            assert (backup/'.pdh-lock').is_file()
            assert (backup/'scripts/pdh-related-docs.sh').read_bytes()==(stale if iteration==0 else shared.read_bytes())
            assert (backup/'codex-agents/my-custom-agent.toml').is_file()
            documented(target,engine,'update')
            if engine=='claude':documented(target,engine,'symlinks')
            documented(target,engine,'migration-check')
            verify_install(target,engine)
            run(target,'bash','scripts/fast-checks.sh')
            for name,content in preserved.items():assert (target/name).read_bytes()==content,(engine,name)
            if iteration==0:first=payload(target)
            else:assert first==payload(target),'second documented update changed installed payload'
        # Migration verification must catch hookbus even when rg cannot run.
        rg=bins/'rg';rg.write_text('#!/bin/sh\nexit 127\n');rg.chmod(0o755)
        (target/'package.json').write_text('{"test": "node scripts/hookbus.js"}\n')
        assert 'hookbus' in documented(target,engine,'migration-check',code=1)
        (target/'package.json').write_text('{"name": "project"}\n')
        documented(target,engine,'migration-check')
        (target/'package.json').unlink();rg.unlink()
        # A failed early grep must name every later outstanding item as well.
        config=target/'.ticket-config.yaml';config_body=config.read_text()
        config.write_text(config_body.replace('worktree_mode: true','worktree_mode: false')
                          .replace('Why-not-fix-now:','Old-why-label:'))
        obsolete=skill_dir/'pdh-dev';obsolete.mkdir()
        output=documented(target,engine,'migration-check',code=1)
        for item in ('.ticket-config.yaml worktree_mode: true',
                     '.ticket-config.yaml Why-not-fix-now:',
                     f'旧 skill {skill_dir.relative_to(target)}/pdh-dev の削除',
                     '.ticket-config.yaml の template 本文'):
            assert '要適用: '+item in output,output
        assert '済: .pdh-lock の照合' in output,output
        config.write_text(config_body);obsolete.rmdir()
        output=documented(target,engine,'migration-check')
        assert '要適用:' not in output and '済:' in output,output
        print(engine+': migration-check reports all missing items and returns aggregate status')
        old_names=('pdh-dev','pdh-coding','pdh-reviewing','pdh-verifying','pdh-rule-write')
        for name in old_names:
            (skill_dir/name).mkdir()
            if engine=='claude':
                (target/'.agents/skills'/name).symlink_to('../../.claude/skills/'+name,target_is_directory=True)
        for directory in ('.claude/skills/tmux-director','.agents/skills/tmux-director'):
            (target/directory).mkdir(parents=True)
        (target/'scripts/hookbus.js').write_text('old hookbus\n')
        user_skill=skill_dir/'my-custom-skill';user_skill.mkdir()
        (user_skill/'SKILL.md').write_text('project skill\n')
        for iteration in range(2):
            documented(target,engine,'remove-old-skills')
            for name in old_names:
                assert not (skill_dir/name).exists()
                assert not (target/'.agents/skills'/name).is_symlink()
            assert not (target/'scripts/hookbus.js').exists()
            assert not (target/'.claude/skills/tmux-director').exists()
            assert not (target/'.agents/skills/tmux-director').exists()
            assert (user_skill/'SKILL.md').read_text()=='project skill\n'
            if iteration==0:cleaned=payload(target)
            else:assert payload(target)==cleaned
        if engine=='codex':
            # The cleanup above may create only an empty legacy directory.
            (target/'.claude/skills').rmdir();(target/'.claude').rmdir()
        print(engine+': documented install/update twice, custom agents, plain docs, opt-in rejection, disappearance guard, backup and preservation passed')
        if engine=='codex':
            assert not (target/'.claude').exists(),'native installation depends on legacy Claude files'
            # Legacy skill symlinks must become native dirs without following them.
            legacy=target/'.claude/skills/pdh-resume'
            legacy.parent.mkdir(parents=True)
            shutil.copytree(skill_dir/'pdh-resume',legacy)
            (legacy/'project-notes.md').write_text('legacy project customization\n')
            shutil.rmtree(skill_dir/'pdh-resume')
            (skill_dir/'pdh-resume').symlink_to('../../.claude/skills/pdh-resume',target_is_directory=True)
            legacy_custom={
                'CLAUDE.md':'project legacy rules\n',
                'CLAUDE.local.md':'project local context\n',
                '.claude/settings.json':'{"permissions":{"allow":["Bash(project)"]}}\n',
                '.claude/skills/my-custom-skill/SKILL.md':'project legacy skill\n',
                '.claude/agents/my-custom-agent.md':'project legacy agent\n',
                '.claude/agents/pdh-qa.md':'old PDH role\n',
            }
            for name,body in legacy_custom.items():
                path=target/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(body)
            output=documented(target,engine,'legacy-backup')
            backup=target/next(line.removeprefix('legacy backup: ') for line in output.splitlines() if line.startswith('legacy backup: '))
            assert (backup/'CLAUDE.md').read_text()==legacy_custom['CLAUDE.md']
            assert (backup/'CLAUDE.local.md').read_text()==legacy_custom['CLAUDE.local.md']
            assert (backup/'skills/pdh-resume/project-notes.md').read_text()=='legacy project customization\n'
            assert (backup/'agents/my-custom-agent.md').read_text()==legacy_custom['.claude/agents/my-custom-agent.md']
            agents=target/'AGENTS.md';agents_body=agents.read_bytes()
            documented(target,engine,'legacy-rules')
            assert agents.read_bytes()==agents_body,'legacy rules overwrote existing AGENTS'
            agents.unlink();documented(target,engine,'legacy-rules')
            assert agents.read_text()==legacy_custom['CLAUDE.md']
            agents.unlink();(target/'CLAUDE.md').unlink()
            documented(target,engine,'legacy-rules')
            assert agents.read_bytes()==(upstream/'codex/templates/AGENTS.md').read_bytes()
            agents.write_bytes(agents_body);(target/'CLAUDE.md').write_text(legacy_custom['CLAUDE.md'])
            documented(target,engine,'legacy-local')
            assert (target/'AGENTS.local.md').read_text()==legacy_custom['CLAUDE.local.md']
            (target/'AGENTS.local.md').write_text('existing native local context\n')
            documented(target,engine,'legacy-local')
            assert (target/'AGENTS.local.md').read_text()=='existing native local context\n'
            legacy_files=payload(target/'.claude')
            # Migration step 3 uses the marked native update and verification.
            documented(target,engine,'update')
            documented(target,engine,'migration-check')
            verify_install(target,engine)
            assert not (skill_dir/'pdh-resume').is_symlink(),'legacy skill symlink was not replaced'
            assert payload(target/'.claude')==legacy_files,'native update changed legacy source'
            print('codex: legacy symlink replaced; .claude source customization preserved')
            for iteration in range(2):
                documented(target,engine,'legacy-retire')
                documented(target,engine,'legacy-verify')
                assert not legacy.exists()
                assert not (target/'.claude/agents/pdh-qa.md').exists()
                for name,body in legacy_custom.items():
                    if name=='.claude/agents/pdh-qa.md':continue
                    assert (target/name).read_text()==body,(name,'legacy retirement changed custom file')
                assert (backup/'skills/pdh-resume/project-notes.md').is_file()
                if iteration==0:retired=payload(target)
                else:assert payload(target)==retired
            print('codex: legacy migration 1-4 executed; backup, merge branches, local context and selective retirement passed twice')
            role='pdh-reviewer'
            body=tomllib.loads((target/'.codex/agents'/f'{role}.toml').read_text())['developer_instructions']
            assert '.claude/agents/' not in body
            # Execute the documented parser from the generated PM instructions.
            text=(skill_dir/'pdh-pm/_execution-team.md').read_text()
            parser=next(line for line in text.splitlines() if line.startswith('{ python3 -c '))
            taskfile=target/'task.txt';taskfile.write_text('assigned task\n')
            run(target,'bash','-c','role=pdh-reviewer; taskfile=task.txt; promptfile=prompt.txt; '+parser)
            prompt=(target/'prompt.txt').read_text()
            assert body.strip() in prompt and 'assigned task' in prompt
            run(target,'git','add','.')
            run(target,'git','-c','commit.gpgsign=false','commit','-qm','installed native roles')
            # Evaluation uses the same HEAD-pinned TOML body, never old Markdown.
            text=(target/'scripts/pdh-review-eval.sh').read_text()
            assert '.claude/agents/' not in text
            start=text.index('git show "$definition_head:')
            end=text.index('\n[ -s "$run_dir/reviewer.md" ]',start)
            run(target,'bash','-c','definition_head=HEAD; run_dir=.; '+text[start:end])
            assert (target/'reviewer.md').read_text().strip()==body.strip()
        print(engine+': placement, every stage, lock write/check/drift/atomicity/idempotence, template bodies and native role extraction passed')

    # Every executable block must be marked and reached by a scenario above.
    for engine in ('claude','codex'):
        guide=(ROOT/engine/'INSTALL.md').read_text()
        names=re.findall(r'<!-- pdh-shell: ([\w-]+) -->\n```bash\n',guide)
        assert len(names)==guide.count('```bash\n'),(engine,'unmarked executable block')
        assert len(names)==len(set(names)),(engine,'duplicate marker')
        assert set(names)=={name for seen_engine,name in executed if seen_engine==engine},(engine,'unexecuted blocks',set(names)-{name for e,name in executed if e==engine})
        print(engine+f': all {len(names)} marked INSTALL shell blocks executed')
