import os
"""Documents must remain reachable and reviewed against their current inputs."""
from pathlib import Path
import json
import sys

import yaml
import subprocess
import tempfile
import unittest

ROOT = Path(os.environ['PDH_TEST_ROOT'])
POLICY = ROOT / 'scripts/docs-policy.py'


def document(*, kind='reference', status='active', stages='[PDH-implement]',
             stale='[{path: "src/**/*.py"}]', extra='', body='## Scope\nContract.\n'):
    return (f'---\nkind: {kind}\nstatus: {status}\nread-when: editing sources\n'
            f'read-at: {stages}\nstale-when: {stale}\n{extra}---\n# Guide\n{body}')


class DocsPolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.com')
        self.git('config', 'user.name', 'Test')
        self.write('src/a.py', 'old\n')
        self.write('docs/guide.md', document())
        self.write('tickets/work/note.md', '## Checklist\n')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def check(self, mode, *args, expected=0):
        result = subprocess.run(['python3', str(POLICY), mode, *args],
                                cwd=self.root, text=True, capture_output=True)
        self.assertEqual(expected, result.returncode, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def review(self, expected=0, tip='HEAD'):
        return self.check('review', '--note', 'tickets/work/note.md', '--base', self.base,
                          '--tip', tip, expected=expected)

    def record(self, doc='docs/guide.md', resolution='unchanged', reason='Only implementation changed.', expected=0, tip='HEAD'):
        return self.check('record', doc, '--base', self.base, '--note', 'tickets/work/note.md',
                          '--resolution', resolution, '--reason', reason, '--tip', tip, expected=expected)

    def test_metadata_includes_specs_and_excludes_measurement_results(self):
        self.write('specs/api.md', document(kind='contract'))
        self.write('docs/group/results/run.md', '# Generated measurement\n')
        self.write('docs/openapi.yaml', 'generated')
        self.check('metadata')
        self.write('specs/api.md', document())
        self.assertIn('contract', self.check('metadata', expected=1))

    def test_metadata_rejects_legacy_and_fake_generated_escape(self):
        for content in ('---\ndescribes: [src/a.py]\nread-when: editing\n---\n',
                        '<!-- generated -->\n# Missing metadata\n'):
            with self.subTest(content=content):
                self.write('docs/guide.md', content)
                self.check('metadata', expected=1)
        self.write('docs/guide.md', document())
        self.write('docs/generated/handwritten.md', '<!-- generated -->\n# Guide\n')
        self.check('metadata', expected=1)

    def test_metadata_types_paths_and_check_expect(self):
        variants = [dict(kind='unknown'), dict(status='draft'), dict(stages='PDH-review'),
                    dict(stages='[pdh-resume]'), dict(stale='[]'), dict(stale='[oops]'),
                    dict(stale='[{path: absent}]'), dict(stale='[{path: ../outside}]'),
                    dict(stale='[{path: /tmp}]'), dict(stale='[{event: sometimes}]'),
                    dict(stale='[{check: [echo]}]'),
                    dict(stale='[{check: echo, expect: {exit-code: 0}}]'),
                    dict(stale='[{check: [echo], expect: {exit-code: true}}]')]
        for variant in variants:
            with self.subTest(variant=variant):
                self.write('docs/guide.md', document(**variant))
                self.check('metadata', expected=1)
        self.write('docs/guide.md', document(stages='[]', stale='[{event: before-use}, {check: ["false"], expect: {exit-code: 0}}]'))
        self.check('metadata')

    def external_doc(self, checks):
        self.write('docs/guide.md', document(stale=yaml.safe_dump(checks, default_flow_style=True).strip()))

    def test_external_check_preserves_argv_and_accepts_expected_nonzero_exit(self):
        argument = '$(touch injected); spaces and *'
        command = [sys.executable, '-c',
                   'import json, pathlib, sys; pathlib.Path("argv.json").write_text(json.dumps(sys.argv[1:]))', argument]
        self.external_doc([{'check': command, 'expect': {'exit-code': 0}},
                           {'check': [sys.executable, '-c', 'raise SystemExit(7)'], 'expect': {'exit-code': 7}}])
        output = self.check('check-external', 'docs/guide.md')
        self.assertEqual(output.count(': 一致'), 2)
        self.assertEqual(json.loads((self.root / 'argv.json').read_text()), [argument])
        self.assertFalse((self.root / 'injected').exists())

    def test_external_check_distinguishes_mismatch_missing_timeout_and_signal(self):
        for command, expected, status, options in (
            ([sys.executable, '-c', 'raise SystemExit(7)'], 1, '不一致', []),
            (['missing-external-query'], 2, '取得不能', []),
            ([sys.executable, '-c', 'import time; time.sleep(10)'], 2, '取得不能', ['--timeout', '0.05']),
            ([sys.executable, '-c', 'import os, signal; os.kill(os.getpid(), signal.SIGTERM)'], 2, '取得不能', []),
        ):
            with self.subTest(command=command):
                self.external_doc([{'check': command, 'expect': {'exit-code': 0}}])
                self.assertIn(status, self.check('check-external', 'docs/guide.md', *options, expected=expected))
        self.external_doc([{'event': 'before-use'}])
        self.assertIn('check が無い', self.check('check-external', 'docs/guide.md', expected=2))

    def test_external_check_reports_unavailable_document_or_frontmatter(self):
        for content in (None, '# No frontmatter\n', '---\nkind: [\n---\n',
                        '---\n[]\n---\n', document(stale='[{check: echo}]')):
            with self.subTest(content=content):
                if content is None:
                    (self.root / 'docs/guide.md').unlink()
                else:
                    self.write('docs/guide.md', content)
                    self.check('metadata', expected=1)
                output = self.check('check-external', 'docs/guide.md', expected=2)
                self.assertIn('docs/guide.md: 取得不能:', output)

    def test_external_checks_do_not_run_during_metadata_references_toc_or_review(self):
        marker = self.root / 'executed'
        command = [sys.executable, '-c', 'from pathlib import Path; Path("executed").touch()']
        self.external_doc([{'path': 'src/a.py'}, {'check': command, 'expect': {'exit-code': 0}}])
        self.write('src/a.py', 'changed\n')
        self.record(resolution='updated')
        for mode in ('metadata', 'references', 'toc'):
            self.check(mode)
        self.review()
        self.assertFalse(marker.exists())
        for timeout in ('0', '-1', 'nan', 'inf', '61'):
            self.check('check-external', 'docs/guide.md', '--timeout', timeout, expected=2)
        self.assertFalse(marker.exists())

    def test_doc_typo_does_not_exempt_review(self):
        self.write('src/a.py', 'new\n')
        self.write('docs/guide.md', document(body='## Scope\nContraxt.\n'))
        self.review(1)
        self.record(resolution='updated')
        self.review()

    def test_checkboxes_and_skip_are_not_review_records(self):
        self.write('src/a.py', 'new\n')
        for row in ('- [x] docs/guide.md copied', '- [x] docs/guide.md checked',
                    '- [-] docs/guide.md - skip: unrelated'):
            with self.subTest(row=row):
                self.write('tickets/work/note.md', '## Checklist\n' + row + '\n')
                self.review(1)
        self.record(reason='', expected=1)
        self.record(reason='No public contract changed.')
        self.review()

    def test_source_or_document_change_invalidates_hash_but_note_does_not(self):
        self.write('src/a.py', 'new\n')
        self.record()
        self.review()
        self.write('tickets/work/note.md', '## Checklist\n- [x] unrelated\n')
        self.review()
        for path, content in [('src/a.py', 'newer\n'), ('docs/guide.md', document(body='## Scope\nRevised.\n'))]:
            self.write(path, content)
            self.review(1)
            self.record()
            self.review()

    def test_unrelated_main_merge_preserves_record_but_ticket_input_change_invalidates(self):
        self.write('src/other.py', 'other old\n')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.git('branch', 'upstream-main')
        branch = self.git('branch', '--show-current').strip()
        self.write('src/a.py', 'ticket\n')
        self.record()
        self.commit()
        self.git('checkout', '-q', 'upstream-main')
        self.write('src/other.py', 'other new\n')
        self.commit()
        self.git('checkout', '-q', branch)
        self.git('merge', '-qm', 'merge main', 'upstream-main')
        self.base = 'upstream-main'
        self.review()
        self.write('src/a.py', 'ticket after review\n')
        self.review(1)

    def test_source_deletion_rename_and_untracked_addition_are_watched(self):
        for action in ('delete', 'rename', 'add'):
            with self.subTest(action=action):
                if action == 'delete':
                    (self.root / 'src/a.py').unlink()
                    self.write('src/b.py', 'old\n')
                elif action == 'rename':
                    self.git('mv', 'src/b.py', 'src/c.py')
                else:
                    self.write('src/new.py', 'new')
                self.review(1)
                self.record()
                self.review()
                if action == 'delete':
                    self.write('src/b.py', 'old\n')
                    self.commit()

    def test_deleted_document_requires_retired_record(self):
        (self.root / 'docs/guide.md').unlink()
        self.write('src/a.py', 'new\n')
        self.review(1)
        self.record(expected=1)
        self.record(resolution='retired')
        self.review()

    def test_document_rename_and_removed_watch_condition_use_base_metadata(self):
        self.git('mv', 'docs/guide.md', 'docs/renamed.md')
        self.write('docs/renamed.md', document(stale='[{event: policy-change}]'))
        self.write('src/a.py', 'new\n')
        self.review(1)
        self.record(resolution='retired')
        self.review(1)
        self.record(doc='docs/renamed.md', resolution='updated')
        self.review()
        self.git('mv', 'docs/renamed.md', 'docs/guide.md')
        self.record(resolution='unchanged')
        self.review()
        self.write('src/a.py', 'after-check\n')
        self.review(1)

    def test_legacy_base_is_included_in_migration_review(self):
        self.write('docs/guide.md', '---\ndescribes: [src/a.py]\nread-when: editing\n---\n')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.write('docs/guide.md', document(stale='[{event: policy-change}]'))
        self.write('src/a.py', 'new\n')
        self.review(1)
        self.record(resolution='updated')
        self.review()
        self.write('src/a.py', 'newer\n')
        self.review(1)

    def test_explicit_tip_is_not_replaced_by_working_tree(self):
        self.write('src/a.py', 'tip\n')
        self.record()
        self.commit()
        tip = self.git('rev-parse', 'HEAD').strip()
        self.write('src/a.py', 'later\n')
        self.commit()
        self.review(1)
        self.review(tip=tip)

    def test_explicit_tip_uses_its_document_and_anchors_after_worktree_deletion(self):
        self.write('src/a.py', 'tip\n')
        self.record(doc='docs/guide.md#scope')
        self.commit()
        tip = self.git('rev-parse', 'HEAD').strip()
        (self.root / 'docs/guide.md').unlink()
        self.commit()
        self.review(1)
        self.review(tip=tip)

    def test_record_reads_explicit_tip_document_metadata_paths_and_anchor(self):
        self.write('src/a.py', 'tip\n')
        self.commit()
        tip = self.git('rev-parse', 'HEAD').strip()
        for content in (document(body='## Later\n'), '# broken metadata\n', None):
            with self.subTest(content=content):
                if content is None:
                    (self.root / 'docs/guide.md').unlink()
                else:
                    self.write('docs/guide.md', content)
                self.commit()
                self.record(doc='docs/guide.md#scope', tip=tip)
                self.record(doc='docs/guide.md#later', tip=tip, expected=1)
                self.review(tip=tip)
        (self.root / 'src/a.py').unlink()
        self.commit()
        self.record(tip=tip)
        self.review(tip=tip)

    def test_record_rejects_invalid_tip_metadata_even_when_worktree_is_valid(self):
        self.write('docs/guide.md', document(kind='wrong'))
        self.commit()
        tip = self.git('rev-parse', 'HEAD').strip()
        self.write('docs/guide.md', document())
        self.commit()
        self.record(tip=tip, expected=1)

    def test_updated_requires_document_diff_in_record_and_review(self):
        self.write('src/a.py', 'source only\n')
        self.record(resolution='updated', expected=1)
        self.record()
        records = self.root / 'tickets/work/related-docs.md'
        records.write_text(records.read_text().replace('resolution: unchanged', 'resolution: updated'))
        self.review(1)
        self.write('docs/guide.md', document(body='## Scope\nUpdated contract.\n'))
        self.record(resolution='updated')
        self.review()

    def test_invalid_resolution_reason_and_duplicate_id_do_not_pass(self):
        self.write('src/a.py', 'new\n')
        self.record()
        path = self.root / 'tickets/work/related-docs.md'
        text = path.read_text()
        for bad in (text.replace('resolution: unchanged', 'resolution: pending'),
                    text.replace('reason: Only implementation changed.', 'reason: ""'), text + text):
            path.write_text(bad)
            self.review(1)
        path.write_text(text)
        self.review()

    def test_record_id_does_not_collide_with_custom_ids(self):
        self.write('src/a.py', 'new\n')
        self.record()
        path = self.root / 'tickets/work/related-docs.md'
        path.write_text(path.read_text().replace('id: C1', 'id: C2'))
        self.record()
        self.review()
        self.assertIn('id: C3', path.read_text())

    def test_references_follow_entry_points_and_document_links(self):
        self.write('docs/guide.md', document(stages='[]'))
        self.check('references', expected=1)
        self.write('CLAUDE.md', '[skill](.claude/skills/example/SKILL.md)\n')
        self.write('.claude/skills/example/SKILL.md', '`docs/future-list.md`\n')
        self.write('docs/future-list.md', document(kind='roadmap', stages='[]',
                   body='[Guide](guide.md#scope)\n'))
        self.check('references')

    def test_self_links_histories_fixtures_and_unreachable_cycles_are_not_entries(self):
        self.write('docs/guide.md', document(stages='[]', body='[self](guide.md)\n[other](other.md)\n'))
        self.write('docs/other.md', document(stages='[]', body='[guide](guide.md)\n'))
        for name in ('AGENTS.md', 'tickets/work/note.md', 'tests/fixtures/guide.md',
                     'docs/group/results/run.md', 'scripts/check.sh',
                     '.claude/skills/example/tests/fixture.md', '.claude/agents/fixtures/case.md'):
            self.write(name, 'docs/guide.md\n')
        self.check('references', expected=1)
        self.write('CLAUDE.md', '`docs/guide.md`\n')
        self.check('references')

    def test_replacement_requires_live_active_target_and_no_cycle(self):
        self.write('docs/guide.md', document(status='superseded', extra='replaced-by: docs/new.md#scope\n'))
        self.check('metadata', expected=1)
        self.write('docs/new.md', document())
        self.check('metadata')
        for variant in (dict(status='proposed'), dict(status='retired'),
                        dict(body='## Other\n'),
                        dict(status='superseded', extra='replaced-by: docs/guide.md\n')):
            with self.subTest(variant=variant):
                self.write('docs/new.md', document(**variant))
                self.check('metadata', expected=1)

    def test_no_docs_repository_is_valid(self):
        (self.root / 'docs/guide.md').unlink()
        self.commit()
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.check('metadata')
        self.check('references')
        self.review()


if __name__ == '__main__':
    unittest.main()
