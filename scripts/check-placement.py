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
# github-bot の上書き分は、導入時だけ lock する layer map に置く。
bot=(root/'github-bot/INSTALL.md').read_text()
owned=re.search(r'PDH 保守分（([^）]+)）',bot)
names=re.findall(r'`([^`]+)`',owned.group(1)) if owned else []
if not names:errors.append('github-bot/INSTALL.md: PDH 保守分の一覧が見つからない')
bot_rows={}
for line in bot.splitlines():
    match=re.match(r'\| `github-bot/([^`]+)` \| `([^`]+)`(?:（Codex は `([^`]+)`）)? \|',line)
    if match:bot_rows[match.group(1)]=match.groups()[1:]
for engine in ('claude','codex'):
    layer=root/engine/'lock-map.github-bot.tsv'
    lines=layer.read_text().splitlines()
    marker='# installed-by: .github/workflows/coding-bot.yml'
    if not lines or lines[0]!=marker:errors.append(f'{engine}/lock-map.github-bot.tsv: first line must be {marker}')
    if not (root/'github-bot/.github/workflows/coding-bot.yml').is_file():errors.append('github-bot/.github/workflows/coding-bot.yml: missing installed-by source')
    actual=set()
    for line in lines[1:]:
        fields=line.split('\t')
        if len(fields)!=2:errors.append(f'{engine}/lock-map.github-bot.tsv: invalid TSV');continue
        actual.add(tuple(fields))
    expected=set()
    for name in names:
        if name not in bot_rows:errors.append(f'github-bot/INSTALL.md: no placement row for {name}');continue
        dst,codex_dst=bot_rows[name]
        expected.add((f'github-bot/{name}',codex_dst if engine=='codex' and codex_dst else dst))
    for pair in expected^actual:errors.append(f'{engine}: github-bot layer map mismatch {pair}')
if errors:sys.exit('\n'.join(errors))
print('placement: both policy columns, exact overwrite maps and github-bot layer maps agree')
