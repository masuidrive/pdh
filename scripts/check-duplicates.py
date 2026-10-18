#!/usr/bin/env python3
"""Detect newly duplicated rule text; known standalone-role boundaries are explicit."""
from collections import defaultdict
from pathlib import Path
import json
import subprocess
import sys
root=Path(__file__).resolve().parents[1]
allowed={(entry['line'],tuple(entry['files'])) for entry in json.loads((root/'scripts/duplicate-allowlist.json').read_text())}
errors=[]
for engine in ('claude','codex'):
    lines=defaultdict(set)
    names=subprocess.check_output(['git','ls-files','--','docs/*',engine+'/skills/*',engine+'/templates/*'],cwd=root,text=True).splitlines()
    for name in names:
        p=root/name
        # TOML holds the same body generated from the Markdown role definition.
        # Its correctness is checked separately by the generators and body parity.
        if not p.is_file() or p.suffix not in ('.md','.yaml','.toml') or '/templates/agents/codex/' in name: continue
        for line in p.read_text().splitlines():
            line=line.strip()
            if len(line.encode())>=80:lines[line].add(name)
    for line,files in lines.items():
        if len(files)>1 and (line,tuple(sorted(files))) not in allowed:
            errors.append('duplicate: '+' '.join(sorted(files))+'\n  '+line)
if errors:sys.exit('\n'.join(errors))
print('duplicate rules: no unapproved duplicate text')
