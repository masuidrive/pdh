"""PDH の記録検査を、独立した Git 履歴と skill の出力で確かめる。"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

try:
    from .docs_policy_test import document
except ImportError:
    from docs_policy_test import document

ROOT = Path(os.environ['PDH_TEST_ROOT'])
STAGES = ('ticket-write', 'open', 'ticket-review', 'ticket-human-review', 'implement', 'review', 'verify', 'human-review', 'close')
FINDINGS_TABLE_MARKER = '# findings-table: v1'


class ScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(('GIT_', 'GITHUB_', 'TICKET_'))}
        self.env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TEMPLATE_DIR='',
                        GIT_AUTHOR_NAME='Test', GIT_AUTHOR_EMAIL='test@example.invalid',
                        GIT_COMMITTER_NAME='Test', GIT_COMMITTER_EMAIL='test@example.invalid')
        for name in ('check-pdh-ticket', 'pdh-stage-checklist', 'pdh-review-range', 'pdh-lock'):
            self.write(f'scripts/{name}.sh', (ROOT / f'scripts/{name}.sh').read_text())
        self.write('scripts/checks/docs-metadata.check', '# opted in\n')
        self.write('scripts/docs-policy.py', (ROOT / 'scripts/docs-policy.py').read_text())
        self.write('.ticket-config.yaml', 'default_branch: main\nbranch_prefix: features/\n')
        self.run_cmd('git', 'init', '-q', '-b', 'main')
        self.ticket = 'tickets/sample'
        for stage in STAGES:
            skill = 'pm' if stage in ('human-review', 'ticket-human-review') else stage
            path = f'.claude/skills/pdh-{skill}/SKILL.md'
            file = self.root / path
            content = file.read_text() if file.exists() else ''
            self.write(path, content + f'- [ ] PDH-{stage}: 証拠がある\n')
        self.write('code', 'initial\n')
        self.write(f'{self.ticket}/ticket.md', '---\nbranch: features/sample\n---\n### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 利用者が結果を読める\n')
        hashed = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh', '--ac-hash', f'{self.ticket}/ticket.md').stdout.strip()
        with (self.root / self.ticket / 'ticket.md').open('a') as f:
            f.write(f'\nAC-approved: {hashed}\n')
        self.note('implement')
        self.write(f'{self.ticket}/progress.md', '')
        # sample ticket は «findings-table» の印より前の版で作った ticket を再現する（旧 8 列の互換の側）。
        # 印のある版で作った ticket は fresh_ticket() で足す。
        check = (self.root / 'scripts/check-pdh-ticket.sh').read_text()
        self.assertIn(FINDINGS_TABLE_MARKER, check)
        self.write('scripts/check-pdh-ticket.sh', check.replace(FINDINGS_TABLE_MARKER + '\n', '', 1))
        self.commit('initial')
        self.write('scripts/check-pdh-ticket.sh', check)
        self.commit('adopt findings-table marker')
        self.run_cmd('git', 'checkout', '-qb', 'features/sample')
        self.write(f'{self.ticket}/progress.md', f'review-sha: {self.sha()}\nclose-gate-sha: {self.sha()}\n')

    def write(self, path, content):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)

    def run_cmd(self, *args, code=0):
        result = subprocess.run(args, cwd=self.root, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.assertEqual(result.returncode, code, f'{args}: {result.stdout}')
        return result

    def commit(self, message):
        self.run_cmd('git', 'add', '.')
        self.run_cmd('git', '-c', 'commit.gpgsign=false', 'commit', '-qm', message)

    def sha(self):
        return self.run_cmd('git', 'rev-parse', 'HEAD').stdout.strip()

    def note(self, stage, waiting='- [ ] 回答待ち 発行先: /board'):
        self.write(f'{self.ticket}/note.md', f'## Status: PDH-{stage}\n## Checklist\n' + ''.join(f'- [x] PDH-{s}: 証拠がある\n' for s in STAGES) + waiting + '\n')

    def check(self, code=0):
        return self.run_cmd('bash', 'scripts/check-pdh-ticket.sh', code=code).stdout

    def test_board_markdown_separates_labels_and_ac_rows(self):
        board = ('<main class="board"><ul class="summary-list">'
                 '<li><span class="lbl">目的</span><span>編集者が操作する</span></li>'
                 '<li><span class="lbl">成果</span><span>結果を読める</span></li></ul>'
                 '<ul class="axis"><li><span class="lbl">費用</span><span>増えない</span></li></ul>'
                 '<div class="acrow"><span class="id">AC 1</span><div>結果を読める</div></div>'
                 '<div class="acrow"><span class="id">AC 2</span><div>保存できる</div></div>'
                 '<p>末尾 <span class="tag">PASS</span></p></main>')
        result = subprocess.run(['sh', str(ROOT / '.claude/skills/pdh-decision-board/tools/to-markdown.sh'), '/dev/stdin'], input=board, text=True, capture_output=True, check=True)
        for line in ('- **目的**: 編集者が操作する', '- **成果**: 結果を読める', '- **費用**: 増えない'):
            self.assertIn(line, result.stdout.splitlines())
        self.assertIn('**AC 1**: 結果を読める', result.stdout)
        self.assertIn('**AC 2**: 保存できる', result.stdout)
        self.assertIn('末尾 `PASS`', result.stdout)
        self.assertNotRegex(result.stdout, r'(?m)^ {4}\S')

    def test_absent_lock_reports_success_without_hiding_deleted_lock(self):
        output = self.run_cmd('bash', 'scripts/pdh-lock.sh', 'check').stdout
        self.assertIn('未導入のため検査対象なし（成功）', output)
        self.write('.pdh-lock', '# upstream: masuidrive/pdh@' + 'a' * 40 + '\n')
        self.commit('introduce lock')
        (self.root / '.pdh-lock').unlink()
        self.run_cmd('bash', 'scripts/pdh-lock.sh', 'check', '--paths-from', 'HEAD..HEAD', code=1)

    def test_stage_checklist_accepts_legacy_command_references(self):
        pairs = [('PDH-ticket-write: 上のコマンドが 0 で終わった', 'PDH-ticket-write: `pdh-ticket-write`「機械で確かめるもの」のコマンドが 0 で終わった'), ('PDH-ticket-write: `Key-User-Journeys:` の番号が Why の内容と合っている。«該当なし» なら、その理由が書いてある（形だけは上のコマンドが確かめる）', 'PDH-ticket-write: `Key-User-Journeys:` の番号が Why の内容と合っている。«該当なし» なら、その理由が書いてある（形だけは`pdh-ticket-write`「機械で確かめるもの」のコマンドが確かめる）'), ('PDH-ticket-review: 上のコマンドが 0 で終わった', 'PDH-ticket-review: `pdh-ticket-review`「機械で確かめるもの」のコマンドが 0 で終わった'), ('PDH-ticket-human-review: 上の 2 つのコマンドが 0 で終わった', 'PDH-ticket-human-review: 承認者へ渡す前の `check-pdh-ticket.sh` と、回答反映後の 2 つのコマンドが 0 で終わった'), ('PDH-human-review: 上の 1 つ目のコマンドが 0 で終わった', 'PDH-human-review: `pdh-pm`「承認の PDH-stage」内の「機械で確かめるもの」の 1 つ目のコマンドが 0 で終わった')]
        self.note('human-review')
        for old, new in pairs:
            stage = old.split(':', 1)[0].removeprefix('PDH-')
            skill = 'pm' if stage in ('human-review', 'ticket-human-review') else stage
            path = self.root / f'.claude/skills/pdh-{skill}/SKILL.md'
            path.write_text(path.read_text() + '- [ ] ' + new + '\n')
            note = self.root / self.ticket / 'note.md'
            note.write_text(note.read_text() + '- [x] ' + old + '\n')
        self.check()
        note.write_text(note.read_text().replace('上の 2 つのコマンド', '上の 3 つのコマンド'))
        self.assertIn('前の PDH-stage PDH-ticket-human-review', self.check(1))

    def test_stage_enter_explains_where_to_put_annotations(self):
        result = self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-implement', '--enter', f'{self.ticket}/note.md')
        self.assertIn('補足は次の行', result.stdout)
        note = self.root / self.ticket / 'note.md'
        with note.open('a') as f:
            f.write('  補足はここに残す\n')
        self.check()
        self.write(f'{self.ticket}/note.md', note.read_text().replace('PDH-implement: 証拠がある', 'PDH-implement: 証拠がある（補足）'))
        self.assertIn('チェックリストの行が無い', self.check(1))

    def test_described_paths_require_document_review_at_close(self):
        self.write('.pdh-lock', '# upstream: masuidrive/pdh@' + 'a' * 40 + '\n')
        self.write('docs/guide.md', document(stale='[{path: code}]'))
        self.commit('document baseline')
        self.run_cmd('git', 'branch', '-f', 'main', 'HEAD')
        self.write('code', 'changed\n')
        self.commit('change described code')
        self.write(f'{self.ticket}/progress.md', self.review_progress(severity='Minor') + f'close-gate-sha: {self.sha()}\n')
        self.note('human-review')
        self.assertIn('docs/guide.md: related-docs.md', self.check(code=1))
        # Merely distributing docs-policy.py does not adopt metadata at close.
        (self.root/'scripts/checks/docs-metadata.check').unlink()
        content=(self.root/'docs/guide.md').read_text()
        self.write('docs/guide.md', '# Existing plain document\n')
        self.check()
        self.write('docs/guide.md', content)
        self.write('scripts/checks/docs-metadata.check', '# opted in\n')
        for row, expected in (
            ('- [ ] docs/guide.md: 未了', 1),
            ('- [-] docs/guide.md - skip:', 1),
            ('- [x] docs/guide.md: 確かめた（意味は変わらない）', 1),
            ('- [-] docs/guide.md - skip: 動作は変わらない', 1),
        ):
            with self.subTest(row=row):
                self.note('human-review', row + '\n- [ ] 回答待ち 発行先: /board')
                self.check(code=expected)
        self.note('human-review', '- [ ] 回答待ち 発行先: /board\n## Other\n- [x] docs/guide.md: 対象外の節')
        self.check(code=1)
        self.write('docs/guide.md', (self.root / 'docs/guide.md').read_text() + 'updated\n')
        self.check(code=1)
        self.run_cmd('python3', 'scripts/docs-policy.py', 'record', 'docs/guide.md',
                     '--base', 'main', '--note', f'{self.ticket}/note.md', '--resolution', 'updated')
        self.check()

    def test_described_globs_cover_removed_files_and_ignore_other_branches(self):
        self.write('.pdh-lock', '# upstream: masuidrive/pdh@' + 'a' * 40 + '\n')
        self.write('docs/guide.md', document(stale='[{path: "lib/**/*.py"}]'))
        self.write('lib/nested/old.py', 'old\n')
        self.commit('document library')
        self.run_cmd('git', 'branch', '-f', 'main', 'HEAD')
        (self.root / 'lib/nested/old.py').unlink()
        self.commit('remove described path')
        self.note('implement')
        self.check()
        self.note('human-review')
        self.write(f'{self.ticket}/progress.md', self.review_progress(severity='Minor') + f'close-gate-sha: {self.sha()}\n')
        self.assertIn('docs/guide.md', self.check(code=1))
        self.run_cmd('git', 'checkout', '-qb', 'features/other')
        self.check()

    def test_specs_only_repository_requires_document_review(self):
        self.write('specs/contract.md', document(kind='contract', stale='[{path: code}]'))
        self.commit('spec baseline')
        self.run_cmd('git', 'branch', '-f', 'main', 'HEAD')
        self.write('code', 'changed\n')
        self.commit('implementation')
        self.note('human-review')
        self.write(f'{self.ticket}/progress.md', self.review_progress(severity='Minor') + f'close-gate-sha: {self.sha()}\n')
        self.assertIn('specs/contract.md', self.check(code=1))
        self.run_cmd('python3', 'scripts/docs-policy.py', 'record', 'specs/contract.md',
                     '--base', 'main', '--note', f'{self.ticket}/note.md',
                     '--resolution', 'unchanged', '--reason', 'Contract is unchanged.')
        self.check()

    def test_removing_last_document_still_requires_retirement_record(self):
        self.write('docs/guide.md', document(stale='[{path: code}]'))
        self.commit('document baseline')
        self.run_cmd('git', 'branch', '-f', 'main', 'HEAD')
        (self.root / 'docs/guide.md').unlink()
        (self.root / 'docs').rmdir()
        self.commit('remove last document')
        self.note('human-review')
        self.write(f'{self.ticket}/progress.md', self.review_progress(severity='Minor') + f'close-gate-sha: {self.sha()}\n')
        self.assertIn('docs/guide.md', self.check(code=1))
        self.run_cmd('python3', 'scripts/docs-policy.py', 'record', 'docs/guide.md',
                     '--base', 'main', '--note', f'{self.ticket}/note.md', '--resolution', 'retired')
        self.check()

    def findings(self, cost='推定 月 1 回・担当者 2 分', *, column=True):
        if not column:
            return ('### Findings-PDH-review-1\n'
                    '| # | 出した人 | 観点 | Sev | 要旨 | 判定 | 記録先 | 理由 |\n'
                    '|---|---|---|---|---|---|---|---|\n'
                    '| 1 | | AC | Major | 入力の欠落 | 起票する | | 由来: 未判定 |\n')
        return ('### Findings-PDH-review-1\n'
                '| # | 要旨 | 頻度と 1 回のコスト | 判定 | 由来 |\n'
                '|---|---|---|---|---|\n'
                f'| 1 | 入力の欠落 | {cost} | いま直す | この ticket |\n')

    def fresh_ticket(self, name='tickets/fresh'):
        """«findings-table» の印のある版で作った ticket を足す（旧 8 列を認めない側）。"""
        self.write(f'{name}/ticket.md', '---\nbranch: features/sample\n---\n### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n### What\n- [ ] 利用者が結果を読める\n')
        hashed = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh', '--ac-hash', f'{name}/ticket.md').stdout.strip()
        with (self.root / name / 'ticket.md').open('a') as f:
            f.write(f'\nAC-approved: {hashed}\n')
        self.write(f'{name}/note.md', (self.root / self.ticket / 'note.md').read_text())
        self.write(f'{name}/progress.md', '')
        self.commit(f'add {name} after the findings-table marker')
        return name

    def test_findings_legacy_table_alone_is_rejected_after_marker(self):
        name = self.fresh_ticket()
        self.write(f'{name}/progress.md', self.findings(column=False))
        self.commit('legacy findings table in a ticket created after the marker')
        self.assertIn(f'{name}/progress.md:2: Findings 表が旧 8 列だけ', self.check(1))
        with (self.root / name / 'progress.md').open('a') as f:
            f.write('\n' + self.findings())
        self.commit('append the current table')
        self.check()

    def review_progress(self, count=2, heading='### Findings-PDH-review-2',
                        severity='Major', summary='修正が持ち込んだ欠陥', verdict='いま直す'):
        records = ''.join(f'review-sha: {n:07x}\n' for n in range(1, count + 1))
        return records + heading + '\n' + self.table(severity, summary, verdict)

    def table(self, severity='Major', summary='修正が持ち込んだ欠陥', verdict='いま直す'):
        return (self.findings().split('\n', 1)[1].replace('入力の欠落', summary)
                .replace('| Major |', f'| {severity} |').replace('| いま直す |', f'| {verdict} |'))

    def s7(self, round, mark='x'):
        return f'- [{mark}] S7 PDH-review-{round} 前提の見直しの回答待ち 利用者の判断が要る理由: 出力が変わる 発行先: /review-{round}'

    def s8(self, round, mark='x'):
        return f'- [{mark}] S8 PDH-review-{round} 人の答え待ち 利用者の判断が要る理由: 出力が変わる 発行先: /board-{round}'

    def test_review_range_excludes_ticket_evidence_and_keeps_source_changes(self):
        anchor = self.sha()
        for name in ('related-docs.md', 'related-docs-fulltext.md', 'tests/evidence.txt'):
            self.write(f'{self.ticket}/{name}', '記録\n')
        self.commit('record evidence')
        self.write(f'{self.ticket}/progress.md', f'review-sha: {anchor}\n')
        self.assertEqual('', self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket,
                                         '--from', 'last-review', '--commits').stdout)
        self.write('code', 'changed\n')
        self.commit('change source')
        self.assertIn(self.sha(), self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket,
                                             '--from', 'last-review', '--commits').stdout)

    def test_sha_records_accept_adjacent_explanation(self):
        anchor = self.sha()
        self.write('code', 'changed\n')
        self.commit('change after review')
        for kind in ('review-sha', 'close-gate-sha'):
            for prefix in ('', '- '):
                for suffix in ('（2 巡目）', '。説明', '、説明', ' 説明'):
                    for sha in (anchor, anchor[:7], anchor.upper()):
                        with self.subTest(kind=kind, prefix=prefix, suffix=suffix, sha=sha):
                            self.write(f'{self.ticket}/progress.md', f'{prefix}{kind}: {sha}{suffix}\n')
                            mode = 'last-review' if kind == 'review-sha' else 'close-gate'
                            out = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket,
                                               '--from', mode, '--commits').stdout
                            self.assertIn(self.sha(), out)

    def test_sha_records_reject_invalid_leading_run(self):
        for value in ('abcdef', 'a' * 41, '説明abcdef0', '', 'invalid'):
            with self.subTest(value=value):
                self.write(f'{self.ticket}/progress.md', f'review-sha: {self.sha()}\nreview-sha: {value}\n')
                self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket,
                             '--from', 'last-review', '--commits', code=2)

    def test_close_gate_check_accepts_adjacent_explanation(self):
        self.note('human-review')
        self.write(f'{self.ticket}/progress.md',
                   f'review-sha: {self.sha()}（review）\n- close-gate-sha: {self.sha()}。説明\n')
        self.check()

    def test_review_handover_duplicate_corrections_are_one_round(self):
        records = ('review-sha: abcdef0（初回）\n- review-sha: abcdef0 訂正\n'
                   'review-sha: ABCDEF0。再訂正\n')
        self.write(f'{self.ticket}/progress.md', records + self.review_progress(count=0))
        self.check()

    def test_review_handover_two_rounds_with_correction_and_only_minor(self):
        records = ('review-sha: abcdef0（初回）\nreview-sha: abcdef1（2 巡目）\n'
                   '- review-sha: abcdef1 訂正\n')
        self.write(f'{self.ticket}/progress.md', records + self.review_progress(count=0, severity='Minor'))
        self.check()

    def test_review_handover_requires_valid_review_record(self):
        self.write(f'{self.ticket}/progress.md', f'review-sha: invalid\nclose-gate-sha: {self.sha()}\n')
        self.assertIn('有効な review-sha: が 0 件', self.check(1))

    def test_review_handover_second_round_continues_without_s7(self):
        # severity や巡数だけでは S7 を要求しない。因果は PM が判断する。
        for severity, summary, verdict in (('Minor', '修正が持ち込んだ欠陥', 'いま直す'),
                                           ('Info', 'Major という語を含む要旨', 'いま直す'),
                                           ('Major', '修正が持ち込んだ欠陥', '棄却する'),
                                           ('Critical', '修正が持ち込んだ欠陥', '記録だけ残す'),
                                           ('Major', '修正が持ち込んだ欠陥', '起票する')):
            with self.subTest(severity=severity, summary=summary, verdict=verdict):
                self.write(f'{self.ticket}/progress.md',
                           self.review_progress(3, severity=severity, summary=summary, verdict=verdict))
                self.check()

    def test_findings_cost_uses_named_column_and_section_boundaries(self):
        table = '| # | 頻度と 1 回のコスト | 判定 | 要旨 | 由来 |\n|---|---|---|---|---|\n| 1 | | いま直す | 問題 | この ticket |\n'
        self.write(f'{self.ticket}/progress.md', '### Findings-PDH-review-2\n' + table)
        self.assertIn('コスト» が空', self.check(1))
        self.write(f'{self.ticket}/progress.md', self.findings() + '\n### 別の表\n| a | b | c | d | e |\n| 1 | | | | |\n')
        self.check()

    def test_review_handover_close_gate_requires_review(self):
        for prefix in ('', '- '):
            with self.subTest(prefix=prefix):
                self.write(f'{self.ticket}/progress.md', f'{prefix}close-gate-sha: {self.sha()}\n')
                self.assertIn('close-gate-sha: があるのに有効な review-sha: が 0 件', self.check(1))

    def test_review_handover_one_review_allows_close_gate(self):
        for prefix in ('', '- '):
            with self.subTest(prefix=prefix):
                self.write(f'{self.ticket}/progress.md',
                           f'{prefix}review-sha: {self.sha()}\n{prefix}close-gate-sha: {self.sha()}\n')
                self.check()

    def test_review_handover_round_count_does_not_require_s7(self):
        for count in (1, 2, 3, 10):
            for severity in ('Critical', 'Major', 'Minor'):
                with self.subTest(count=count, severity=severity):
                    self.write(f'{self.ticket}/progress.md', self.review_progress(count, f'### Findings-PDH-review-{count}', severity))
                    self.check()

    def test_review_handover_s7_line_allows_the_round(self):
        self.write(f'{self.ticket}/progress.md', self.review_progress())
        for mark in (' ', 'x', 'X', '-'):
            with self.subTest(mark=mark):
                self.note('implement', self.s7(2, mark))
                self.check()

    def test_review_handover_visible_pending_s7_blocks_later_round(self):
        self.write(f'{self.ticket}/progress.md', self.review_progress(3))
        self.note('implement', self.s7(2, ' '))
        self.assertIn('S5 で止まるべき', self.check(1))
        self.note('implement', self.s7(2))
        self.check()

    def test_review_handover_without_second_findings_is_exempt(self):
        for count, heading in ((1, '### Findings-PDH-review-2'),
                               (3, '### Findings-PDH-review-20'),
                               (3, '### Findings (PDH-review-20)'), (3, '')):
            with self.subTest(count=count, heading=heading):
                self.write(f'{self.ticket}/progress.md', self.review_progress(count, heading))
                self.check()

    def test_review_handover_commented_gate_is_not_a_pending_gate(self):
        self.write(f'{self.ticket}/progress.md', self.review_progress(3))
        self.note('implement', '<!-- ' + self.s7(2, ' ') + ' -->')
        self.check()
        self.note('implement', '### 詳細\n' + self.s7(2, ' '))
        self.assertIn('S5 で止まるべき', self.check(1))

    def test_review_handover_answered_s7_does_not_force_s8_by_count(self):
        for count in (3, 4, 9):
            self.write(f'{self.ticket}/progress.md', self.review_progress(count))
            self.note('implement', self.s7(2))
            self.check()

    def test_review_handover_pending_s8_cannot_be_bypassed_by_s7(self):
        self.write(f'{self.ticket}/progress.md', self.review_progress(4))
        self.note('implement', self.s7(2) + '\n' + self.s8(3, ' ') + '\n' + self.s7(4))
        self.assertIn('S5 で止まるべき', self.check(1))

    def test_review_handover_exhaustive_round_has_no_count_threshold(self):
        for count in (2, 3, 4):
            self.write(f'{self.ticket}/progress.md', self.review_progress(count, f'### Findings-PDH-review-{count}（網羅探索）'))
            self.note('verify', self.s7(1))
            self.check()

    def test_review_handover_each_open_gate_requires_its_own_answer(self):
        self.write(f'{self.ticket}/progress.md', self.review_progress(5))
        self.note('implement', self.s7(2) + '\n' + self.s8(3) + '\n' + self.s8(4, ' '))
        self.assertIn('PDH-review-4 の S8 の行が未回答', self.check(1))
        self.note('implement', self.s7(2) + '\n' + self.s8(3) + '\n' + self.s8(4))
        self.check()

    def test_review_handover_s5_stops_the_next_round_until_s7_is_answered(self):
        progress = self.review_progress(3) + '### Findings-PDH-review-3\n' + self.table(severity='Minor')
        self.write(f'{self.ticket}/progress.md', progress)
        for mark in (' ', '-'):
            with self.subTest(mark=mark):
                self.note('implement', self.s7(2, mark))
                self.assertIn('S5 で止まるべき: PDH-review-2 の S7 の行が未回答', self.check(1))
        self.note('implement', self.s7(2))
        self.check()
        self.write(f'{self.ticket}/progress.md', self.review_progress(2))
        self.note('implement', self.s7(2, ' '))
        self.check()

    def test_review_handover_s5_stops_the_next_round_until_s8_is_answered(self):
        records = ''.join(f'review-sha: {n:07x}\n' for n in range(1, 5))
        progress = (records + '### Findings-PDH-review-2\n' + self.table()
                    + '### Findings-PDH-review-3\n' + self.table())
        self.write(f'{self.ticket}/progress.md', progress)
        self.note('implement', self.s7(2) + '\n' + self.s8(3, ' '))
        self.assertIn('S5 で止まるべき: PDH-review-3 の S8 の行が未回答', self.check(1))
        self.note('implement', self.s7(2) + '\n' + self.s8(3))
        self.check()

    def test_review_handover_verify_requires_answered_s7(self):
        self.write(f'{self.ticket}/progress.md', self.review_progress(2))
        for stage in ('verify', 'human-review', 'close'):
            with self.subTest(stage=stage):
                self.note(stage, self.s7(2, ' '))
                self.assertIn(f'S7 の答えを待ったまま PDH-{stage} に進んだ: PDH-review-2', self.check(1))
                self.note(stage, self.s7(2))
                self.assertNotIn('S7', self.check(1) if stage != 'verify' else self.check())

    def test_review_handover_verify_requires_answered_s8(self):
        records = ''.join(f'review-sha: {n:07x}\n' for n in range(1, 4))
        self.write(f'{self.ticket}/progress.md', records + '### Findings-PDH-review-2\n' + self.table()
                   + '### Findings-PDH-review-3\n' + self.table())
        self.note('verify', self.s7(2) + '\n' + self.s8(3, ' '))
        self.assertIn('S8 の答えを待ったまま PDH-verify に進んだ: PDH-review-3', self.check(1))
        self.note('verify', self.s7(2) + '\n' + self.s8(3))
        self.check()

    def test_review_handover_changed_verdict_does_not_infer_causality(self):
        for verdict in ('いま直す', '受け入れる', '起票する'):
            self.write(f'{self.ticket}/progress.md', self.review_progress(3) +
                       f'\nPDH-review-2 #1 処置の変更: 棄却する → {verdict} — 根拠\n')
            self.check()

    def test_constraint_acceptance_preserves_legacy_records(self):
        old = self.findings(column=False)
        change = 'PDH-review-1 #1 処置の変更: いま直す → 記録だけ残す — constraint-accepted\n'
        for record in ('', 'constraint-accepted: PDH-review-1 #1\n',
                       'constraint-accepted: PDH-review-1 #1\n- approval-ref: /board\n'):
            with self.subTest(record=record):
                self.write(f'{self.ticket}/progress.md', old + '\n' + change + record)
                self.check()
        self.write(f'{self.ticket}/progress.md', self.findings().replace('いま直す', '受け入れる'))
        self.check()

    def test_review_handover_checks_done_on_this_branch(self):
        self.write(f'{self.ticket}/progress.md', f'close-gate-sha: {self.sha()}\n')
        (self.root / 'tickets/done').mkdir(exist_ok=True)
        self.run_cmd('git', 'mv', self.ticket, 'tickets/done/sample')
        self.commit('move ticket without review to done')
        self.assertIn('tickets/done/sample は close-gate-sha: があるのに有効な review-sha: が 0 件', self.check(1))

    def test_review_handover_ignores_other_branch(self):
        self.write(f'{self.ticket}/progress.md', 'close-gate-sha: abcdef0\n')
        self.run_cmd('git', 'checkout', '-qb', 'features/other')
        self.check()

    def test_findings_legacy_author_columns_are_not_required(self):
        self.write(f'{self.ticket}/progress.md', self.findings(column=False))
        self.commit('preserve legacy findings')
        self.check()

    def test_findings_rejects_empty_frequency_and_cost(self):
        for cost in ('', '   ', '\t'):
            with self.subTest(cost=cost):
                self.write(f'{self.ticket}/progress.md', self.findings(cost))
                self.commit('record empty cost')
                self.assertIn(f'{self.ticket}/progress.md:4: Findings 表の «頻度と 1 回のコスト» が空', self.check(1))

    def test_findings_missing_cost_column_is_rejected(self):
        self.write(f'{self.ticket}/progress.md',
                   '### Findings-PDH-review-1\n| # | 要旨 | 判定 | 由来 |\n|---|---|---|---|\n| 1 | 問題 | 受け入れる | この ticket |\n')
        self.assertIn('コスト» が無い', self.check(1))

    def test_findings_accepts_measured_or_estimated_cost(self):
        for cost in ('実測 0/219 件・人 1 分', '推定 月 1 回・100 円', '0・誤検出のため害なし'):
            self.write(f'{self.ticket}/progress.md', self.findings(cost))
            self.commit('record frequency and cost')
            self.check()

    def test_findings_accepts_two_new_tables(self):
        # 見出しが 2 つ以上あると行番号が改行区切りになる。BSD awk は -v の値の改行を拒む。
        self.write(f'{self.ticket}/progress.md',
                   self.findings() + '\n' + self.findings().replace('review-1', 'review-2'))
        self.commit('record two findings tables')
        self.check()

    def test_findings_ignores_old_table_even_with_new_rows(self):
        old = self.findings(column=False)
        self.write(f'{self.ticket}/progress.md', old)
        self.commit('old findings')
        self.run_cmd('git', 'branch', '-f', 'main', 'HEAD')
        self.write(f'{self.ticket}/progress.md', old + '| 2 | code | Minor | 古い表への追記 | reject | code | 根拠なし |\n')
        self.commit('append row to old table')
        self.check()
        with (self.root / self.ticket / 'progress.md').open('a') as f:
            f.write('\n' + self.findings(''))
        self.commit('append new findings')
        output = self.check(1)
        self.assertIn(f'{self.ticket}/progress.md:10:', output)
        self.assertNotIn('列が無い', output)

    def test_findings_done_move_preserves_old_table_exemption(self):
        old = self.findings(column=False)
        self.write(f'{self.ticket}/progress.md', old)
        self.commit('old findings')
        self.run_cmd('git', 'branch', '-f', 'main', 'HEAD')
        self.note('close')
        self.write(f'{self.ticket}/progress.md', old + f'review-sha: {self.sha()}\nclose-gate-sha: {self.sha()}\n')
        (self.root / 'tickets/done').mkdir()
        self.run_cmd('git', 'mv', self.ticket, 'tickets/done/sample')
        self.ticket = 'tickets/done/sample'
        self.commit('move ticket to done')
        self.check()
        with (self.root / self.ticket / 'progress.md').open('a') as f:
            f.write('\n' + self.findings(column=False))
        self.commit('append findings after move')
        self.check()

    def test_findings_legacy_header_restored_for_append_only_is_ignored(self):
        old = self.findings(column=False)
        self.write(f'{self.ticket}/progress.md', old + '\n' + self.findings())
        self.commit('keep old header and append current table')
        self.check()
        self.write(f'{self.ticket}/progress.md', old + '\n' + self.findings(''))
        self.assertIn('コスト» が空', self.check(1))

    def test_findings_new_table_is_checked_alongside_legacy_header(self):
        old = self.findings(column=False)
        self.write(f'{self.ticket}/progress.md', old + '\n' + self.findings(''))
        self.commit('append current table after legacy header')
        self.assertIn('コスト» が空', self.check(1))

    def test_findings_uses_configured_tickets_dir(self):
        self.run_cmd('git', 'mv', 'tickets', 'work-items')
        self.ticket = 'work-items/sample'
        self.write('.ticket-config.yaml', 'default_branch: main\nbranch_prefix: features/\ntickets_dir: work-items\n')
        self.write(f'{self.ticket}/progress.md', self.findings(''))
        self.commit('current findings in configured directory')
        self.assertIn(f'{self.ticket}/progress.md:4:', self.check(1))

    def test_findings_skips_check_without_base(self):
        self.run_cmd('git', 'branch', '-D', 'main')
        self.write(f'{self.ticket}/progress.md', self.findings(column=False))
        self.commit('record findings without a base')
        self.check()

    def test_findings_only_checks_cost_not_origin_or_author(self):
        for origin in ('未判定', '', '既存 abc1234', '上流 def5678'):
            self.write(f'{self.ticket}/progress.md', self.findings().replace('この ticket', origin).replace('いま直す', '起票する'))
            self.commit('origin judgment is PM responsibility')
            self.check()

    def test_findings_disposition_change_cannot_fill_empty_cost(self):
        self.write(f'{self.ticket}/progress.md', self.findings('') +
                   '\nPDH-review-1 #1 処置の変更: いま直す → 受け入れる — 推定 月 1 回・担当 1 分\n')
        self.assertIn('コスト» が空', self.check(1))

    def test_findings_checks_working_table_before_commit(self):
        self.write(f'{self.ticket}/progress.md', self.findings())
        self.commit('valid table')
        self.write(f'{self.ticket}/progress.md', self.findings(''))
        self.assertIn('コスト» が空', self.check(1))

    def test_01_pr_merge_skip(self):
        self.write('.ticket-config.yaml', 'github_bot:\n  close: "pr-merge" # merge で承認\n')
        self.note('human-review', '- [-] close の回答待ち 発行先: https://github.com/example/project/pull/1 - skip: close の承認は PR の merge で受ける')
        self.check()
        self.write('.ticket-config.yaml', 'github_bot:\n  close: comment\n')
        self.check(1)

    def test_01_pr_merge_close_dry_run(self):
        shutil.copy2(ROOT / 'ticket.sh', self.root / 'ticket.sh')
        self.write('.ticket-config.yaml', 'default_branch: main\nbranch_prefix: features/\nauto_push: false\nrequire_checklist: true\npre_close_command: bash scripts/check-pdh-ticket.sh\ngithub_bot:\n  close: pr-merge\n')
        self.note('human-review', '- [-] close の回答待ち 発行先: https://github.com/example/project/pull/1 - skip: close の承認は PR の merge で受ける')
        ticket = self.root / self.ticket / 'ticket.md'
        ticket.write_text(ticket.read_text().replace('- [ ]', '- [x]'))
        self.commit('ready for close review')
        self.write(f'{self.ticket}/progress.md', f'review-sha: {self.sha()}\nclose-gate-sha: {self.sha()}\n')
        self.commit('record close review')
        result = self.run_cmd('./ticket.sh', 'close', '--no-merge', '--dry-run', 'sample')
        self.assertIn('Dry-run: all preflight checks passed.', result.stdout)
        self.assertTrue((self.root / self.ticket / 'note.md').exists())
        self.assertIn('## Status: PDH-human-review', (self.root / self.ticket / 'note.md').read_text())
        print('bot pr-merge close: Dry-run: all preflight checks passed.')

    def test_02_empty_ac(self):
        for body in ('### Why\nonly why\n', '### What\n<!-- nothing -->\nAC-approved: e3b0c44298fc1c14\n',
                     '### What\n<!-- nothing -->\n### Out-of-scope\n- 画像生成は対象外\n'):
            with self.subTest(body=body):
                self.write(f'{self.ticket}/ticket.md', body)
                result = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh', '--ac-hash', f'{self.ticket}/ticket.md', code=1)
                self.assertIn('AC の節が無い', result.stdout)

    def test_02_acceptance_criteria_heading(self):
        file = self.root / self.ticket / 'ticket.md'
        file.write_text(file.read_text().replace('### What', '### Acceptance Criteria'))
        self.check()

    def test_02_out_of_scope_changes_require_approval(self):
        for heading in ('### Out-of-scope', '## Out-of-scope'):
            for changed in ('- 画像生成は対象外\n- 非同期 job は対象外\n',
                            '- 音声生成は対象外\n', ''):
                with self.subTest(heading=heading, changed=changed):
                    path = f'{self.ticket}/ticket.md'
                    body = ('### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n'
                            '### What / Acceptance Criteria\n- [ ] 利用者が結果を読める\n'
                            + heading + '\n- 画像生成は対象外\n'
                            '### Design Decisions\n- SQLite を使う\n')
                    self.write(path, body)
                    approved = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh',
                                            '--ac-hash', path).stdout.strip()
                    self.write(path, body + f'AC-approved: {approved}\n')
                    self.check()
                    self.write(path, (body + f'AC-approved: {approved}\n').replace(
                        '- 画像生成は対象外\n', changed))
                    current = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh',
                                           '--ac-hash', path).stdout.strip()
                    self.assertIn('AC か Out-of-scope が承認の後に変わ', self.check(code=1))
                    self.assertNotEqual(approved, current)

    def test_02_skipping_ac_requires_updated_approval_hash(self):
        path = f'{self.ticket}/ticket.md'
        ticket = self.root / path
        self.note('close', '- [x] close の承認回答 発行先: /board')
        self.check()
        changed = ticket.read_text().replace(
            '- [ ] 利用者が結果を読める',
            '- [-] 利用者が結果を読める - skip: 実行先に接続できず未確認')
        self.write(path, changed)
        self.assertIn('AC か Out-of-scope が承認の後に変わ', self.check(code=1))
        approved = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh',
                                '--ac-hash', path).stdout.strip()
        self.write(path, changed.split('AC-approved:')[0] + f'AC-approved: {approved}\n')
        self.check()

    def test_02_without_out_of_scope_preserves_ac_hash(self):
        # 既存の AC だけの式で計算した値。Out-of-scope が無ければそのまま使える。
        import hashlib
        expected = hashlib.sha256('-利用者が結果を読める'.encode()).hexdigest()[:16]
        actual = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh', '--ac-hash',
                              f'{self.ticket}/ticket.md').stdout.strip()
        self.assertEqual(expected, actual)
        self.check()

    def test_02_old_ac_only_approval_is_rejected_when_scope_exists(self):
        path = f'{self.ticket}/ticket.md'
        file = self.root / path
        file.write_text(file.read_text() + '### Out-of-scope\n- 画像生成は対象外\n')
        self.assertIn('AC か Out-of-scope が承認の後に変わ', self.check(code=1))

    def test_02_section_after_out_of_scope_does_not_change_hash(self):
        path = f'{self.ticket}/ticket.md'
        body = ('### Why\nReproduction-or-measurement: fixture\nWhy-not-fix-now: 該当なし\n'
                '### What\n- [ ] 利用者が結果を読める\n'
                '### Out-of-scope\n- 画像生成は対象外\n'
                '### Design Decisions\n- SQLite を使う\n')
        self.write(path, body)
        approved = self.run_cmd('bash', 'scripts/check-pdh-ticket.sh',
                                '--ac-hash', path).stdout.strip()
        self.write(path, body.replace('SQLite', 'PostgreSQL') + f'AC-approved: {approved}\n')
        self.assertEqual(approved, self.run_cmd('bash', 'scripts/check-pdh-ticket.sh',
                                               '--ac-hash', path).stdout.strip())
        self.check()

    def test_02_long_text_after_ac(self):
        # AC の節の後ろが長いと、awk が先に終わって前の段が SIGPIPE で落ち、黙って FAILED になっていた。
        file = self.root / self.ticket / 'ticket.md'
        text = file.read_text().replace('\nAC-approved:', '\n### Design-Decisions\n' + 'x' * 200000 + '\n\nAC-approved:')
        file.write_text(text)
        self.check()

    def test_03_deleted_lock(self):
        self.write('.pdh-lock', '# upstream: masuidrive/pdh@' + 'a' * 40 + '\n')
        self.commit('lock introduced')
        self.run_cmd('git', 'branch', '-f', 'main', 'HEAD')
        (self.root / '.pdh-lock').unlink()
        self.commit('lock deleted')
        self.write(f'{self.ticket}/progress.md', f'review-sha: {self.sha()}\nclose-gate-sha: {self.sha()}\n')
        self.note('human-review')
        self.assertIn('.pdh-lock', self.check(1))
        self.write('.pdh-lock', '# upstream: masuidrive/pdh@' + 'a' * 40 + '\n')
        self.assertIn('.pdh-lock', self.check(1))

    def test_03_required_sources(self):
        registry = (ROOT / 'scripts/checks/required-pdh-source-files.check').read_text()
        skill_root = '.agents' if os.environ.get('PDH_TEST_ENGINE') == 'codex' else '.claude'
        paths = next(line.split('=', 1)[1].split(',') for line in registry.splitlines() if line.startswith('required_paths='))
        for path in paths:
            if not (self.root / path).exists():
                self.write(path, '')
        self.write('checks/required.check', registry)
        self.write('scripts/fast-checks.sh', (ROOT / 'scripts/fast-checks.sh').read_text())
        self.env['CHECKS_DIR'] = str(self.root / 'checks')
        self.run_cmd('bash', 'scripts/fast-checks.sh')
        for path in ('scripts/pdh-lock.sh', 'scripts/check-pdh-ticket.sh', 'scripts/pdh-review-range.sh',
                     f'{skill_root}/skills/pdh-pm/_records.md', f'{skill_root}/skills/pdh-pm/_execution-team.md'):
            with self.subTest(path=path):
                file = self.root / path
                content = file.read_bytes()
                file.unlink()
                result = self.run_cmd('bash', 'scripts/fast-checks.sh', code=1)
                self.assertIn(path, result.stdout)
                file.write_bytes(content)

    def test_single_file_exemption_is_allow_not_exclude(self):
        # exclude は glob の 4 形しか受けないので、1 ファイルを名指しできない。既存の
        # 大きいファイルを 1 つ外したい人がまず書くのはそれなので、エラーは出口を名指しする。
        self.write('scripts/fast-checks.sh', (ROOT / 'scripts/fast-checks.sh').read_text())
        self.env['CHECKS_DIR'] = str(self.root / 'checks')
        self.write('big.mjs', '// line\n' * 20)
        registry = 'reason=too long\nmax_lines=10\nglob=**/*.mjs\n'
        self.write('checks/size.check', registry)
        self.assertIn('big.mjs: 20 lines > max 10', self.run_cmd('bash', 'scripts/fast-checks.sh', code=1).stdout)
        self.write('checks/size.check', registry + 'exclude=big.mjs\n')
        out = self.run_cmd('bash', 'scripts/fast-checks.sh', code=1).stdout
        self.assertIn("invalid exclude entry 'big.mjs'", out)
        self.assertIn('to exempt a single file, use allow=<path>', out)
        self.write('checks/size.check', registry + 'allow=big.mjs\n')
        self.run_cmd('bash', 'scripts/fast-checks.sh')

    def test_required_paths_accept_directory_symlink_and_reject_absence(self):
        self.write('scripts/fast-checks.sh', (ROOT / 'scripts/fast-checks.sh').read_text())
        self.write('skill/SKILL.md', 'instructions\n')
        (self.root / 'skill-link').symlink_to('skill', target_is_directory=True)
        self.write('checks/required.check', 'reason=required skill\nrequired_paths=skill-link\n')
        self.commit('tracked skill symlink')
        self.env['CHECKS_DIR'] = str(self.root / 'checks')
        self.run_cmd('bash', 'scripts/fast-checks.sh')
        (self.root / 'skill/SKILL.md').unlink()
        (self.root / 'skill').rmdir()
        self.assertIn('skill-link', self.run_cmd('bash', 'scripts/fast-checks.sh', code=1).stdout)
        (self.root / 'skill').mkdir()
        (self.root / 'skill-link').unlink()
        self.assertIn('skill-link', self.run_cmd('bash', 'scripts/fast-checks.sh', code=1).stdout)
        self.write('.gitignore', 'ignored\n')
        self.write('ignored', 'present but ignored\n')
        self.write('checks/required.check', 'reason=required tracked file\nrequired_paths=ignored\n')
        self.assertIn('ignored', self.run_cmd('bash', 'scripts/fast-checks.sh', code=1).stdout)

    def test_deleted_tracked_files_are_not_scanned(self):
        self.write('scripts/fast-checks.sh', (ROOT / 'scripts/fast-checks.sh').read_text())
        self.write('checks/pattern.check', 'reason=forbidden content\npattern=FORBIDDEN\nglob=content/**\n')
        self.write('checks/lines.check', 'reason=short files\nmax_lines=1\nglob=content/**\n')
        self.write('content/removed.txt', 'FORBIDDEN\nsecond line\n')
        self.write('content/kept.txt', 'allowed\n')
        self.commit('tracked content')
        (self.root / 'content/removed.txt').unlink()
        self.env['CHECKS_DIR'] = str(self.root / 'checks')
        result = self.run_cmd('bash', 'scripts/fast-checks.sh')
        self.assertIn('2 checks passed', result.stdout)
        self.write('content/kept.txt', 'FORBIDDEN\n')
        self.assertIn('content/kept.txt', self.run_cmd('bash', 'scripts/fast-checks.sh', code=1).stdout)
        self.write('content/kept.txt', 'allowed\n')
        self.write('checks/required.check', 'reason=required content\nrequired_paths=content/removed.txt\n')
        self.assertIn('content/removed.txt', self.run_cmd('bash', 'scripts/fast-checks.sh', code=1).stdout)

    def test_04_conflict_resolution(self):
        self.write('code', 'feature\n')
        self.commit('feature change')
        anchor = self.sha()
        self.run_cmd('git', 'checkout', '-q', 'main')
        self.write('code', 'main\n')
        self.commit('base change')
        self.run_cmd('git', 'checkout', '-q', 'features/sample')
        self.run_cmd('git', 'merge', '--no-ff', 'main', code=1)
        self.write('code', 'new resolution\n')
        self.commit('conflict resolution')
        merge = self.sha()
        self.write(f'{self.ticket}/progress.md', f'close-gate-sha: {anchor}\n')
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--commits')
        self.assertIn(merge, result.stdout, '競合解消の merge commit が一覧に無い')
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--stat')
        self.assertNotIn('0 ファイル', result.stdout)
        # --remerge-diff が無い Git は、merge commit をすべて review する。
        self.write('bin/git', '#!/bin/sh\nfor arg do [ "$arg" != --remerge-diff ] || exit 129; done\nexec ' + shutil.which('git') + ' "$@"\n')
        (self.root / 'bin/git').chmod(0o755)
        self.env['PATH'] = str(self.root / 'bin') + os.pathsep + self.env['PATH']
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--commits')
        self.assertIn(merge, result.stdout)
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--stat')
        self.assertNotIn('0 ファイル', result.stdout)


    def test_05_missing_past_stage(self):
        self.note('human-review')
        file = self.root / self.ticket / 'note.md'
        original = file.read_text()
        for stage in STAGES[:7]:
            with self.subTest(stage=stage):
                file.write_text(original.replace(f'- [x] PDH-{stage}: 証拠がある\n', ''))
                self.assertIn(f'PDH-{stage}', self.check(1))
                file.write_text(original.replace(f'- [x] PDH-{stage}: 証拠がある', f'- [-] PDH-{stage}: 証拠がある - skip: 適用外'))
                self.check()

    def test_past_stages_require_every_skill_line(self):
        for stage in STAGES[:7]:
            skill = 'pm' if stage == 'ticket-human-review' else stage
            path = self.root / f'.claude/skills/pdh-{skill}/SKILL.md'
            path.write_text(path.read_text() + f'- [ ] PDH-{stage}: 追加の証拠がある\n')
        for status in ('human-review', 'close'):
            for stage in STAGES[:7]:
                with self.subTest(status=status, stage=stage):
                    self.note(status)
                    file = self.root / self.ticket / 'note.md'
                    full = file.read_text() + ''.join(
                        f'- [x] PDH-{s}: 追加の証拠がある   \n' for s in STAGES[:7])
                    file.write_text(full.replace(f'- [x] PDH-{stage}: 追加の証拠がある   \n', ''))
                    out = self.check(1)
                    self.assertIn(f'PDH-{stage}: 追加の証拠がある', out)
                    # 前の stage では、済んだ印を消す --enter を案内しない。
                    if stage != status:
                        self.assertNotIn('pdh-stage-checklist.sh', out)
                    for mark, suffix in ((' ', ''), ('x', ''), ('-', ' - skip: 適用外')):
                        file.write_text(full.replace(f'- [x] PDH-{stage}: 追加の証拠がある   ',
                                                    f'- [{mark}] PDH-{stage}: 追加の証拠がある{suffix}   '))
                        self.check()

    def test_past_stage_without_definition_fails(self):
        # skill から前の stage の行が消えたら、照合を省かずに落とす。
        self.note('human-review')
        for content in (None, '# 行なし\n'):
            with self.subTest(content=content):
                path = self.root / '.claude/skills/pdh-verify/SKILL.md'
                if content is None:
                    path.unlink()
                else:
                    path.write_text(content)
                self.assertIn('PDH-verify', self.check(1))

    def test_close_requires_human_review_lines(self):
        self.note('close')
        self.check()
        file = self.root / self.ticket / 'note.md'
        file.write_text(file.read_text().replace('- [x] PDH-human-review: 証拠がある\n', ''))
        self.assertIn('PDH-human-review', self.check(1))

    def test_octopus_merge_is_counted(self):
        self.write('code', 'feature\n')
        self.commit('feature change')
        anchor = self.sha()
        for name in ('a', 'b'):
            self.run_cmd('git', 'checkout', '-qb', name, anchor)
            self.write(name, name + '\n')
            self.commit(name)
        self.run_cmd('git', 'checkout', '-q', 'features/sample')
        self.run_cmd('git', 'merge', '--no-ff', '--no-commit', 'a', 'b')
        self.write('code', 'octopus\n')
        self.commit('octopus with change')
        merge = self.sha()
        self.write(f'{self.ticket}/progress.md', f'close-gate-sha: {anchor}\n')
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--commits')
        self.assertIn(merge, result.stdout)
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--stat')
        self.assertIn('3 ファイル', result.stdout)

    def test_why_evidence_only_on_this_branch(self):
        # 別の branch の旧い ticket が根拠の 2 行を持たなくても、この branch の検査を落とさない。
        self.write('tickets/other/ticket.md', '---\nbranch: features/other\n---\n### Why\n旧い書式\n### What\n- [ ] 何か\n')
        self.write('tickets/other/progress.md', '')
        self.check()
        self.run_cmd('git', 'add', '.')
        self.run_cmd('git', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'other')
        self.run_cmd('git', 'checkout', '-qb', 'features/other')
        self.assertIn('tickets/other/ticket.md', self.check(1))

    def test_long_checklist_preserves_stage_lines(self):
        self.note('human-review')
        file = self.root / self.ticket / 'note.md'
        file.write_text(file.read_text() + ('x' * 100 + '\n') * 3000)
        self.check()

    def test_long_checklist_preserves_pr_merge_wait(self):
        self.write('.ticket-config.yaml', 'github_bot:\n  close: pr-merge\n')
        self.note('human-review', '- [-] close の回答待ち 発行先: https://example.invalid/pull/1 - skip: close の承認は PR の merge で受ける')
        file = self.root / self.ticket / 'note.md'
        file.write_text(file.read_text() + ('x' * 100 + '\n') * 3000)
        self.check()

    def test_pr_merge_wait_accepts_url_path_and_punctuation(self):
        self.write('.ticket-config.yaml', 'github_bot:\n  close: pr-merge\n')
        for target in ('https://github.com/example/project/pull/1#issuecomment-100',
                       'https://github.com/example/project/issues/1#issuecomment-100', '/board/answer'):
            with self.subTest(target=target):
                self.note('human-review', f'- [-] close の回答待ち 発行先: {target}。 - skip: close の承認は PR の merge で受ける。')
                self.check()
        self.note('human-review', '- [-] close の回答待ち 発行先: - skip: close の承認は PR の merge で受ける')
        self.assertIn('pr-merge の承認待ちの行の形が違う（例:', self.check(1))

    def test_checklist_heading_boundaries(self):
        self.note('human-review')
        file = self.root / self.ticket / 'note.md'
        full = file.read_text()
        for heading in ('### 詳細', '#### 詳細'):
            with self.subTest(heading=heading):
                file.write_text(full.replace('## Checklist\n', f'## Checklist\n{heading}\n'))
                self.check()
        for heading in ('# 次の節', '## 次の節'):
            with self.subTest(heading=heading):
                file.write_text(full.replace('## Checklist\n', f'## Checklist\n{heading}\n'))
                self.check(1)

    def test_enter_keeps_subheadings_inside_checklist(self):
        for heading in ('### 詳細', '#### 詳細'):
            with self.subTest(heading=heading):
                self.write(f'{self.ticket}/note.md', f'## Status: PDH-implement\n## Checklist\n{heading}\n- [x] PDH-implement: 古い行\n# 次の節\n- [x] PDH-implement: 節の外\n')
                self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-implement', '--enter', f'{self.ticket}/note.md')
                content = (self.root / self.ticket / 'note.md').read_text()
                self.assertNotIn('古い行', content)
                self.assertIn(f'{heading}\n- [ ] PDH-implement: 証拠がある\n# 次の節', content)
                self.assertIn('- [x] PDH-implement: 節の外', content)

    def test_nested_merge_conflict_resolution_is_reviewed(self):
        self.write('code', 'feature\n')
        self.commit('feature change')
        anchor = self.sha()
        self.run_cmd('git', 'checkout', '-qb', 'child')
        self.write('child', 'child\n')
        self.commit('child change')
        self.run_cmd('git', 'checkout', '-q', 'main')
        self.write('code', 'base\n')
        self.commit('base change')
        self.run_cmd('git', 'checkout', '-q', 'child')
        self.run_cmd('git', 'merge', '--no-ff', 'main', code=1)
        self.write('code', 'nested resolution\n')
        self.commit('nested conflict resolution')
        merge = self.sha()
        self.run_cmd('git', 'checkout', '-q', 'features/sample')
        self.run_cmd('git', 'merge', '--no-ff', '-m', 'merge child', 'child')
        outer_merge = self.sha()
        self.write(f'{self.ticket}/progress.md', f'close-gate-sha: {anchor}\n')
        # 同じ到達範囲の child commit と競合解消が揃い、空の outer merge は含まない。
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--commits')
        self.assertIn(merge, result.stdout)
        self.assertNotIn(outer_merge, result.stdout)
        self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--prompt')
        # --remerge-diff が無い Git でも nested merge を含める。
        self.write('bin/git', '#!/bin/sh\nfor arg do [ "$arg" != --remerge-diff ] || exit 129; done\nexec ' + shutil.which('git') + ' "$@"\n')
        (self.root / 'bin/git').chmod(0o755)
        self.env['PATH'] = str(self.root / 'bin') + os.pathsep + self.env['PATH']
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--commits')
        self.assertIn(merge, result.stdout)
        self.assertIn(outer_merge, result.stdout)
        # base に入った child の merge は、古い Git でも区間から除く。
        self.run_cmd('git', 'branch', '-f', 'main', merge)
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--commits')
        self.assertNotIn(merge + ' ', result.stdout)
        self.assertIn(outer_merge, result.stdout)

    def test_06_dirty_upstream(self):
        upstream = self.root / 'upstream'
        upstream.mkdir()
        self.run_cmd('git', '-C', str(upstream), 'init', '-q', '-b', 'main')
        self.write('upstream/source', 'committed\n')
        self.run_cmd('git', '-C', str(upstream), 'add', '.')
        self.run_cmd('git', '-C', str(upstream), '-c', 'commit.gpgsign=false', 'commit', '-qm', 'upstream')
        self.write('mapping.tsv', 'source\tlocal\n')
        for operation in ('modified', 'staged', 'untracked', 'deleted'):
            with self.subTest(operation=operation):
                self.write('upstream/source', 'dirty\n')
                self.write('local', 'dirty\n')
                if operation == 'staged':
                    self.run_cmd('git', '-C', str(upstream), 'add', 'source')
                if operation == 'untracked':
                    self.run_cmd('git', '-C', str(upstream), 'rm', '--cached', 'source')
                if operation == 'deleted':
                    (upstream / 'source').unlink()
                self.run_cmd('bash', 'scripts/pdh-lock.sh', 'write', '--upstream', str(upstream), '--map', str(self.root / 'mapping.tsv'), code=2)
                self.run_cmd('git', '-C', str(upstream), 'reset', '--hard', '-q', 'HEAD')

    def test_07_tickets_dir(self):
        shutil.move(self.root / 'tickets', self.root / 'tasks')
        self.ticket = 'tasks/sample'
        self.write('.ticket-config.yaml', 'tickets_dir: "tasks" # custom\nbranch_prefix: features/\n')
        self.note('implement')
        (self.root / self.ticket / 'progress.md').unlink()
        self.assertIn('progress.md が無い', self.check(1))

    def test_07_tickets_dir_range(self):
        shutil.move(self.root / 'tickets', self.root / 'tasks')
        self.ticket = 'tasks/sample'
        self.write('.ticket-config.yaml', 'tickets_dir: tasks\n')
        self.commit('custom ticket root')
        anchor = self.sha()
        self.write(f'{self.ticket}/progress.md', f'close-gate-sha: {anchor}\n記録\n')
        self.commit('record only')
        result = self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'close-gate', '--commits')
        self.assertEqual(result.stdout, '')

    def test_07_custom_root_default_prefix(self):
        shutil.move(self.root / 'tickets', self.root / 'tasks')
        self.ticket = 'tasks/sample'
        self.write('.ticket-config.yaml', 'tickets_dir: ./tasks/\n')
        file = self.root / self.ticket / 'ticket.md'
        file.write_text(file.read_text().replace('branch: features/sample\n', ''))
        (self.root / self.ticket / 'progress.md').unlink()
        self.assertIn('progress.md が無い', self.check(1))

    def test_07_custom_root_done(self):
        shutil.move(self.root / 'tickets', self.root / 'tasks')
        self.ticket = 'tasks/sample'
        self.write('.ticket-config.yaml', 'tickets_dir: tasks\nbranch_prefix: features/\n')
        self.commit('custom root')
        (self.root / 'tasks/done').mkdir()
        shutil.move(self.root / self.ticket, self.root / 'tasks/done/sample')
        self.ticket = 'tasks/done/sample'
        self.commit('move to done')
        self.write(f'{self.ticket}/progress.md', '')
        self.assertIn('close 前 review', self.check(1))

    def test_07_show_custom_root(self):
        shutil.move(self.root / 'tickets', self.root / 'tasks')
        self.write('.ticket-config.yaml', 'tickets_dir: tasks\nbranch_prefix: features/\n')
        result = self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', '--show')
        self.assertIn('ticket: sample', result.stdout)

    def test_08_show_frontmatter_branch(self):
        self.run_cmd('git', 'checkout', '-qb', 'agent/issue-42')
        file = self.root / self.ticket / 'ticket.md'
        file.write_text(file.read_text().replace('features/sample', 'agent/issue-42'))
        result = self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', '--show')
        self.assertIn('ticket: sample', result.stdout)

    def test_09_verify_does_not_require_close_review_yet(self):
        # PDH-verify の test-all は close 前 review より先に回る。ここで落とすと verify が進めない。
        self.note('verify')
        self.write(f'{self.ticket}/progress.md', '')
        self.check()

    def test_10_missing_stage_script(self):
        (self.root / 'scripts/pdh-stage-checklist.sh').unlink()
        self.assertIn('pdh-stage-checklist.sh', self.check(1))

    def test_10_trailing_space(self):
        file = self.root / self.ticket / 'note.md'
        file.write_text(file.read_text().replace('証拠がある\n', '証拠がある   \n'))
        self.check()

    def test_10_range_usage(self):
        self.run_cmd('bash', 'scripts/pdh-review-range.sh', code=64)
        self.run_cmd('bash', 'scripts/pdh-review-range.sh', self.ticket, '--from', 'bad', '--stat', code=64)

    def test_10_enter_continuation_and_heading(self):
        self.write(f'{self.ticket}/note.md', '## Checklist\n- [x] PDH-implement: 古い\n  古い証拠\n\n# 別の節\n- [x] PDH-implement: 節外の行\n')
        self.run_cmd('bash', 'scripts/pdh-stage-checklist.sh', 'PDH-implement', '--enter', f'{self.ticket}/note.md')
        text = (self.root / self.ticket / 'note.md').read_text()
        self.assertNotIn('古い証拠', text)
        self.assertTrue(text.endswith('# 別の節\n- [x] PDH-implement: 節外の行\n'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
