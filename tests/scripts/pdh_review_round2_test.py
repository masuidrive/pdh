"""待ち行、書式の導入境界、承認前の記録を利用する契約。"""
import os
from pathlib import Path
import subprocess
import unittest
from pdh_review_contracts_test import ReviewContracts as Fixture

STAMP = '<!-- s8-decision: v2 -->'

class ReviewRoundTwo(unittest.TestCase):
    setUp = Fixture.setUp
    write = Fixture.write
    run_cmd = Fixture.run_cmd
    commit = Fixture.commit
    sha = Fixture.sha
    note = Fixture.note
    check = Fixture.check
    source = Fixture.source
    skill = Fixture.skill
    ready = Fixture.ready
    edit_note = Fixture.edit_note

    def legacy(self, row):
        self.note('review', row)
        p = self.root / 'scripts/check-pdh-ticket.sh'
        current = p.read_text()
        p.write_text(current.replace('# s8-decision: v1\n', '').replace('# s8-decision: v2\n', ''))
        self.commit('legacy row before note format')
        p.write_text(current)
        self.commit('adopt note format')

    def clone(self, name, depth=None):
        target = self.root.parent / (self.root.name + '-' + name)
        self.addCleanup(__import__('shutil').rmtree, target, True)
        args = ['git', 'clone', '-q'] + (['--depth', str(depth)] if depth else [])
        self.run_cmd(*args, self.root.as_uri(), str(target))
        return target

    def clone_check(self, target, code):
        r = subprocess.run(['bash', 'scripts/check-pdh-ticket.sh'], cwd=target,
                           env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.assertEqual(r.returncode, code, r.stdout)
        return r.stdout

    def test_review_18_s7_wait_uses_handover_check(self):
        row = '- [ ] S7 PDH-review-2 前提の見直しの結論待ち 発行先: /w/s7/result.md'
        for stage, reviews, code, message in [('review', 3, 1, 'S5 で止まるべき'),
                                             ('verify', 2, 1, 'S7 の答えを待ったまま'),
                                             ('review', 2, 0, '検査を通過')]:
            with self.subTest(stage=stage, reviews=reviews):
                self.note(stage, row)
                self.write(f'{self.ticket}/progress.md', ''.join(f'review-sha: {i:07x}\n' for i in range(1, reviews+1)))
                self.assertIn(message, self.check(code))
        self.note('review', '- [x] S8 PDH-review-2 書式なし')
        self.assertIn('S8 の判断の記録', self.check(1))


del Fixture

if __name__ == '__main__':
    unittest.main()
