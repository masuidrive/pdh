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
        args = ['git', 'clone', '-q', '--single-branch'] + (['--depth', str(depth)] if depth else [])
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

        # 導入直前まで届いても、当時 note が無かった場合は新規の行として検査する。
        self.setUp()
        check = self.root / 'scripts/check-pdh-ticket.sh'
        current = check.read_text()
        (self.root / self.ticket / 'note.md').unlink()
        check.write_text(current.replace('# s8-decision: v2\n', '').replace('# s8-decision: v1\n', ''))
        self.commit('before format without note')
        check.write_text(current)
        self.commit('adopt format without note')
        self.note('review', '- [x] S8 PDH-review-1 新しい書式なし')
        self.commit('new unmarked note after format')
        self.assertIn('S8 の判断の記録', self.check(1))
        self.assertNotIn('警告', self.clone_check(self.clone('known-boundary-without-note', 3), 1))

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
        self.run_cmd('git', 'add', '.')
        self.run_cmd('git', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'adopt note format after replay')
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




    def test_review_21_none_prefix_alone_controls_required_review(self):
        for value, code in [('あり。後で表の形を変える', 1),
                            ('なし。Brief の対象を後で足しても作り直しにはならない', 0),
                            ('なし。Tower を足しても作り直しは要らない（元の記録から作り直せる表だけ）', 0),
                            ('なし。Tower を足すときは表の形を変える必要がある', 0)]:
            for field in ('db', 'api'):
                with self.subTest(value=value, field=field):
                    self.ready(**{'db': 'なし', 'api': 'なし'} | {field: value})
                    self.write(f'{self.ticket}/progress.md', '')
                    self.check(code)


    def test_review_23_placeholder_and_unperformed_review_rejected(self):
        self.ready()
        self.check()
        for engine in ('回さなかった', '未実施', 'skip', '省略', '<engine>'):
            with self.subTest(engine=engine):
                self.write(f'{self.ticket}/progress.md', f'前提の見直し: {engine} 結果: 案 A 詳細: /worker/result.md\n')
                self.assertIn('前提の見直し', self.check(1))
        for record in ('前提の見直し: codex 結果: <結果> 詳細: /worker/result.md',
                       '前提の見直し: codex 結果: 案 A 詳細: /<worker>/result.md'):
            with self.subTest(record=record):
                self.write(f'{self.ticket}/progress.md', record + '\n')
                self.check(1)
        self.ready()
        for value in ('<状態> 結果: 読める', '空 結果: <測った結果と progress の所在>'):
            with self.subTest(value=value):
                self.ready()
                self.edit_note('空 結果: 読める', value)
                self.assertIn('いちばん悪い初期状態', self.check(1))
        self.ready()
        self.edit_note('- [x] いちばん悪い初期状態: 空 結果: 読める', '- [-] いちばん悪い初期状態: 対象 - skip: 状態を持たない')
        self.check()


    def test_review_24_material_is_delivered_after_check_and_commit(self):
        processing = self.skill('pdh-pm').split('### 承認の PDH-stage')[1].split('#### 出力')[0]
        self.assertNotIn('材料を作って渡す', processing)
        self.assertLess(processing.index('1. 材料を作る'), processing.index('2. note の Status'))
        self.assertLess(processing.index('bash scripts/check-pdh-ticket.sh'), processing.index('3. 材料を渡す'))
        self.assertIn('同じ commit', processing)
        self.assertIn('答えを受けたら', processing)

    def test_review_25_current_references_and_reader_means_response(self):
        engine = os.environ.get('PDH_TEST_ENGINE', 'claude')
        close = self.source(f'{engine}/skills/pdh-decision-board/close-gate.md')
        self.assertNotIn('「判断の分類」の最初の問い', close)
        self.assertIn('PDH-AGENTS.md', close)
        flow = self.skill('pdh-pm').split('### 進め方')[1].split('\n##')[0]
        self.assertIn('承認の PDH-stage', flow.split('2. ')[1].split('3. ')[0])
        step = self.skill('pdh-ticket-review').split('### AC だけで伝わるかを確かめる')[1].split('### ')[0]
        self.assertRegex(step, r'3\..*\(3\).*結果.*書き直')
        self.assertIn('書き直した AC だけをもう一度渡す', step)

del Fixture

if __name__ == '__main__':
    unittest.main()
