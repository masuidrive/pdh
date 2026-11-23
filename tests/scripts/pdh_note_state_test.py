"""待ち行と承認前の記録の状態を note の内容だけで判定する契約。"""
import itertools
import shutil
import subprocess
import unittest
from pdh_review_contracts_test import NoteFixture, STAMP


class NoteStateContracts(NoteFixture):
    def ready_state(self, stage='ticket-human-review'):
        self.ready(stage=stage)

    def test_every_handover_row_must_be_answered(self):
        for kind, stage, reviews, marks in itertools.product(
                (7, 8), ('review', 'verify'), (1, 2),
                (('x',), ('-',), ('x', 'x'), ('x', '-'), ('x', ' '), (' ', 'x'))):
            with self.subTest(kind=kind, stage=stage, reviews=reviews, marks=marks):
                rows = '\n'.join(f'- [{m}] S{kind} PDH-review-1 利用者の判断が要る理由: 出力 発行先: /board{i}'
                                 + (' - skip: 撤回した' if m == '-' else '') for i, m in enumerate(marks))
                self.note(stage, rows)
                self.mark()
                self.write(f'{self.ticket}/progress.md', ''.join(f'review-sha: {n:07x}\n' for n in range(1, reviews+1)))
                blocked = any(mark not in ('x', 'X') for mark in marks) and (reviews > 1 or stage == 'verify')
                out = self.check(int(blocked))
                if blocked:
                    self.assertIn('S5 で止まるべき' if reviews > 1 else '答えを待ったまま', out)

    def test_gate_wait_keeps_each_unanswered_row(self):
        for marks in (('x', ' '), (' ', 'x'), ('x',), ('x', 'x')):
            with self.subTest(marks=marks):
                self.ready_state()
                rows='\n'.join(f'- [{m}] PDH-ticket-human-review の回答待ち 発行先: /gate{i}' for i,m in enumerate(marks))
                self.edit('- [ ] 回答待ち 発行先: /board', rows)
                out=self.check(int(' ' not in marks))
                if ' ' not in marks:
                    self.assertIn('未了行が無い', out)

    def test_evidence_survives_later_stages(self):
        for stage in ('ticket-human-review', 'implement', 'review', 'verify', 'human-review', 'close'):
            with self.subTest(stage=stage):
                self.ready_state(stage)
                self.check()
                for key, value in (('前提の見直し', '済み'),
                                   ('いちばん悪い初期状態', '測った'), ('AC の組の順番', '表')):
                    self.ready_state(stage)
                    self.edit(key+': '+value, key+':')
                    self.assertIn(key, self.check(1))
        for stage in ('implement', 'review', 'verify'):
            self.note(stage)
            self.mark()
            self.check()

    def test_enter_preserves_note_format_at_every_stage(self):
        for stage in ('ticket-write', 'open', 'ticket-review', 'ticket-human-review', 'implement', 'review', 'verify', 'human-review', 'close'):
            for marked in (False, True):
                with self.subTest(stage=stage, marked=marked):
                    self.note(stage)
                    if marked:
                        self.mark()
                    p = self.root / self.ticket / 'note.md'
                    before = p.read_text()
                    for _ in range(2):
                        self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-'+stage, '--enter', f'{self.ticket}/note.md')
                        self.assertEqual(p.read_text().startswith(STAMP), marked)
                        self.assertEqual('## 承認前の記録' in p.read_text(), marked)
                    self.assertEqual(p.read_text().count('## 承認前の記録'), before.count('## 承認前の記録'))

    def test_states_are_whole_values_and_descriptions_are_separate(self):
        cases=[('DB-changes', 'あり', 0), ('API-changes', 'なし', 0),
               ('DB-changes', 'あり 説明', 1), ('API-changes', 'なし。変更しない', 1),
               ('前提の見直し', '済み', 0), ('前提の見直し', '済み /path', 1),
               ('いちばん悪い初期状態', '測った', 0), ('いちばん悪い初期状態', '当たらない', 0),
               ('いちばん悪い初期状態', '測った /path', 1),
               ('AC の組の順番', '表', 0), ('AC の組の順番', '当たる組なし', 0),
               ('AC の組の順番', '当たる組なし 理由', 1)]
        for key,value,code in cases:
            with self.subTest(key=key,value=value):
                self.ready_state()
                p=self.root/self.ticket/'note.md'
                rows=[key+': \t'+value+'  ' if row.startswith(key+':') else row for row in p.read_text().splitlines()]
                p.write_text('\n'.join(rows)+'\n')
                out=self.check(code)
                if code:
                    self.assertIn(key, out)
        for key in ('前提の見直しの記録', 'いちばん悪い初期状態の記録', 'AC の組の順番の理由'):
            self.ready_state()
            self.edit('AC の組の順番: 表', 'AC の組の順番: 当たる組なし')
            self.edit('AC の組の順番の理由: 別の状態', 'AC の組の順番の理由: 別々')
            self.edit(key+': '+('別々' if key.endswith('理由') else 'progress.md'), key+':   ')
            self.check()
        self.ready_state()
        self.edit('DB-changes: あり', 'DB-changes: なし\nDB-changes の内容: 作り直しは不要')
        self.edit('API-changes: なし', 'API-changes: なし\nAPI-changes の内容: 不明な文でも状態にはしない')
        self.edit('前提の見直し: 済み', '前提の見直し: 不要')
        self.check()

    def test_stamp_integrity_also_applies_to_other_branches_and_done(self):
        self.note('review')
        for directory in ('tickets/other', 'tickets/done/old'):
            self.write(directory+'/note.md', '<!-- pdh-note-format: 1 -->\n## Status: done\n')
            self.assertIn('印が壊れている', self.check(1))
            self.write(directory+'/note.md', '## Status: done\n## 承認前の記録\n')
            self.assertIn('印が欠けている', self.check(1))
            self.write(directory+'/note.md', '## Status: done\n')
            self.check()

    def test_broken_or_missing_stamp_is_rejected_independent_of_status_and_git(self):
        for stage,stamp in itertools.product(('ticket-write', 'ticket-human-review', 'implement', 'review', 'verify'),
                ('<!-- pdh-note-format: 1 -->', '<!-- pdh-note-format:2 -->', '\n'+STAMP, '説明\n'+STAMP, '')):
            with self.subTest(stage=stage,stamp=stamp):
                self.ready_state(stage)
                self.edit(STAMP+'\n', stamp+'\n')
                self.assertIn('印が欠けている' if not stamp else '印が壊れている', self.check(1))
        self.ready_state('review')
        self.edit(STAMP, ' \t'+STAMP+'  ')
        self.check()
        for clone_depth in (None, 1):
            self.ready_state('review')
            self.edit(STAMP, '<!-- pdh-note-format: 3 -->')
            if clone_depth is None:
                self.commit('broken stamp')
            target=self.root/'clone'
            args=['git','clone','-q']+(['--depth',str(clone_depth)] if clone_depth else [])
            self.run_cmd(*args, self.root.as_uri(), str(target))
            out=subprocess.run(['bash','scripts/check-pdh-ticket.sh'],cwd=target,env=self.env,text=True,capture_output=True)
            self.assertEqual(out.returncode,1,out.stdout+out.stderr)
            self.assertIn('印が壊れている',out.stderr)
            shutil.rmtree(target)
        self.ready_state('review')
        self.edit(STAMP+'\n', '')
        self.edit('## 承認前の記録', '## 旧記録')
        self.check()
        self.edit('## Status:', '<!-- pdh-note-format: 1 -->\n## Status:')
        self.env['GIT_CEILING_DIRECTORIES'] = str(self.root.parent)
        shutil.rmtree(self.root / '.git')
        self.assertIn('印が壊れている', self.check(1))


del NoteFixture
if __name__ == '__main__':
    unittest.main()
