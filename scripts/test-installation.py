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
    return run(target,'bash','-euo','pipefail','-c',script,code=code)


def payload(target):
    return {str(p.relative_to(target)): (os.readlink(p) if p.is_symlink() else p.read_bytes())
            for p in target.rglob('*') if (p.is_file() or p.is_symlink())
            and p.relative_to(target).parts[0] not in ('.git','tmp')}


with tempfile.TemporaryDirectory(prefix='pdh-install-') as temporary:
    temp=Path(temporary)
    upstream=temp/'upstream'
    upstream.mkdir()
    # Snapshot only distributed payload; write requires a committed upstream.
    for engine in ('claude','codex','docs'):
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
        documented(target,engine,'prepare')
        documented(target,engine,'install')
        if engine=='claude':
            documented(target,engine,'symlinks')
            documented(target,engine,'config')
        else:documented(target,engine,'ancestry')
        skill_dir=target/('.claude/skills' if engine=='claude' else '.agents/skills')
        # Placement is a separate assertion; the installer is never synthesized from it.
        for src,dst,mode in re.findall(r'^\| `tmp/pdh/([^`]+)` \| `([^`]+)` \| [^|]+ \| (上書き|差分マージ|初回だけ) \|$', (ROOT/engine/'INSTALL.md').read_text(), re.M):
            assert (target/dst).exists(), (engine,dst,'documented install omitted placement')
        documented(target,engine,'verify')
        assert (target/'scripts/checks/required-pdh-source-files.check').is_file()
        # Actual disappearance must fail the installed registry.
        guard=target/'scripts/pdh-lock.sh';body=guard.read_bytes();guard.unlink()
        assert 'scripts/pdh-lock.sh' in run(target,'bash','scripts/fast-checks.sh',code=1)
        guard.write_bytes(body)
        # Activating examples must reject the same docs that passed by default.
        for name in ('docs-metadata','docs-references'):
            shutil.copy2(target/f'scripts/checks/{name}.check.example',target/f'scripts/checks/{name}.check')
        output=run(target,'bash','scripts/fast-checks.sh',code=1)
        assert 'docs/plain.md' in output and 'frontmatter' in output,output
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
            documented(target,engine,'verify')
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
            legacy_files=payload(target/'.claude')
            documented(target,engine,'update')
            documented(target,engine,'verify')
            assert not (skill_dir/'pdh-resume').is_symlink(),'legacy skill symlink was not replaced'
            assert payload(target/'.claude')==legacy_files,'native update changed legacy source'
            print('codex: legacy symlink replaced; .claude source customization preserved')
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
