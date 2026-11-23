"""note の書式は新規作成時に決まり、状態とラベルだけを機械で数える。"""
import re
import shutil
import unittest
from pdh_review_contracts_test import NoteFixture, SOURCE, ENGINE, STAMP


class NoteBoundaries(NoteFixture):
    def legacy_with_real_skills(self, stage, row=''):
        shutil.copytree(SOURCE / ENGINE / 'skills', self.root / '.claude/skills', dirs_exist_ok=True)
        script = (self.root / 'scripts/check-pdh-ticket.sh').read_text()
        late = re.search(r"late_review_evidence_lines=\$\(cat <<'EOF'\n(.*?)\nEOF", script, re.S).group(1).splitlines()
        rows = []
        for name in ('ticket-write', 'open', 'ticket-review', 'ticket-human-review', 'implement', 'review', 'verify', 'human-review', 'close'):
            lines = self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-' + name).stdout.splitlines()
            rows.extend(line.replace('- [ ]', '- [x]', 1) for line in lines if line.removeprefix('- [ ] ') not in late)
        self.write(self.ticket + '/note.md', f'## Status: PDH-{stage}\n## Checklist\n' + '\n'.join(rows) + '\n' + row + '\n- [ ] 回答待ち 発行先: /board\n')

    def test_enter_preserves_legacy_until_close_gate(self):
        self.legacy_with_real_skills('verify')
        self.check()
        self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-verify', '--enter', self.ticket + '/note.md')
        self.edit('## Status: PDH-verify', '## Status: PDH-human-review')
        self.check()
        self.assertFalse((self.root / self.ticket / 'note.md').read_text().startswith(STAMP))

    def test_enter_preserves_legacy_s8_at_ac_reapproval(self):
        for label in ('S8 PDH-review-1', 'S8:', 'S8：'):
            with self.subTest(label=label):
                self.legacy_with_real_skills('ticket-human-review', '- [x] ' + label + ' 旧い回答 発行先: /old')
                self.check()
                self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-ticket-human-review', '--enter', self.ticket + '/note.md')
                self.check()
                text = (self.root / self.ticket / 'note.md').read_text()
                self.assertNotIn('## 承認前の記録', text)
                self.assertFalse(text.startswith(STAMP))

    def test_marked_note_requires_visible_evidence_section(self):
        for stage in ('ticket-human-review', 'implement', 'review', 'verify', 'human-review', 'close'):
            for mode in ('absent', 'commented'):
                with self.subTest(stage=stage, mode=mode):
                    self.ready(stage=stage)
                    self.check()
                    if mode == 'absent':
                        self.ready(stage=stage, evidence=False)
                    else:
                        self.edit('## 承認前の記録', '<!--\n## 承認前の記録')
                        self.edit('## AC の組の順番', '-->\n## AC の組の順番')
                    self.assertIn('承認前の記録', self.check(1))
        self.ready(stage='ticket-review', evidence=False)
        self.check()

    def test_duplicate_state_keys_are_rejected(self):
        for key, value in (('DB-changes', 'あり'), ('API-changes', 'なし'), ('前提の見直し', '済み'),
                           ('いちばん悪い初期状態', '測った'), ('AC の組の順番', '表')):
            for duplicate in (value, '未実施'):
                with self.subTest(key=key, duplicate=duplicate):
                    self.ready()
                    self.check()
                    self.edit(key + ': ' + value, key + ': ' + duplicate + '\n' + key + ': ' + value)
                    self.assertIn(key, self.check(1))
        self.ready(db='なし', review='不要')
        self.edit('DB-changes: なし', 'DB-changes: あり\nDB-changes: なし')
        self.assertIn('DB-changes', self.check(1))

    def test_parent_heading_closes_state_sections(self):
        for heading in ('# Other', '## Other'):
            for key, value in (('DB-changes', 'あり'), ('いちばん悪い初期状態', '測った')):
                with self.subTest(heading=heading, key=key):
                    self.ready()
                    self.check()
                    self.edit(key + ': ' + value, heading + '\n' + key + ': ' + value)
                    self.assertIn(key, self.check(1))
        self.ready()
        self.edit('前提の見直し: 済み', '### Details\n前提の見直し: 済み')
        self.check()

    def test_stamp_mentions_in_body_are_not_broken_headers(self):
        for directory in (self.ticket, 'tickets/done/old'):
            for mention in ('pdh-note-format', '<!-- pdh-note-format: 2 -->', '- [x] 印 pdh-note-format を扱う'):
                with self.subTest(directory=directory, mention=mention):
                    self.note('review')
                    self.write(directory + '/note.md', '## Status: PDH-review\n## Checklist\n- [x] PDH-review: 証拠がある\n' + mention + '\n')
                    self.check()
        # 新しい書式のものを含む note は AC 7 の対象外。壊れた印・印なしの新節は拒否する。
        self.note('review')
        self.edit('## Status:', '<!-- pdh-note-format: 1 -->\n## Status:')
        self.assertIn('印が壊れている', self.check(1))
        self.ready(marked=False, evidence=True)
        self.assertIn('印が欠けている', self.check(1))

    def test_duplicate_review_waits_follow_note_format(self):
        for marked in (False, True):
            for kind in (7, 8):
                for marks in ((' ', 'x'), ('x', ' '), (' ', ' '), ('x', 'X')):
                    for stage, reviews in (('review', 1), ('review', 2), ('verify', 1)):
                        with self.subTest(marked=marked, kind=kind, marks=marks, stage=stage, reviews=reviews):
                            self.ready(stage=stage, marked=marked)
                            rows = ''.join(f'\n- [{mark}] S{kind} PDH-review-1 利用者の判断が要る理由: 出力 発行先: /board' for mark in marks)
                            self.edit('## Checklist', '## Checklist' + rows)
                            self.write(self.ticket + '/progress.md', ''.join(f'review-sha: {n:07x}\n' for n in range(1, reviews + 1)))
                            answered = all(mark in ('x', 'X') for mark in marks) if marked else any(mark in ('x', 'X') for mark in marks)
                            code = int(not answered and (stage == 'verify' or reviews > 1))
                            self.check(code)

    def test_review_wait_requires_answer(self):
        for kind in (7, 8):
            for stage, reviews in (('review', 1), ('review', 2), ('verify', 1)):
                for mark, suffix, code in (('x', '', 0), ('X', '', 0), ('-', '', 1), ('-', ' - skip:', 1), ('-', ' - skip: 撤回', 1)):
                    with self.subTest(kind=kind, stage=stage, mark=mark, suffix=suffix):
                        self.ready(stage=stage)
                        self.edit('## Checklist', f'## Checklist\n- [{mark}] S{kind} PDH-review-1 利用者の判断が要る理由: 出力 発行先: /board{suffix}')
                        self.write(self.ticket + '/progress.md', ''.join(f'review-sha: {n:07x}\n' for n in range(1, reviews+1)))
                        self.check(0 if stage == 'review' and reviews == 1 else code)
    def test_free_form_review_wait_has_one_action(self):
        for kind in (7, 8):
            for mark, code in (('-', 1), ('x', 0)):
                with self.subTest(kind=kind, mark=mark):
                    self.ready(stage='implement')
                    self.edit('## Checklist', f'## Checklist\n- [{mark}] PDH-review-1 の S{kind} 前提の見直し 発行先: /board')
                    self.write(self.ticket + '/progress.md', 'review-sha: 0000001\nreview-sha: 0000002\n')
                    out = self.check(code)
                    self.assertNotIn('- skip:', out)
                    self.assertEqual(out.count('S5 で止まるべき'), code)
        self.ready(stage='implement')
        self.edit('## Checklist', '## Checklist\n- [-] AC の承認待ち（S8 の結果を含む） 発行先: /board')
        out = self.check(1)
        self.assertIn('- skip:', out)
        self.assertNotIn('S5 で止まるべき', out)

    def test_general_skip_mentions_are_not_review_waits(self):
        for row in ('AC の承認待ち', 'AC の承認待ち（S7 の結果を含む）', 'AC の承認待ち（S8 の結果を含む）'):
            for suffix, code in (('', 1), (' - skip:', 0)):
                with self.subTest(row=row, suffix=suffix):
                    self.ready(stage='implement')
                    self.edit('## Checklist', '## Checklist\n- [-] ' + row + ' 発行先: /board' + suffix)
                    self.check(code)
        self.ready(stage='review')
        self.edit('## Checklist', '## Checklist\n- [-] S7 PDH-review-1 回答待ち 発行先: /board')
        self.check()

    def test_legacy_wait_rules_are_preserved(self):
        for stage in ('ticket-human-review', 'human-review'):
            for marked in (False, True):
                with self.subTest(stage=stage, marked=marked):
                    self.ready(stage=stage, marked=marked)
                    self.check()
                    self.edit('- [ ] 回答待ち 発行先: /board', '<!--\n- [ ] 回答待ち 発行先: /board\n-->')
                    self.check(1 if marked else 0)
        for marked in (False, True):
            self.ready(stage='implement', marked=marked)
            self.edit('## Checklist', '## Checklist\n- [-] 一般の待ち 発行先: /board')
            self.check(1 if marked else 0)
        for kind in (7, 8):
            for mark, code in (('x', 0), ('X', 0), ('-', 1)):
                self.ready(stage='verify', marked=False)
                self.edit('## Checklist', f'## Checklist\n- [{mark}] S{kind} PDH-review-1 回答待ち 発行先: /board - skip: 撤回')
                self.check(code)

    def test_state_key_trailing_space_is_ignored(self):
        for key, value in (('DB-changes', 'あり'), ('API-changes', 'なし'), ('前提の見直し', '済み'),
                           ('いちばん悪い初期状態', '測った'), ('AC の組の順番', '表')):
            with self.subTest(key=key):
                self.ready()
                self.edit(key + ':', key + ' \t:')
                self.check()
                self.edit(key + ' \t: ' + value, key + ' \t: ' + value + '\n' + key + ': ' + value)
                self.assertIn('2回以上', self.check(1))
        self.ready(db='なし', review='不要')
        self.edit('DB-changes: なし', 'DB-changes : あり\nDB-changes: なし')
        self.assertIn('2回以上', self.check(1))

    def test_gate_wait_only_counts_visible_rows(self):
        for stage in ('ticket-human-review', 'human-review'):
            self.ready(stage=stage)
            self.check()
            self.edit('- [ ] 回答待ち 発行先: /board', '<!--\n- [ ] 回答待ち 発行先: /board\n-->')
            self.assertIn('未了行が無い', self.check(1))
            self.edit('-->\n', '-->\n- [ ] 回答待ち 発行先: /visible\n')
            self.check()

    def test_prose_and_table_content_are_not_machine_contracts(self):
        for sequence in ('表', '当たる組なし'):
            self.ready(review_record='', initial_record='', sequence_reason='', heading=False, sequence=sequence)
            self.check()
            self.edit('いちばん悪い初期状態: 測った', 'いちばん悪い初期状態:')
            self.assertIn('いちばん悪い初期状態', self.check(1))
        for row in ('PM が決めた: 覆す条件:', '利用者の判断が要る理由: 発行先:'):
            self.ready(stage='review')
            self.edit('## Checklist', '## Checklist\n- [x] S8 PDH-review-1 ' + row)
            self.check()
            self.edit(row, '書式なし')
            self.assertIn('書式どおりに書く', self.check(1))


del NoteFixture
if __name__ == '__main__':
    unittest.main()
