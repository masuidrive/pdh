"""note の書式の導入・旧 note と clone の互換の契約。"""
from pathlib import Path
import shutil
import subprocess
import unittest
from pdh_review_contracts_test import NoteFixture, STAMP, SOURCE, ENGINE


class NoteFormatCompatibility(NoteFixture):
    def test_note_format_v2_unmarked_notes_keep_legacy_evidence_behavior(self):
        for stage in ('ticket-human-review', 'implement', 'review', 'verify', 'human-review'):
            with self.subTest(stage=stage):
                self.ready(db=None, api=None, review=None, initial=None, sequence=None,
                           marked=False, heading=False, stage=stage, evidence=False)
                self.check()
        for row in ('- [x] S8 PDH-review-1 旧い回答 発行先: /old', '- [x] S8: 旧い回答',
                    '- [ ] S8 PDH-review-1 旧い結論'):
            with self.subTest(row=row):
                self.note('review', row)
                self.check()

    def test_note_format_v2_absent_section_keeps_legacy_evidence_behavior(self):
        for stage in ('ticket-review', 'implement', 'review', 'verify', 'human-review'):
            with self.subTest(stage=stage):
                self.ready(db=None, api=None, review=None, initial=None, sequence=None, heading=False, stage=stage, evidence=False)
                self.check()

    def test_note_format_v2_done_excludes_new_checks(self):
        self.ready(db=None, api=None, review=None, initial=None, sequence=None)
        self.note('close', '- [x] S8 PDH-review-1 書式なし')
        self.mark()
        self.commit('ticket before done')
        self.write(f'{self.ticket}/progress.md', f'review-sha: {self.sha()}\nclose-gate-sha: {self.sha()}\n')
        (self.root / 'tickets/done').mkdir()
        self.run_cmd('git', 'mv', self.ticket, 'tickets/done/sample')
        self.check()

    def test_note_format_v2_s8_applies_in_every_active_status(self):
        for stage in ('ticket-write', 'ticket-review', 'ticket-human-review', 'implement', 'review', 'verify', 'human-review'):
            with self.subTest(stage=stage):
                self.ready(stage=stage)
                self.edit('## Checklist', '## Checklist\n- [x] S8 PDH-review-1 書式なし')
                self.assertIn('書式どおりに書く', self.check(1))

    def test_note_format_v2_enter_stamps_only_without_existing_s8(self):
        for row in ('', '- [x] S8 PDH-review-1 旧い回答', '- [ ] S8: 旧い結論',
                    '- [-] S8 PDH-review-1 - skip: 理由'):
            with self.subTest(row=row):
                self.note('review', row)
                result = self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-review', '--enter', f'{self.ticket}/note.md')
                p = self.root / self.ticket / 'note.md'
                self.assertEqual(p.read_text().startswith(STAMP), not bool(row))
                self.assertIn('印', result.stdout)
                first = p.read_text()
                self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-review', '--enter', f'{self.ticket}/note.md')
                self.assertEqual(first, p.read_text())
        self.note('review', '## Other\n- [x] S8 ここは Checklist でない')
        self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-review', '--enter', f'{self.ticket}/note.md')
        self.assertTrue((self.root / self.ticket / 'note.md').read_text().startswith(STAMP))

    def test_note_format_v2_enter_preserves_existing_marked_s8(self):
        self.note('review', '- [x] S8 PDH-review-1 書式なし')
        self.mark()
        self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-review', '--enter', f'{self.ticket}/note.md')
        self.assertEqual((self.root / self.ticket / 'note.md').read_text().count(STAMP), 1)
        self.assertIn('書式どおりに書く', self.check(1))

    def test_note_format_v2_clone_depth_does_not_change_results(self):
        cases = [(stage, marked, valid) for stage in ('review', 'ticket-human-review')
                 for marked, valid in [(False, False), (True, False), (True, True)]]
        for stage, marked, valid in cases:
            with self.subTest(stage=stage, marked=marked, valid=valid):
                if stage == 'review':
                    self.note(stage, '- [x] S8 PDH-review-1 ' + ('PM が決めた: 修正 覆す条件: 再発' if valid else '書式なし'))
                    if marked:
                        self.mark()
                else:
                    self.ready(marked=marked, review='済み' if valid else None)
                self.commit('note format case')
                outputs = []
                for depth in (None, 1):
                    target = self.root.parent / (self.root.name + '-clone')
                    self.addCleanup(shutil.rmtree, target, True)
                    args = ['git', 'clone', '-q', '--single-branch'] + (['--depth', str(depth)] if depth else [])
                    self.run_cmd(*args, self.root.as_uri(), str(target))
                    r = subprocess.run(['bash', 'scripts/check-pdh-ticket.sh'], cwd=target, env=self.env,
                                       text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                    outputs.append((r.returncode, r.stdout))
                    shutil.rmtree(target)
                self.assertEqual(outputs[0], outputs[1])
                self.assertEqual(outputs[0][0], int(marked and not valid))

    def test_note_format_v2_template_is_checkable_without_filling_prose(self):
        import yaml
        template = yaml.safe_load((SOURCE / ENGINE / 'templates/.ticket-config.yaml').read_text())['note_content']
        self.assertEqual(template.splitlines()[0], STAMP)
        self.ready()
        self.write(f'{self.ticket}/note.md', template)
        for stage in ('ticket-write', 'open', 'ticket-review'):
            self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', f'PDH-{stage}', '--enter', f'{self.ticket}/note.md')
        p = self.root / self.ticket / 'note.md'
        p.write_text(p.read_text().replace('PDH-ticket-write\n', 'PDH-ticket-human-review\n', 1))
        self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-ticket-human-review', '--enter', f'{self.ticket}/note.md')
        with p.open('a') as f:
            f.write('\n- [ ] 回答待ち 発行先: /board\n')
        # 待ち行は Checklist に置く。
        self.edit('## Checklist', '## Checklist\n- [ ] 回答待ち 発行先: /board')
        self.assertIn('あり か なし の1語だけ', self.check(1))
        for before, after in [('DB-changes:', 'DB-changes: なし'), ('API-changes:', 'API-changes: なし'),
                              ('前提の見直し:', '前提の見直し: 不要'), ('いちばん悪い初期状態:', 'いちばん悪い初期状態: 測った'),
                              ('いちばん悪い初期状態の記録:', 'いちばん悪い初期状態の記録: progress.md'),
                              ('AC の組の順番:', 'AC の組の順番: 表')]:
            self.edit('\n' + before + '\n', '\n' + after + '\n')
        self.check()


del NoteFixture
if __name__ == '__main__':
    unittest.main()
