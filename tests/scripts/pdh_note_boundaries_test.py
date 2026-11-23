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
        self.note('review')
        self.edit('## Status:', '<!-- pdh-note-format: 1 -->\n## Status:')
        self.assertIn('印が壊れている', self.check(1))
        self.ready(marked=False, evidence=True)
        self.assertIn('印が欠けている', self.check(1))

    def test_skip_requires_label_but_not_reason_content(self):
        for kind in (7, 8):
            for stage, reviews in (('review', 2), ('verify', 1)):
                for mark, suffix, code in (('x', '', 0), ('-', '', 1), ('-', ' - skip:', 0), ('-', ' - skip: 撤回', 0)):
                    with self.subTest(kind=kind, stage=stage, mark=mark, suffix=suffix):
                        self.ready(stage=stage)
                        self.edit('## Checklist', f'## Checklist\n- [{mark}] S{kind} PDH-review-1 利用者の判断が要る理由: 出力 発行先: /board{suffix}')
                        self.write(self.ticket + '/progress.md', ''.join(f'review-sha: {n:07x}\n' for n in range(1, reviews+1)))
                        self.check(code)
        for stage in ('ticket-human-review', 'implement'):
            for suffix, code in (('', 1), (' - skip:', 0)):
                with self.subTest(gate=stage, suffix=suffix):
                    self.ready(stage=stage)
                    self.edit('## Checklist', '## Checklist\n- [-] PDH-ticket-human-review 回答待ち 発行先: /old' + suffix)
                    self.check(code)

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
