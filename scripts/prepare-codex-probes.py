#!/usr/bin/env python3
"""Freeze public PDH instructions and synthetic tasks for prompt-only evaluation."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SOURCES = (
    'docs/PDH-AGENTS.md', 'skills/pdh-dev/_flow.md', 'skills/pdh-dev/_review.md',
    'skills/pdh-coding/SKILL.md', 'skills/pdh-verifying/SKILL.md',
    'skills/pdh-decision-board/base.md', 'skills/pdh-decision-board/ticket-gate.md',
    'skills/pdh-decision-board/close-gate.md', 'skills/pdh-decision-board/final-check.md',
)
HEADER = ('あなたは PDH の進行担当です。以下の PDH 指示を適用し、その後の各状況について次の行動を判断してください。'
          'これは文章だけで判断する課題です。ツールは使わず、実装や試験を実施したとは書かないでください。'
          '各状況は独立です。ケース ID ごとに「次の行動」「ユーザーへの確認が必要かと確認対象」「根拠」を短く答えてください。\n\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', default='working-tree')
    parser.add_argument('--kind', choices=('decisions', 'evidence'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists; use a new snapshot directory')
    parts, manifest = [], []
    for source in SOURCES:
        data = ((ROOT/source).read_bytes() if args.revision == 'working-tree' else
                subprocess.check_output(['git', 'show', args.revision+':'+source], cwd=ROOT))
        parts.append('### Source: '+source+'\n'+data.decode('utf-8'))
        manifest.append({'path': source, 'sha256': hashlib.sha256(data).hexdigest()})
    tasks_path = ROOT/'evals/codex-tuning'/('decision-probes.json' if args.kind == 'decisions' else 'evidence-probes.json')
    tasks = tasks_path.read_bytes()
    prompt = (HEADER+'## PDH 指示\n'+'\n'.join(parts)+'\n## 判断する状況\n'+
              json.dumps(json.loads(tasks), ensure_ascii=False, indent=2)).encode()
    args.output.mkdir(parents=True)
    (args.output/'prompt.md').write_bytes(prompt)
    (args.output/'manifest.json').write_text(json.dumps({
        'revision': args.revision, 'kind': args.kind, 'sources': manifest,
        'tasks_sha256': hashlib.sha256(tasks).hexdigest(),
        'prompt_sha256': hashlib.sha256(prompt).hexdigest(), 'prompt_bytes': len(prompt),
        'scope': 'prompt interpretation; no tools or private benchmark source; no answer key in prompt',
    }, ensure_ascii=False, indent=2)+'\n')
    print(args.output/'prompt.md')

if __name__ == '__main__':
    main()
