"""承認の経路・記録の互換・読み手へ渡す契約を検証する。"""
import os
from pathlib import Path
import unittest
from pdh_script_regressions_test import ScriptTests as Fixture

ROOT = Path(os.environ['PDH_TEST_ROOT'])
SOURCE = Path(os.environ['PDH_SOURCE_ROOT'])
ENGINE = os.environ.get('PDH_TEST_ENGINE', 'claude')

class ReviewContracts(unittest.TestCase):
    setUp = Fixture.setUp
    write = Fixture.write
    run_cmd = Fixture.run_cmd
    commit = Fixture.commit
    sha = Fixture.sha
    note = Fixture.note
    check = Fixture.check

    def source(self, path):
        return (SOURCE / path).read_text()

    def skill(self, name):
        return self.source(f'{ENGINE}/skills/{name}/SKILL.md')

    def ready(self, db='あり', api='なし', heading='What / Acceptance Criteria', rows=None):
        self.note('ticket-human-review')
        self.write(f'{self.ticket}/ticket.md', '### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n### ' + heading + '\n' + (rows or '- [ ] AC 1: 一覧を読める\n- [ ] AC 2: 詳細を読める\n'))
        with (self.root / self.ticket / 'note.md').open('a') as f:
            f.write(f'## PDH-ticket-review. Ticket contract check\nDB-changes: {db}\nAPI-changes: {api}\n## Required-Probes\n- [x] いちばん悪い初期状態: 空 結果: 読める\n## AC の組の順番\n当たる組なし: 異なるデータ\n')
        self.write(f'{self.ticket}/progress.md', '前提の見直し: codex 結果: A を採用、B は状態が増えるため外した。詳細: /worker/result.md\n')

    def edit_note(self, before, after):
        p = self.root / self.ticket / 'note.md'
        p.write_text(p.read_text().replace(before, after))

    def old_s8(self, branch=False, pending=False):
        self.note('review', '')
        self.row = ('- [ ]' if pending else '- [x]') + ' S8 PDH-review-1 回答済み 発行先: /old'
        with (self.root / self.ticket / 'note.md').open('a') as f:
            f.write(self.row + '\n')
        p = self.root / 'scripts/check-pdh-ticket.sh'
        current = p.read_text()
        p.write_text(current.replace('# s8-decision: v1\n', ''))
        self.commit('legacy S8')
        if branch:
            self.run_cmd('git', 'checkout', '-qb', 'legacy')
            self.write('legacy-file', 'branch\n')
            self.commit('legacy branch')
            self.run_cmd('git', 'checkout', 'features/sample')
        p.write_text(current)
        self.commit('adopt S8 marker')
        return self.sha()





    def test_review_05_adjacent_new_s8_is_not_legacy(self):
        self.old_s8()
        self.check()
        self.edit_note(self.row, self.row.replace('[x]', '[ ]') + '\n- [x] S8 PDH-review-2 発行先: /new')
        self.commit('adjacent new row and old mark edit')
        self.assertIn('S8 の判断の記録', self.check(code=1))
        self.edit_note('- [x] S8 PDH-review-2 発行先: /new', '- [x] S8 PDH-review-2 PM が決めた: 修正 覆す条件: 再発')
        self.check()

    def test_review_06_legacy_answers_rename_shallow_and_replayed_branch(self):
        self.old_s8(branch=True, pending=True)
        self.edit_note(self.row, self.row + ' — Q21=1')
        self.check()
        self.commit('answer append')
        self.run_cmd('git', 'mv', self.ticket, 'tickets/renamed')
        self.ticket = 'tickets/renamed'
        self.commit('rename ticket')
        self.check()
        for depth in (1, 2):
            with self.subTest(depth=depth):
                target = self.root / f'shallow-{depth}'
                self.run_cmd('git', 'clone', '-q', '--depth', str(depth), self.root.as_uri(), str(target))
                self.assertIn('警告', self._shallow_check(target))
        # rebase と同じ tree と parent を cherry-pick で再生（禁止された rebase は実行しない）。
        self.run_cmd('git', 'checkout', 'legacy')
        self.run_cmd('git', 'cherry-pick', 'features/sample~2')
        self.check()
        with (self.root / 'tickets/sample/note.md').open('a') as f:
            f.write(self.row + '\n')
        self.assertIn('S8 の判断の記録', self.check(code=1))

    def _shallow_check(self, target):
        import subprocess
        r = subprocess.run(['bash', 'scripts/check-pdh-ticket.sh'], cwd=target, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.assertEqual(r.returncode, 0, r.stdout)
        return r.stdout

    def test_review_07_record_layouts_and_actionable_diagnostics(self):
        self.ready()
        self.check()
        self.write(f'{self.ticket}/progress.md', '  - 前提の見直し: codex（medium）結果: 案 A。詳細: /worker/result.md\n')
        self.edit_note('- [x] いちばん', '  - [x] いちばん')
        self.edit_note('当たる組なし:', '  - 当たる組なし:')
        self.check()
        self.edit_note('結果: 読める', '結果: ')
        self.assertIn('- [x] いちばん悪い初期状態:', self.check(code=1))

    def test_review_08_no_skip_engines_empty_decisions_or_hidden_ac(self):
        self.ready()
        self.check()
        for engine in ('回さない', 'なし', '不要'):
            with self.subTest(engine=engine):
                self.write(f'{self.ticket}/progress.md', f'前提の見直し: {engine} 結果: 小さい変更。詳細: /worker/result.md\n')
                self.assertIn('前提の見直し', self.check(code=1))
        for heading, rows in [('Acceptance Criteria（AC）', None), ('AC（Acceptance Criteria）', '- AC 1: 一覧を読める\n- AC 2: 詳細を読める\n')]:
            self.ready(heading=heading, rows=rows)
            self.edit_note('当たる組なし: 異なるデータ', '')
            self.assertIn('AC の組の順番', self.check(code=1))
        hashed = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh', '--ac-hash', f'{self.ticket}/ticket.md').stdout.strip()
        with (self.root / self.ticket / 'ticket.md').open('a') as f:
            f.write(f'AC-approved: {hashed}\n')
        for text in ('PM が決めた: 修正 覆す条件: 発行先: /board', 'PM が決めた: 発行先: /board 覆す条件: 再発'):
            self.note('review', '- [x] S8 PDH-review-2 ' + text)
            self.assertIn('S8 の判断の記録', self.check(code=1))
        self.note('review', '- [x] S8 PDH-review-2 PM が決めた: 修正 覆す条件: 再発')
        self.check()





    def test_review_13_future_rebuild_is_not_no_changes(self):
        for db, api in [('なし。後で作り直しになる', 'なし'), ('なし', 'なし。後で作り直す')]:
            self.ready(db, api)
            self.check()
            self.write(f'{self.ticket}/progress.md', '')
            self.assertIn('前提の見直し', self.check(code=1))
        self.ready('なし（説明）', 'なし。補足')
        self.write(f'{self.ticket}/progress.md', '')
        self.check()


    def test_review_15_review_output_location_is_required(self):
        self.ready()
        for record in ('前提の見直し: codex 結果: 採用した', '前提の見直し: codex 結果: /worker/result.md'):
            self.write(f'{self.ticket}/progress.md', record + '\n')
            self.assertIn('前提の見直し', self.check(code=1))
        for path in ('/worker/result.md', 'https://example.invalid/result'):
            self.write(f'{self.ticket}/progress.md', f'前提の見直し: codex 結果: 案 A を採用。詳細: {path}\n')
            self.check()


del Fixture

if __name__ == '__main__':
    unittest.main()
