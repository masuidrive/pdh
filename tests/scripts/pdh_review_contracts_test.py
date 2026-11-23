"""note の固定キーによる承認前の記録と S8 の書式の契約。"""
import os
from pathlib import Path
import unittest
from pdh_script_regressions_test import ScriptTests as Fixture

SOURCE = Path(os.environ['PDH_SOURCE_ROOT'])
ENGINE = os.environ.get('PDH_TEST_ENGINE', 'claude')
STAMP = '<!-- pdh-note-format: 2 -->'


class NoteFixture(unittest.TestCase):
    setUp = Fixture.setUp
    write = Fixture.write
    run_cmd = Fixture.run_cmd
    commit = Fixture.commit
    sha = Fixture.sha
    note = Fixture.note
    check = Fixture.check

    def edit(self, before, after):
        p = self.root / self.ticket / 'note.md'
        p.write_text(p.read_text().replace(before, after))

    def mark(self, evidence=True):
        p = self.root / self.ticket / 'note.md'
        text = p.read_text()
        if evidence:
            text += ('## PDH-ticket-review. Ticket contract check\nDB-changes: なし\nAPI-changes: なし\n'
                     '## 承認前の記録\n前提の見直し: 不要\nいちばん悪い初期状態: 当たらない\nAC の組の順番: 当たる組なし\n')
        p.write_text(STAMP + '\n' + text)

    def ready(self, db='あり', api='なし', review='済み',
              initial='測った', sequence='表', heading=True,
              count=2, prefix='', marked=True, stage='ticket-human-review',
              review_record='progress.md', initial_record='progress.md', sequence_reason='別の状態', evidence=None):
        self.write(f'{self.ticket}/ticket.md',
                   '### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n'
                   '### What / Acceptance Criteria\n' +
                   ''.join(f'- [ ] AC {n}: 結果 {n} を読める\n' for n in range(1, count + 1)))
        hashed = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh', '--ac-hash', f'{self.ticket}/ticket.md').stdout.strip()
        with (self.root / self.ticket / 'ticket.md').open('a') as f:
            f.write(f'AC-approved: {hashed}\n')
        self.note(stage)
        if marked:
            self.mark(evidence=False)
        with (self.root / self.ticket / 'note.md').open('a') as f:
            f.write('## PDH-ticket-review. Ticket contract check\n')
            for key, value in [('DB-changes', db), ('API-changes', api)]:
                if value is not None:
                    f.write(f'{prefix}{key}: {value}\n')
            if evidence if evidence is not None else marked:
                f.write('## 承認前の記録\n')
                for key, value in [('前提の見直し', review), ('前提の見直しの記録', review_record),
                                   ('いちばん悪い初期状態', initial), ('いちばん悪い初期状態の記録', initial_record),
                                   ('AC の組の順番', sequence), ('AC の組の順番の理由', sequence_reason)]:
                    if value is not None:
                        f.write(f'{prefix}{key}: {value}\n')
            if heading:
                f.write('## AC の組の順番\n| AC の組 | 経路と順番 | 順番ごとの約束 |\n|---|---|---|\n')


