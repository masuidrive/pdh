#!/usr/bin/env python3
"""Check update-policy columns and exact overwrite map coverage."""
from pathlib import Path
import re
import sys

root=Path(__file__).resolve().parents[1]
errors=[]
for engine in ('claude','codex'):
    text=(root/engine/'INSTALL.md').read_text()
    rows=[]
    for line in text.splitlines():
        if not line.startswith('| `tmp/pdh/'): continue
        match=re.fullmatch(r'\| `tmp/pdh/([^`]+)` \| `([^`]+)` \| [^|]+ \| (上書き|差分マージ|初回だけ) \|',line)
        if not match:
            errors.append(f'{engine}/INSTALL.md: invalid update policy: {line}')
        else: rows.append(match.groups())
    expected={(src,dst) for src,dst,mode in rows if mode=='上書き'}
    actual=set()
    for line in (root/engine/'lock-map.tsv').read_text().splitlines():
        fields=line.split('\t')
        if len(fields)!=2:errors.append(f'{engine}/lock-map.tsv: invalid TSV');continue
        pair=tuple(fields)
        if pair in actual:errors.append(f'{engine}/lock-map.tsv: duplicate {pair}')
        actual.add(pair)
    for pair in expected^actual:errors.append(f'{engine}: overwrite map mismatch {pair}')
    targets=[]
    for src,dst,mode in rows:
        p=root/src
        if not p.exists():errors.append(f'missing source {src}');continue
        for prior in targets:
            if dst.rstrip('/')==prior.rstrip('/') or dst.startswith(prior.rstrip('/')+'/') or prior.startswith(dst.rstrip('/')+'/'):
                errors.append(f'{engine}: overlapping destinations {prior} / {dst}')
        targets.append(dst)
        files=list(p.rglob('*')) if p.is_dir() else [p]
        if mode=='上書き':
            for file in files:
                if file.is_file() and re.search(rb'(?m)^.*Based on https://github.com/masuidrive/pdh/blob/',file.read_bytes()):
                    errors.append(f'{file.relative_to(root)}: overwritten payload has Based on footer')
        elif p.is_file() and p.name in ('CLAUDE.md','.ticket-config.yaml','product-brief.md','example-max-source-lines.check','example-max-test-lines.check'):
            expected_footer=f'Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/{src}'
            if expected_footer not in p.read_text():errors.append(f'{src}: merged/initial template lacks its ancestry footer')
if errors:sys.exit('\n'.join(errors))
print('placement: both policy columns and exact overwrite maps agree')
