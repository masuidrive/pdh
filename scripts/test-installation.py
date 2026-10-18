#!/usr/bin/env python3
"""Exercise both documented layouts, native role extraction and lock initialization."""
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
    for engine in ('claude','codex'):
        target=temp/engine
        target.mkdir()
        for src,dst,mode in re.findall(r'^\| `tmp/pdh/([^`]+)` \| `([^`]+)` \| [^|]+ \| (上書き|差分マージ|初回だけ) \|$',(ROOT/engine/'INSTALL.md').read_text(),re.M):
            source=upstream/src
            destination=target/dst
            destination.parent.mkdir(parents=True,exist_ok=True)
            if source.is_dir():shutil.copytree(source,destination,dirs_exist_ok=True)
            else:shutil.copy2(source,destination)
        # Project-owned agents must remain outside the distributed file lock.
        for directory, name in (('.codex/agents', 'my-custom-agent.toml'),
                                *((('.claude/agents', 'my-custom-agent.md'),) if engine == 'claude' else ())):
            (target/directory/name).write_text('project-owned agent\n')
        skill_dir=target/('.claude/skills' if engine=='claude' else '.agents/skills')
        run(target,'git','init','-q','-b','main')
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
        if engine=='codex':
            assert not (target/'.claude').exists(),'native installation depends on legacy Claude files'
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