class NoteFormatContracts(NoteFixture):
    def test_note_format_v2_change_value(self):
        for key in ('db', 'api'):
            for value, code in [('あり', 0), ('あり。変更する', 1), ('なし', 0),
                                ('なし。作り直しは要らない', 1), ('未定', 1), ('', 1), (None, 1)]:
                with self.subTest(key=key, value=value):
                    self.ready(**{key: value})
                    out = self.check(code)
                    if code:
                        self.assertIn('あり か なし の1語だけ', out)
                        self.assertIn('例:', out)

    def test_note_format_v2_review_status_and_location(self):
        for db, api in [('あり', 'なし'), ('なし', 'あり'), ('なし', 'なし')]:
            for value, location in [('済み', 'progress.md'), ('済み', 'https://example.invalid/result'),
                                    ('済み', '/<UUID>/result.md'), ('済み', ''),
                                    ('済み progress.md', 'progress.md'), ('不要', ''), ('', ''), (None, '')]:
                code = 0 if (value == '済み' or value == '不要' and db == api == 'なし') else 1
                with self.subTest(db=db, api=api, value=value, location=location):
                    self.ready(db=db, api=api, review=value, review_record=location)
                    out = self.check(code)
                    if code:
                        self.assertIn('前提の見直し', out)
                        self.assertIn('例:', out)

    def test_note_format_v2_initial_state_status(self):
        for value, location, code in [('測った', 'progress.md', 0), ('当たらない', '状態を持たない', 0),
                                      ('測った', '/<UUID>/probe', 0), ('測った', '', 0), ('当たらない', '', 0),
                                      ('測った progress.md', '所在', 1), ('', '所在', 1), (None, '所在', 1)]:
            with self.subTest(value=value, location=location):
                self.ready(initial=value, initial_record=location)
                out = self.check(code)
                if code:
                    self.assertIn('いちばん悪い初期状態', out)
                    self.assertIn('例:', out)

    def test_note_format_v2_sequence_reference(self):
        for count, value, heading, reason, code in [(1, '', False, '', 0), (2, '表', True, '', 0),
                                          (2, '表', False, '', 0), (2, '当たる組なし', False, '別の状態', 0),
                                          (2, '当たる組なし', True, '', 0), (2, '', True, '', 1),
                                          (2, '当たる組なし 理由', True, '理由', 1), (2, None, True, '', 1)]:
            with self.subTest(count=count, value=value, heading=heading):
                self.ready(count=count, sequence=value, heading=heading, sequence_reason=reason)
                out = self.check(code)
                if code:
                    self.assertIn('AC の組の順番', out)
                    self.assertIn('例:', out)

    def test_note_format_v2_key_layout_and_opaque_descriptions(self):
        for prefix in ('', '- ', '  - ', '  '):
            with self.subTest(prefix=prefix):
                self.ready(db='なし', api='なし', review='不要', initial='当たらない',
                           initial_record='<UUID> は設定の記述だけ', sequence='当たる組なし',
                           sequence_reason='設定は別々', prefix=prefix)
                self.write(f'{self.ticket}/progress.md', '前提の見直し: skip 結果: <結果>\n')
                self.check()
        self.ready()
        self.edit('DB-changes:', 'DB-changes：')
        self.assertIn('あり か なし の1語だけ', self.check(1))

    def test_note_format_v2_only_designated_section_counts(self):
        for field in ('前提の見直し', 'いちばん悪い初期状態', 'AC の組の順番'):
            with self.subTest(field=field):
                self.ready()
                p = self.root / self.ticket / 'note.md'
                text = p.read_text()
                row = next(r for r in text.splitlines() if r.startswith(field + ':'))
                p.write_text(text.replace(row, '') + '\n## Other\n' + row + '\n')
                self.assertIn(field, self.check(1))

    def test_note_format_v2_ac_count_matches_hash_heading(self):
        for heading, rows in [('Acceptance Criteria（AC）', '- [ ] AC 1: 一覧\n- [ ] AC 2: 詳細\n'),
                              ('AC（Acceptance Criteria）', '- AC 1: 一覧\n- AC 2: 詳細\n')]:
            with self.subTest(heading=heading):
                self.ready(sequence='', heading=False)
                p = self.root / self.ticket / 'ticket.md'
                p.write_text('### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n### ' + heading + '\n' + rows)
                self.assertIn('AC の組の順番', self.check(1))

    def test_note_format_v2_s8_labels(self):
        cases = [('利用者の判断が要る理由: 出力を変える 発行先: /board', 0),
                 ('PM が決めた: 修正 覆す条件: 再発', 0),
                 ('PM が決めた: <UUID> は変更しない 覆す条件: 該当すると分かったら', 0),
                 ('PM が決めた: 修正 覆す条件: ', 0), ('PM が決めた: 修正', 1),
                 ('利用者の判断が要る理由: 出力を変える', 1),
                 ('説明 PM が決めた: 修正 覆す条件: 再発', 1), ('書式なし', 1)]
        for mark in (' ', 'x', '-'):
            for value, code in cases:
                with self.subTest(mark=mark, value=value):
                    self.note('review', f'- [{mark}] S8 PDH-review-1 {value}' + (' - skip:' if mark == '-' else ''))
                    self.mark()
                    out = self.check(code)
                    if code:
                        self.assertIn('書式どおりに書く', out)
                        self.assertIn('例:', out)

    def test_note_format_v2_s8_requires_round(self):
        for label in ('S8:', 'S8', 'S8: PDH-review-1', 'S8 PDH-review-x'):
            with self.subTest(label=label):
                self.note('review', f'- [x] {label} PM が決めた: 修正 覆す条件: 再発')
                self.mark()
                self.assertIn('書式どおりに書く', self.check(1))

    def test_note_format_v2_ignores_s7_and_mentions_outside_s8_rows(self):
        for row in ('- [x] S7 PDH-review-1 修正に絞る',
                    '- [x] PDH-review: S8 の判断を照合した',
                    '- [x] 依頼: S8 の文を読む'):
            with self.subTest(row=row):
                self.note('review', row)
                self.mark()
                self.check()
        self.note('review', '## Other\n- [x] S8 PDH-review-1 書式なし')
        self.mark()
        self.check()

    def test_note_format_v2_handover_keeps_existing_wait_gates(self):
        for kind in (7, 8):
            for stage, reviews, code, message in [('review', 2, 1, 'S5 で止まるべき'),
                                                 ('verify', 1, 1, f'S{kind} の答えを待ったまま'),
                                                 ('review', 1, 0, '検査を通過')]:
                with self.subTest(kind=kind, stage=stage, reviews=reviews):
                    self.note(stage, f'- [ ] S{kind} PDH-review-1 利用者の判断が要る理由: 出力 発行先: /board')
                    self.mark()
                    self.write(f'{self.ticket}/progress.md', ''.join(f'review-sha: {n:07x}\n' for n in range(1, reviews+1)))
                    self.assertIn(message, self.check(code))

    def test_note_format_v2_new_checklist_rows_follow_note_format(self):
        import re
        script = (SOURCE / ENGINE / 'templates/check-pdh-ticket.sh').read_text()
        rows = re.search(r"late_review_evidence_lines=\$\(cat <<'EOF'\n(.*?)\nEOF", script, re.S).group(1).splitlines()
        for row in rows:
            stage = row.split(':', 1)[0].removeprefix('PDH-')
            skill = self.root / f'.claude/skills/pdh-{stage}/SKILL.md'
            skill.write_text(skill.read_text() + '- [ ] ' + row + '\n')
            self.note(stage)
            self.check()
            self.mark()
            self.assertIn(row, self.check(1))
            self.edit('## Checklist', '## Checklist\n- [-] ' + row + ' - skip: 対象外')
            self.check()

    def test_note_format_v2_stamp_is_first_line_with_optional_whitespace(self):
        self.ready(initial='')
        self.edit(STAMP, '  ' + STAMP + '\t')
        self.assertIn('いちばん悪い初期状態', self.check(1))
        self.edit('  ' + STAMP + '\t\n', '')
        self.assertIn('印が欠けている', self.check(1))
        self.edit('## Checklist', '## Checklist\n' + STAMP)
        self.assertIn('印が欠けている', self.check(1))


del Fixture
if __name__ == '__main__':
    unittest.main()
