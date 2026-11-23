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

    def test_review_01_gate_checks_before_commit(self):
        text = self.skill('pdh-pm')
        processing = text.split('### 承認の PDH-stage')[1].split('#### 出力')[0]
        step = processing.split('2. note の Status')[1].split('3. ')[0]
        self.assertIn('bash scripts/check-pdh-ticket.sh', step)
        self.assertIn('commit の前', step)
        self.assertIn('bash scripts/check-pdh-ticket.sh', text.split('##### 機械で確かめるもの')[1].split('##### 判断')[0])
        self.assertIn('承認者へ渡す前の `check-pdh-ticket.sh`', text)
        self.ready()
        self.check()
        self.write(f'{self.ticket}/progress.md', '')
        self.assertIn('前提の見直し', self.check(code=1))
        self.note('implement')
        # gate より後には記録を遡及要求しない（既存の AC hash のみ書く）。
        hashed = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh', '--ac-hash', f'{self.ticket}/ticket.md').stdout.strip()
        with (self.root / self.ticket / 'ticket.md').open('a') as f:
            f.write(f'AC-approved: {hashed}\n')
        self.check()

    def test_review_02_decision_criteria_have_one_authority(self):
        for name in ('base.md', 'final-check.md'):
            text = self.source(f'{ENGINE}/skills/pdh-decision-board/{name}')
            self.assertIn('PDH-AGENTS.md', text)
            self.assertIn('確認が要るのは判断であって、調査ではない', text)
            self.assertNotIn('「利用者が見る結果が違う」を判断化の根拠にしない', text)
        self.assertNotIn('全案でゴールの達成のされ方が同じなら、その判断は承認者の判断ではない', self.source(f'{ENGINE}/skills/pdh-decision-board/base.md'))
        self.assertNotIn('迷ったら、次の 3 つを全部満たすか', self.source(f'{ENGINE}/skills/pdh-decision-board/final-check.md'))
        self.assertIn('照合の報告の件数', self.skill('pdh-ticket-write'))

    def test_review_03_single_viable_ac_change_still_requires_approval(self):
        text = self.skill('pdh-pm')
        self.assertIn('選ぶ理由のある案が 1 つ', text)
        self.assertIn('変わる約束', text)
        self.assertIn('覆す条件', text)
        self.assertIn('承認するか', text)
        self.assertIn('AC と Out-of-scope の承認', text)

    def test_review_04_cross_path_and_s7_decisions(self):
        self.assertIn('既存の経路', self.skill('pdh-ticket-review'))
        text = self.skill('pdh-review')
        self.assertIn('S7・S8 の書式', text)
        self.assertIn('S7 でも', text)
        self.assertIn('S7・S8 の各行', text)
        close = self.source(f'{ENGINE}/skills/pdh-decision-board/close-gate.md')
        self.assertRegex(close, r'S7・S8.*決定サマリー')
        self.note('review', '- [x] S7 PDH-review-1 PM が決めた: 修正に絞る 覆す条件: 新しい欠陥')
        self.check()
        self.note('review', '- [x] S7 PDH-review-1 PM が決めた: 修正に絞る')
        self.assertIn('S7 の判断の記録', self.check(code=1))

    def test_review_05_adjacent_new_s8_is_not_legacy(self):
        self.old_s8()
        self.check()
        self.edit_note(self.row, self.row.replace('[x]', '[ ]') + '\n- [x] S8 PDH-review-2 発行先: /new')
        self.commit('adjacent new row and old mark edit')
        self.assertIn('S8 の判断の記録', self.check(code=1))
        self.edit_note('- [x] S8 PDH-review-2 発行先: /new', '- [x] S8 PDH-review-2 PM が決めた: 修正 覆す条件: 再発')
        self.check()
        with (self.root / self.ticket / 'note.md').open('a') as f:
            f.write(self.row + '\n')
        self.commit('duplicate old row')
        self.assertIn('S8 の判断の記録', self.check(code=1))

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
        for text in ('PM が決めた: 修正 覆す条件: 発行先: /board', 'PM が決めた: 発行先: /board 覆す条件: 再発', 'PM が決めた:修正 覆す条件:発行先:/board', 'PM が決めた:発行先:/board 覆す条件:再発', '利用者の判断が要る理由:発行先:/board'):
            self.note('review', '- [x] S8 PDH-review-2 ' + text)
            self.assertIn('S8 の判断の記録', self.check(code=1))
        self.note('review', '- [x] S8 PDH-review-2 PM が決めた: 修正 覆す条件: 再発')
        self.check()

    def test_review_09_reference_docs_match_conditional_review(self):
        install = self.source(f'{ENGINE}/INSTALL.md')
        self.assertNotIn('必須ではない。回す条件', install)
        self.assertIn('DB/API', install)
        examples = self.source('evals/examples.md')
        self.assertIn('3 件中 2 件', examples)
        self.assertIn('再承認が 5 回', examples)
        for path in ('docs/pdh-glossary.md', f'{ENGINE}/skills/pdh-review/SKILL.md', f'{ENGINE}/skills/pdh-decision-board/SKILL.md'):
            text = self.source(path)
            self.assertNotIn('S8 で結論を添えてユーザに次の手を選ばせる', text)
            self.assertNotIn('「収束」の S8 で止まり、', text)
        self.assertIn('S8 で利用者', self.skill('pdh-review'))

    def test_review_10_bot_allows_pm_decisions_but_waits_for_human_answers(self):
        for path in ('_issue.md', 'system.md'):
            text = self.source(f'github-bot/.github/coding-bot/{path}')
            self.assertIn('PM が決めた:', text)
            self.assertIn('覆す条件:', text)
            self.assertIn('利用者の判断が要る理由:', text)
            self.assertIn('発行先:', text)

    def test_review_11_irreversible_changes_match_the_shared_criterion(self):
        text = self.source('docs/PDH-AGENTS.md')
        criterion = text.split('**利用者にしか決められない判断**')[1].split('\n')[0]
        self.assertIn('戻しにくい変更（DB・他者が使う契約）', criterion)
        self.assertIn('相談', criterion)

    def test_review_12_ac_reader_reports_means_instead_of_results(self):
        text = self.source('claude/templates/agents/claude/pdh-ac-reader.md')
        self.assertIn('(3)', text)
        self.assertIn('結果ではなく手段', text)
        self.assertIn('AC 全件', text)
        self.assertIn('repo を探して読まない', text)

    def test_review_13_future_rebuild_is_not_no_changes(self):
        for db, api in [('なし。後で作り直しになる', 'なし'), ('なし', 'なし。後で作り直す')]:
            self.ready(db, api)
            self.check()
            self.write(f'{self.ticket}/progress.md', '')
            self.assertIn('前提の見直し', self.check(code=1))
        self.ready('なし（説明）', 'なし。補足')
        self.write(f'{self.ticket}/progress.md', '')
        self.check()

    def test_review_14_note_template_and_migration_include_evidence_slots(self):
        import yaml
        config = yaml.safe_load(self.source(f'{ENGINE}/templates/.ticket-config.yaml'))
        text = config['note_content']
        self.assertIn('- [ ] いちばん悪い初期状態:', text)
        self.assertIn('## AC の組の順番', text)
        self.assertIn('AC の組の順番', self.source(f'{ENGINE}/INSTALL.md'))

    def test_review_15_review_output_location_is_required(self):
        self.ready()
        for record in ('前提の見直し: codex 結果: 採用した', '前提の見直し: codex 結果: /worker/result.md'):
            self.write(f'{self.ticket}/progress.md', record + '\n')
            self.assertIn('前提の見直し', self.check(code=1))
        for path in ('/worker/result.md', 'https://example.invalid/result'):
            self.write(f'{self.ticket}/progress.md', f'前提の見直し: codex 結果: 案 A を採用。詳細: {path}\n')
            self.check()

    def test_review_16_generic_initial_state_examples(self):
        text = self.skill('pdh-ticket-review').split('### 初期状態と、AC の組の順番を確かめる')[1].split('### 別件')[0]
        self.assertNotIn('一度も写していない会話', text)
        self.assertIn('未初期化', text)
        self.assertIn('Required-Probes', text)

del Fixture

if __name__ == '__main__':
    unittest.main()
