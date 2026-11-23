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

    def test_review_19_marked_note_enforced_at_depth_one(self):
        for text, code in [('PM が決めた: 修正 覆す条件: 再発', 0), ('書式なし', 1)]:
            with self.subTest(text=text):
                self.note('review', '- [x] S8 PDH-review-1 ' + text)
                self.edit_note('## Checklist', STAMP + '\n## Checklist')
                self.commit('new note ' + text)
                target = self.clone('marked-' + str(code), 1)
                out = self.clone_check(target, code)
                self.assertNotIn('警告', out)
        with self.subTest(template=True):
            import yaml
            engine = os.environ.get('PDH_TEST_ENGINE', 'claude')
            self.assertIn(STAMP, yaml.safe_load(self.source(f'{engine}/templates/.ticket-config.yaml'))['note_content'])

        # 印なしの旧 note は、導入直前まで届く shallow では full と同じ判定。
        self.setUp()
        row = '- [x] S8 PDH-review-1 旧行 発行先: /old'
        self.legacy(row)
        self.edit_note('## Checklist', '## Checklist\n- [x] S8 PDH-review-2 新しい書式なし')
        self.commit('new malformed line after legacy adoption')
        self.assertIn('S8 の判断の記録', self.check(1))
        self.assertIn('警告', self.clone_check(self.clone('unknown-boundary', 1), 0))
        self.assertNotIn('警告', self.clone_check(self.clone('known-boundary', 3), 1))

    def test_review_20_head_history_matches_fresh_clone(self):
        row = '- [x] S8 PDH-review-1 旧い回答 発行先: /old'
        self.note('review', '')
        p = self.root / 'scripts/check-pdh-ticket.sh'
        current = p.read_text()
        p.write_text(current.replace('# s8-decision: v1\n', '').replace('# s8-decision: v2\n', ''))
        self.commit('pre-format baseline')
        baseline = self.sha()
        self.run_cmd('git', 'checkout', '-qb', 'old-feature')
        self.edit_note('## Checklist', '## Checklist\n' + row)
        self.commit('pre-format ticket row')
        old = self.sha()
        self.run_cmd('git', 'checkout', 'features/sample')
        p.write_text(current.replace('# s8-decision: v2', '# s8-decision: v1'))
        self.commit('adopt prior format on base')
        self.run_cmd('git', 'cherry-pick', old)
        # 同じ tree/parent の履歴再生。新しい clone に reflog は無い。
        with self.subTest(replayed=True):
            target = self.clone('replayed')
            (target / 'scripts/check-pdh-ticket.sh').write_text(current)
            self.clone_check(target, 0)
            p.write_text(current)
            self.check()
        self.commit('adopt note format after replay')
        # 捨てた別 branch の行を、今の HEAD の旧行として数えない。
        self.run_cmd('git', 'checkout', '-qb', 'discarded', baseline)
        self.edit_note('## Checklist', '## Checklist\n- [x] S8 PDH-review-1 消した行 発行先: /ghost')
        self.commit('discarded row')
        self.run_cmd('git', 'checkout', 'features/sample')
        self.edit_note('## Checklist', '## Checklist\n- [x] S8 PDH-review-1 消した行 発行先: /ghost')
        with self.subTest(discarded=True):
            self.assertIn('S8 の判断の記録', self.check(1))
        self.commit('new malformed row')
        with self.subTest(fresh=True):
            self.clone_check(self.clone('ghost'), 1)


    def test_review_22_legacy_answer_suffix_and_colon(self):
        for suffix in (' — 1', ' → 1', ' （回答: 1）', ' 回答: 1', ' -- 1'):
            for label in ('S8', 'S8:'):
                with self.subTest(suffix=suffix, label=label):
                    # 一時 repo をケースごとに作り、同じ旧行の件数を混ぜない。
                    self.setUp()
                    row = f'- [ ] {label} PDH-review-1 旧い回答 発行先: /old'
                    self.legacy(row)
                    self.edit_note(row, row.replace('[ ]', '[x]') + suffix)
                    self.check()
                    self.commit('answer suffix')
                    self.check()
                    self.edit_note('## Checklist', '## Checklist\n' + row.replace('[ ]', '[x]'))
                    self.assertIn('S8', self.check(1))




del Fixture

if __name__ == '__main__':
    unittest.main()
