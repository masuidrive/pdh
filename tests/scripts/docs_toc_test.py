import os
"""The TOC delivers stage-specific current documents without executing checks."""
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    from .docs_policy_test import document
except ImportError:
    from docs_policy_test import document

ROOT = Path(os.environ['PDH_TEST_ROOT'])


class DocsTocTests(unittest.TestCase):
    def test_output_can_be_truncated_without_broken_pipe_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'docs').mkdir()
            (root / 'docs/guide.md').write_text(document(
                stale='[{event: before-use}]',
                body=''.join(f'## Section {number}\nText\n' for number in range(2000))))
            for command in (
                ['bash', str(ROOT / 'scripts/docs-toc.sh')],
                ['python3', str(ROOT / 'scripts/docs-policy.py'), 'toc'],
            ):
                with self.subTest(command=command):
                    result = subprocess.run(
                        ['bash', '-o', 'pipefail', '-c', '"$@" | head -n 5',
                         'bash', *command, '--stage', 'PDH-implement'],
                        cwd=root, capture_output=True, text=True, timeout=10)
                    self.assertEqual(len(result.stdout.splitlines()), 5)
                    self.assertNotIn('BrokenPipeError', result.stderr)
                    self.assertEqual(result.stderr, '')
                    self.assertIn(result.returncode, (0, 141))

    def test_stage_status_custom_directories_and_section_sizes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
            (root / 'docs/results').mkdir(parents=True)
            (root / 'specs').mkdir()
            (root / 'docs/current.md').write_text(document(stale='[{event: before-use}]',
                body='## First\nText\n### Child\n```md\n## Fake\n```\n## Last\nEnd\n'))
            (root / 'docs/old.md').write_text(document(status='retired', stale='[{event: policy-change}]'))
            (root / 'specs/api.md').write_text(document(kind='contract', stages='[PDH-review]', stale='[{event: policy-change}]'))
            (root / 'docs/results/run.md').write_text('# Measurement\n')
            def toc(*args):
                result = subprocess.run(['bash', str(ROOT / 'scripts/docs-toc.sh'), *args],
                                        cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                return result.stdout
            output = toc('--stage', 'PDH-implement')
            self.assertIn('docs/current.md [reference/active]', output)
            self.assertIn('(6 lines) ## First', output)
            self.assertIn('(4 lines) ### Child', output)
            self.assertNotIn('Fake', output)
            for name in ('old.md', 'run.md', 'api.md'):
                self.assertNotIn(name, output)
            self.assertEqual(output, toc('--stage', 'PDH-implement'))
            self.assertIn('old.md', toc('--all'))
            self.assertIn('run.md [measurement/result]', toc('--all'))
            self.assertNotIn('docs/', toc('specs'))
            self.assertIn('api.md', toc('--stage', 'PDH-review', 'specs'))

    def test_external_check_entry_is_printed_without_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'docs').mkdir()
            (root / 'docs/query.md').write_text(document(stale='[{check: [touch, executed], expect: {exit-code: 0}}]'))
            result = subprocess.run(['bash', str(ROOT / 'scripts/docs-toc.sh')],
                                    cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('python3 scripts/docs-policy.py check-external docs/query.md', result.stdout)
            self.assertFalse((root / 'executed').exists())

    def test_invalid_stage_and_legacy_metadata_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'docs').mkdir()
            (root / 'docs/guide.md').write_text('# Missing metadata\n')
            for args in ([], ['--stage', 'pdh-resume']):
                result = subprocess.run(['bash', str(ROOT / 'scripts/docs-toc.sh'), *args],
                                        cwd=root, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
