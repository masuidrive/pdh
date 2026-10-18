#!/usr/bin/env python3
"""Retain the wording check while allowing the shared contract's exact note term."""
from pathlib import Path
import re
import sys

pattern=re.compile(r'正典|正本|[がのはを]正($|[^し確常規当直義解方式面味誤答体攻す門社の反])')
failed=False
for name in sys.argv[1:]:
    path=Path(name)
    for number,line in enumerate(path.read_text().splitlines(),1):
        if 'checks-allow: authority-phrasing' in line:continue
        # note is the authoritative current-state record in the synchronized
        # contract; keep that upstream term without exempting the whole file.
        if pattern.search(line.replace('note を正とする','note に従う')):
            print(f'{name}:{number}: {line}')
            failed=True
sys.exit(1 if failed else 0)
