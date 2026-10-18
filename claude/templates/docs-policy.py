#!/usr/bin/env python3
"""Validate document metadata, entry points, review records, and print a TOC.

Review includes the working tree when --tip resolves to HEAD. External checks in
stale-when run only through the explicit check-external subcommand.
"""
import argparse
import hashlib
import json
import posixpath
import re
import shlex
import signal
import subprocess
from pathlib import Path
from urllib.parse import unquote

import yaml

STAGES = (
    'PDH-ticket-write', 'PDH-open', 'PDH-ticket-review', 'PDH-ticket-human-review',
    'PDH-implement', 'PDH-review', 'PDH-verify', 'PDH-human-review', 'PDH-close',
)
KINDS = ('reference', 'decision', 'contract', 'roadmap')
STATUSES = ('active', 'proposed', 'superseded', 'retired')
RESOLUTIONS = ('updated', 'unchanged', 'retired', 'not-applicable')
FRONTMATTER = re.compile(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', re.S)
RECORD_BLOCK = re.compile(r'^```yaml\s*\n(.*?)^```\s*$', re.M | re.S)


def git(*args):
    return subprocess.check_output(['git', *args])


def repository_files():
    output = git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    return sorted({Path(p.decode()) for p in output.split(b'\0') if p and Path(p.decode()).is_file()})


def is_document(path):
    path = Path(path)
    return (path.suffix == '.md' and 'results' not in path.parts[1:-1]
            and (path.parts[0] == 'docs' or (path.parts[0] == 'specs' and len(path.parts) == 2)))


def documents(files):
    return [Path(p) for p in files if is_document(p)]


def valid_path(value):
    return (isinstance(value, str) and bool(value.strip()) and not value.startswith('/')
            and '..' not in Path(value).parts and '\\' not in value)


def parse_metadata(text):
    match = FRONTMATTER.match(text)
    if not match:
        raise ValueError('先頭に YAML frontmatter が無い')
    data = yaml.safe_load(match[1])
    if not isinstance(data, dict):
        raise ValueError('frontmatter は mapping にする')
    return data


def metadata(path, snapshot=None):
    text = path.read_text() if snapshot is None else snapshot.read(str(path)).decode()
    data = parse_metadata(text)
    if 'describes' in data:
        raise ValueError('describes: は廃止。stale-when: を選び直す')
    if data.get('kind') not in KINDS or data.get('status') not in STATUSES:
        raise ValueError('kind/status が不正')
    if path.parts[0] == 'specs' and data['kind'] != 'contract':
        raise ValueError('specs/ の kind は contract にする')
    when = data.get('read-when')
    if not isinstance(when, str) or not when.strip() or '\n' in when.strip():
        raise ValueError('read-when: は読む場面を 1 行で書く')
    stages = data.get('read-at')
    if not isinstance(stages, list) or any(s not in STAGES for s in stages):
        raise ValueError('read-at: は PDH-stage 名の一覧にする（空リスト可）')
    stale = data.get('stale-when')
    if not isinstance(stale, list) or not stale:
        raise ValueError('stale-when: は再確認のきっかけを 1 件以上書く')
    for item in stale:
        if not isinstance(item, dict):
            raise ValueError('stale-when: の要素は mapping にする')
        if set(item) == {'path'}:
            if not valid_path(item['path']):
                raise ValueError(f'stale-when: の path が不正: {item["path"]!r}')
            if not any(path_matches(str(p), item['path']) for p in (repository_files() if snapshot is None else snapshot.files)):
                raise ValueError(f'stale-when: の path が実在しない: {item["path"]}')
        elif set(item) == {'event'}:
            if item['event'] not in ('before-use', 'policy-change', 'plan-change'):
                raise ValueError('stale-when: の event が不正')
        elif set(item) == {'check', 'expect'}:
            argv = item['check']
            expect = item['expect']
            if (not isinstance(argv, list) or not argv
                    or any(not isinstance(a, str) or not a.strip() for a in argv)
                    or not isinstance(expect, dict) or set(expect) != {'exit-code'}
                    or type(expect['exit-code']) is not int or not 0 <= expect['exit-code'] <= 255):
                raise ValueError('check: は argv、expect: は exit-code（0〜255）にする')
        else:
            raise ValueError('stale-when: は path / event / check と expect のいずれかにする')
    replacement = data.get('replaced-by')
    if data['status'] == 'superseded':
        if not isinstance(replacement, str) or not valid_path(replacement.split('#')[0]):
            raise ValueError('superseded には replaced-by: が要る')
    elif 'replaced-by' in data:
        raise ValueError('replaced-by: は superseded の文書だけに書く')
    return data


def path_matches(path, pattern):
    # A directory denotes its contents; ** also matches zero directories.
    pattern = pattern.rstrip('/')
    expression = ''
    i = 0
    while i < len(pattern):
        if pattern[i:i + 3] == '**/':
            expression += '(?:.*/)?'
            i += 3
        elif pattern[i:i + 2] == '**':
            expression += '.*'
            i += 2
        elif pattern[i] == '*':
            expression += '[^/]*'
            i += 1
        elif pattern[i] == '?':
            expression += '[^/]'
            i += 1
        elif pattern[i] == '[' and ']' in pattern[i + 1:]:
            end = pattern.index(']', i + 1)
            expression += pattern[i:end + 1]
            i = end + 1
        else:
            expression += re.escape(pattern[i])
            i += 1
    return re.fullmatch(expression + '(?:/.*)?', path) is not None


def headings(text):
    result = []
    fence = None
    offset = FRONTMATTER.match(text)
    for number, line in enumerate(text.splitlines(), 1):
        if offset and number <= text[:offset.end()].count('\n'):
            continue
        marker = re.match(r'^\s{0,3}(`{3,}|~{3,})', line)
        if marker:
            token = marker[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        match = re.match(r'^(#{1,6})\s+(.+?)\s*#*$', line)
        if fence is None and match:
            result.append((number, len(match[1]), match[2]))
    return result


def anchors(text):
    seen = {}
    result = set(re.findall(r'<a\s+(?:id|name)=["\']([^"\']+)', text))
    for _, _, title in headings(text):
        slug = re.sub(r'[^\w\-\s]', '', title.lower()).replace(' ', '-')
        count = seen.get(slug, 0)
        seen[slug] = count + 1
        result.add(f'{slug}-{count}' if count else slug)
    return result


def check_target(target, snapshot=None):
    path, _, anchor = target.partition('#')
    if not valid_path(path):
        raise ValueError(f'参照先が実在しない: {target}')
    content = snapshot.read(path) if snapshot is not None else (Path(path).read_bytes() if Path(path).is_file() else None)
    if content is None:
        raise ValueError(f'参照先が実在しない: {target}')
    if anchor and unquote(anchor) not in anchors(content.decode()):
        raise ValueError(f'参照先の anchor が実在しない: {target}')
    return path


def check_metadata(docs):
    errors = []
    data = {}
    for doc in docs:
        try:
            data[str(doc)] = metadata(doc)
        except (ValueError, yaml.YAMLError) as error:
            errors.append(f'{doc}: {error}')
    for name, entry in data.items():
        try:
            visited = {name}
            while entry['status'] == 'superseded':
                target = check_target(entry['replaced-by'])
                if target in visited:
                    raise ValueError('replaced-by: が循環している')
                visited.add(target)
                entry = data.get(target) or metadata(Path(target))
            if len(visited) > 1 and entry['status'] != 'active':
                raise ValueError('replaced-by: の後継は active の文書へ繋ぐ')
        except (ValueError, yaml.YAMLError) as error:
            errors.append(f'{name}: {error}')
    return errors


def reference_targets(source, text, candidates):
    targets = set()
    for target in re.findall(r'\[[^\]]*\]\(<?([^\s)>]+)>?\)', text):
        target = unquote(target.split('#')[0])
        if not target or ':' in target:
            continue
        resolved = posixpath.normpath(posixpath.join(str(source.parent), target))
        if resolved in candidates:
            targets.add(resolved)
    for target in candidates:
        if re.search(r'(?<![\w/.-])' + re.escape(target) + r'(?![\w/.-])', text):
            targets.add(target)
    targets.discard(str(source))
    return targets


def check_references(docs, files):
    sources = [p for p in files if p.name in ('CLAUDE.md', 'PDH-AGENTS.md', 'product-brief.md')
               or (p.parts[:2] in (('.claude', 'skills'), ('.claude', 'agents'), ('.agents', 'skills'))
                   and p.suffix == '.md'
                   and not set(p.parts).intersection(('test', 'tests', 'fixture', 'fixtures', 'results')))]
    candidates = {str(p) for p in docs + sources}
    edges = {str(p): reference_targets(p, p.read_text(), candidates) for p in docs + sources}
    reached = {str(p) for p in sources}
    errors = []
    for doc in docs:
        try:
            if metadata(doc)['read-at']:
                reached.add(str(doc))
        except (ValueError, yaml.YAMLError) as error:
            errors.append(f'{doc}: {error}')
    pending = list(reached)
    while pending:
        for target in edges.get(pending.pop(), set()) - reached:
            reached.add(target)
            pending.append(target)
    for doc in docs:
        if str(doc) not in reached:
            errors.append(f'{doc}: 読む入口が無い。read-at か到達できる文書・skill からのリンクを置く')
    return errors


class Snapshot:
    def __init__(self, ref=None):
        self.ref = ref
        if ref is None:
            self.files = {str(p): None for p in repository_files()}
        else:
            self.files = {}
            for row in git('ls-tree', '-rz', '--full-tree', ref).split(b'\0'):
                if row:
                    details, path = row.split(b'\t', 1)
                    self.files[path.decode()] = details.split()[2].decode()

    def read(self, path):
        if path not in self.files:
            return None
        return Path(path).read_bytes() if self.ref is None else git('cat-file', 'blob', self.files[path])


def digest(value):
    return hashlib.sha256(b'missing' if value is None else b'present\0' + value).hexdigest()


def patterns(snapshot, doc):
    content = snapshot.read(doc)
    if content is None:
        return []
    try:
        data = parse_metadata(content.decode())
    except (ValueError, yaml.YAMLError):
        return []
    # The base can still use legacy metadata during migration; the tip cannot.
    return [i['path'] for i in data.get('stale-when', []) if isinstance(i, dict) and 'path' in i] + data.get('describes', [])


def review_context(base, tip):
    start = git('merge-base', base, tip).decode().strip()
    old = Snapshot(start)
    current = Snapshot(None if git('rev-parse', tip) == git('rev-parse', 'HEAD') else tip)
    changed = set(git('diff', '--name-only', '--no-renames', '-z', start, tip).decode().split('\0')) - {''}
    if current.ref is None:
        changed.update(git('diff', '--name-only', '--no-renames', '-z', tip).decode().split('\0'))
        changed.update(git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'))
        changed.discard('')
    return old, current, changed


def review_hashes(doc, old, current, changed):
    watched = sorted(set(patterns(old, doc) + patterns(current, doc)))
    selected = sorted(p for p in changed
                      if any(path_matches(p, pattern) for pattern in watched))
    inputs = [(p, digest(current.read(p))) for p in selected]
    return digest(current.read(doc)), digest(json.dumps([watched, inputs], ensure_ascii=False).encode())


def load_records(path):
    records = []
    ids = set()
    if not path.exists():
        return records
    for block in RECORD_BLOCK.findall(path.read_text()):
        record = yaml.safe_load(block)
        if not isinstance(record, dict) or 'document' not in record:
            continue
        required = ('id', 'document', 'document-hash', 'inputs-hash', 'trigger', 'resolution')
        if any(not isinstance(record.get(k), str) or not record[k].strip() for k in required):
            raise ValueError('照合記録に id/document/document-hash/inputs-hash/trigger/resolution が要る')
        if record['id'] in ids:
            raise ValueError(f'照合記録の id が重複: {record["id"]}')
        ids.add(record['id'])
        if record['resolution'] not in RESOLUTIONS:
            raise ValueError('照合記録の resolution が不正')
        if record['resolution'] in ('unchanged', 'not-applicable') and (not isinstance(record.get('reason'), str) or not record['reason'].strip()):
            raise ValueError('unchanged/not-applicable には reason が要る')
        records.append(record)
    return records


def check_review(docs, note, base, tip):
    old, current, changed = review_context(base, tip)
    try:
        records = load_records(note.with_name('related-docs.md'))
    except (ValueError, yaml.YAMLError) as error:
        return [str(error)]
    errors = []
    for doc in sorted(set(str(p) for p in documents(old.files)) | {str(p) for p in documents(current.files)}):
        watched = patterns(old, doc) + patterns(current, doc)
        if doc not in changed and not any(path_matches(p, pat) for p in changed for pat in watched):
            continue
        expected = review_hashes(doc, old, current, changed)
        matches = [r for r in records if r['document'].split('#')[0] == doc
                   and (r['document-hash'], r['inputs-hash']) == expected]
        valid = False
        for record in matches:
            if record['resolution'] == 'updated' and old.read(doc) == current.read(doc):
                continue
            if current.read(doc) is None:
                valid |= record['resolution'] == 'retired'
            else:
                try:
                    text = current.read(doc).decode()
                    anchor = unquote(record['document'].partition('#')[2])
                    if anchor and anchor not in anchors(text):
                        continue
                    entry = parse_metadata(text)
                    valid |= record['resolution'] != 'retired' or entry.get('status') in ('retired', 'superseded')
                except (ValueError, yaml.YAMLError):
                    pass
        if not valid:
            errors.append(f'{doc}: related-docs.md に現在の document-hash/inputs-hash と一致する照合記録が無い')
    return errors


def record_review(args):
    doc = args.files[0].split('#')[0]
    if not valid_path(doc) or not is_document(doc):
        raise ValueError('record の対象は docs/ または specs/ の文書にする')
    if args.resolution in ('unchanged', 'not-applicable') and not args.reason.strip():
        raise ValueError('unchanged/not-applicable には --reason が要る')
    old, current, changed = review_context(args.base, args.tip)
    if args.resolution == 'updated' and old.read(doc) == current.read(doc):
        raise ValueError('updated は base..tip で文書の本文が変わった場合だけ記録する')
    if current.read(doc) is None:
        if old.read(doc) is None or args.resolution != 'retired':
            raise ValueError('削除文書は base に存在する文書を retired として記録する')
    else:
        check_target(args.files[0], current)
        metadata(Path(doc), current)
    output = args.output or (args.note.with_name('related-docs.md') if args.note else None)
    if output is None:
        raise ValueError('record には --note <note.md> または --output <related-docs.md> が要る')
    records = load_records(output)
    document_hash, inputs_hash = review_hashes(doc, old, current, changed)
    record_number = len(records) + 1
    while f'C{record_number}' in {r['id'] for r in records}:
        record_number += 1
    entry = {'id': f'C{record_number}', 'document': args.files[0], 'document-hash': document_hash,
             'inputs-hash': inputs_hash, 'trigger': args.trigger, 'resolution': args.resolution}
    if args.reason:
        entry['reason'] = args.reason
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('a') as stream:
        stream.write('\n```yaml\n' + yaml.safe_dump(entry, allow_unicode=True, sort_keys=False) + '```\n')
    print(f'{output}: {entry["id"]} {args.files[0]} ({args.resolution})')


def check_external(path, timeout):
    entry = metadata(path)
    checks = [item for item in entry['stale-when'] if 'check' in item]
    if not checks:
        print(f'{path}: 取得不能: check が無い')
        return 2
    result = 0
    for number, item in enumerate(checks, 1):
        expected = item['expect']['exit-code']
        try:
            completed = subprocess.run(item['check'], stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       timeout=timeout, check=False)
            if completed.returncode < 0:
                status, code, detail = '取得不能', 2, f'signal={-completed.returncode}'
            elif completed.returncode == expected:
                status, code, detail = '一致', 0, f'exit-code={completed.returncode}'
            else:
                status, code, detail = '不一致', 1, f'exit-code={completed.returncode}, expect={expected}'
        except subprocess.TimeoutExpired:
            status, code, detail = '取得不能', 2, f'timeout={timeout:g}s'
        except OSError as error:
            status, code, detail = '取得不能', 2, str(error)
        print(f'{path} check {number}: {status} ({detail})')
        result = max(result, code)
    return result


def print_toc(args):
    dirs = args.files or ['docs', 'specs']
    paths = sorted({p for directory in dirs for p in Path(directory).rglob('*.md')})
    for path in paths:
        result = 'results' in path.parts[1:-1]
        if result:
            if args.all and not args.stage:
                print(f'{path} [measurement/result]')
            continue
        try:
            entry = metadata(path)
        except (ValueError, yaml.YAMLError) as error:
            raise ValueError(f'{path}: {error}') from error
        if not args.all and entry['status'] in ('superseded', 'retired'):
            continue
        if args.stage and args.stage not in entry['read-at']:
            continue
        print(f'{path} [{entry["kind"]}/{entry["status"]}]')
        print(f'  read-when: {entry["read-when"]}')
        print('  stale-when: ' + '; '.join(json.dumps(i, ensure_ascii=False, sort_keys=True) for i in entry['stale-when']))
        if any('check' in item for item in entry['stale-when']):
            print('  check: ' + shlex.join(['python3', 'scripts/docs-policy.py', 'check-external', str(path)]))
        text = path.read_text()
        sections = headings(text)
        for index, (line, depth, title) in enumerate(sections):
            if depth not in (2, 3):
                continue
            end = next((n - 1 for n, level, _ in sections[index + 1:] if level <= depth), len(text.splitlines()))
            print(f'  L{line} ({end - line + 1} lines) {"#" * depth} {title}')
        print()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('metadata', 'references', 'review', 'record', 'toc', 'check-external'))
    parser.add_argument('--note', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--base')
    parser.add_argument('--tip', default='HEAD')
    parser.add_argument('--resolution', choices=RESOLUTIONS)
    parser.add_argument('--reason', default='')
    parser.add_argument('--trigger', default='path-change')
    parser.add_argument('--stage', choices=STAGES)
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--timeout', type=float, default=30, help='check-external: seconds per check (0 < timeout <= 60; default 30)')
    parser.add_argument('files', nargs='*')
    args = parser.parse_intermixed_args()
    if args.mode in ('toc', 'record') and not any(
            Path(f'scripts/checks/{name}.check').is_file()
            for name in ('docs-metadata', 'docs-references')):
        if args.mode == 'toc':
            print('docs-policy: 文書の frontmatter 検査は採用していないので目次は出さない。'
                  'docs/ と specs/ から、この stage に関係する文書を自分で探して読む')
        else:
            print('docs-policy: 文書の frontmatter 検査は採用していないため省略')
        return 0
    try:
        if args.mode == 'check-external':
            if len(args.files) != 1 or not 0 < args.timeout <= 60:
                parser.error('check-external requires <doc> and 0 < --timeout <= 60')
            return check_external(Path(args.files[0]), args.timeout)
        if args.mode == 'toc':
            print_toc(args)
            return 0
        if args.mode == 'record':
            if len(args.files) != 1 or not args.resolution or not args.base:
                parser.error('record requires <doc>, --resolution and --base (same as the close review)')
            record_review(args)
            return 0
        files = repository_files()
        docs = documents(files)
        if args.mode == 'metadata':
            errors = check_metadata(docs)
        elif args.mode == 'references':
            errors = check_references(docs, files)
        else:
            if not args.note or not args.base:
                parser.error('review requires --note and --base')
            errors = check_review(docs, args.note, args.base, args.tip)
    except (ValueError, yaml.YAMLError, OSError, subprocess.CalledProcessError) as error:
        if args.mode == 'check-external':
            print(f'{args.files[0]}: 取得不能: {error}')
            return 2
        errors = [f'{args.files[0]}: {error}' if args.mode == 'record' else str(error)]
    for error in errors:
        print(f'docs-policy: {error}')
    return bool(errors)


if __name__ == '__main__':
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    raise SystemExit(main())
