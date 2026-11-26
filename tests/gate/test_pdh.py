import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TICKET_NAME = "261125-120000-fix-login"
WORK = f"work/{TICKET_NAME}"
TICKET = f"tickets/{TICKET_NAME}"
CRITERION = "利用者が結果を確認できる"
COMPARISON = ("上流は位置の代わりに範囲を返す", "元の意味を保つが位置を返せない", "範囲を返せるが値の意味が変わる")
COUNTEREXAMPLE = "- 問題なし | {revision} | 一覧を再読込した | 結果が残った | 継続\n"


CHECKED = "- [x] 結果を判別できる。\n  根拠: 表示に対象の名前がある。\n"


class GateTest(unittest.TestCase):
    def setUp(self):
        self.ticket = WORK
        temporary_root = ROOT / "tmp"
        temporary_root.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix="pdh-test-", dir=temporary_root)
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "PDH Test")
        self.git("config", "user.email", "pdh@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.write("product-brief.md", "# Brief\n")
        self.write(f"{WORK}/checklist.md", CHECKED)
        self.write(f"{WORK}/scope.md", f"- {CRITERION}\n")
        self.write("scripts/test-all.sh", "#!/usr/bin/env bash\nexit 0\n")
        self.write("scripts/pdh.py", '# Previous gate\nREAGREEMENT_FORMAT = ()\n')
        self.agreed = self.commit("Original agreement")
        (self.repo / "scripts/pdh-checks").mkdir()
        for script in ("scripts/pdh.py", "scripts/check_ticket_name.py",
                       "scripts/pdh-checks/ticket-name.sh", "scripts/pdh-checks/check-headers.sh",
                       "scripts/pdh-checks/verify-checklist.sh"):
            shutil.copyfile(ROOT / script, self.repo / script)
        self.record_progress(f"当初の合意は {self.agreed}。\n")
        self.commit("Record original agreement")

    def git(self, *args):
        result = subprocess.run(
            ["git", *args], cwd=self.repo, capture_output=True, text=True, check=True
        )
        return result.stdout.strip()

    def write(self, name, contents):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8")

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-qm", message)
        return self.git("rev-parse", "HEAD")

    def gate(self, command, *, success=True):
        result = subprocess.run(
            [sys.executable, "scripts/pdh.py", command, self.ticket, self.agreed],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)
        return result.stderr

    def run_suite(self):
        self.gate("test")
        return (self.repo / self.ticket / "suite-pass").read_text(encoding="utf-8").strip()

    def record_evidence(self, revision, counterexample=""):
        section = f"\n## 反例確認\n{counterexample}" if counterexample else ""
        self.write(
            f"{self.ticket}/evidence.md",
            f"- {CRITERION} | {revision} | 一覧に期待した結果が表示された\n{section}",
        )
        self.commit("Record evidence")

    def record_progress(self, contents):
        self.write(f"{WORK}/progress.md", contents)

    def record_reagreement(self, revised, response, comparison=COMPARISON):
        with (self.repo / self.ticket / "progress.md").open("a", encoding="utf-8") as progress:
            fields = ("- 再合意", self.agreed, revised, *comparison, response)
            progress.write(" | ".join(fields) + "\n")

    def move_ticket(self):
        self.ticket = TICKET
        (self.repo / "tickets").mkdir(exist_ok=True)
        self.git("mv", WORK, self.ticket)
        self.commit("Move ticket")

    def test_moved_ticket_reads_original_scope_and_checks_current_scope(self):
        self.move_ticket()
        revision = self.run_suite()
        self.record_evidence(revision, COUNTEREXAMPLE.format(revision=revision))
        self.gate("ready")

        scope = f"{self.ticket}/scope.md"
        self.write(scope, "- Changed scope\n")
        self.git("add", scope)
        self.write(scope, f"- {CRITERION}\n")
        self.assertIn("differs from the agreement", self.gate("ready", success=False))

        self.git("checkout", "--", scope)
        self.commit("Change moved scope without approval")
        self.assertIn("no committed re-agreement", self.gate("test", success=False))

    def test_agreement_prefers_ticket_scope_when_both_paths_exist(self):
        self.ticket = TICKET
        scope = f"{self.ticket}/scope.md"
        self.write(scope, "- Scope agreed under tickets\n")
        self.agreed = self.commit("Agree while both paths exist")
        self.gate("test")
        self.write(scope, f"- {CRITERION}\n")
        self.commit("Replace approved scope with legacy scope")
        self.assertIn("no committed re-agreement", self.gate("test", success=False))

    def test_moved_ticket_reads_reagreement_committed_before_the_move(self):
        self.write(f"{WORK}/scope.md", "- Apply the revised scope\n")
        revised = self.commit("Revise legacy scope")
        self.record_reagreement(revised, "変更案を承認")
        self.commit("Record scope approval")
        self.move_ticket()
        self.gate("test")

    def test_ticket_tests_retain_suite_pass_but_require_fresh_evidence(self):
        self.move_ticket()
        harness = f"{self.ticket}/tests/check.py"
        self.write(harness, "# first version\n")
        self.commit("Add ticket harness")
        suite_revision = self.run_suite()
        self.record_evidence(suite_revision, COUNTEREXAMPLE.format(revision=suite_revision))
        self.gate("ready")

        self.write(harness, "# edited version\n")
        self.assertIn(harness, self.gate("ready", success=False))
        revision = self.commit("Edit ticket harness")
        self.assertIn(suite_revision, self.gate("ready", success=False))
        self.record_evidence(revision, COUNTEREXAMPLE.format(revision=suite_revision))
        self.assertIn(suite_revision, self.gate("ready", success=False))
        self.record_evidence(revision, COUNTEREXAMPLE.format(revision=revision))
        self.gate("ready")

        untracked = f"{self.ticket}/tests/input.txt"
        self.write(untracked, "uncommitted test input\n")
        self.assertIn(untracked, self.gate("ready", success=False))
        (self.repo / untracked).unlink()

        self.write("web/tests/app.test.ts", "// edited application test\n")
        revision = self.commit("Edit application test")
        self.record_evidence(revision, COUNTEREXAMPLE.format(revision=revision))
        self.assertIn("web/tests/app.test.ts", self.gate("ready", success=False))
        self.assertEqual((self.repo / self.ticket / "suite-pass").read_text().strip(), suite_revision)

    def test_name_checker_checks_calendar_and_matches_exception_names_literally(self):
        self.write("tickets/ignore.md", "- m4-follow\n- issue-*\n")
        cases = {
            "tickets/240229-235959-fix-login": 0,
            "tickets/250229-235959-fix-login": 1,
            "tickets/261125-250000-fix-login": 1,
            "tickets/261125-120000-Fix_Login": 1,
            "tickets/m4-follow": 0,
            "tickets/m4-follow-copy": 1,
            "tickets/issue-12": 1,
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                result = subprocess.run([sys.executable, "scripts/check_ticket_name.py", path],
                                        cwd=self.repo, capture_output=True)
                self.assertEqual(result.returncode, expected, result.stderr)

    def test_bad_name_is_rejected_by_both_commands_before_the_suite_runs(self):
        self.ticket = "tickets/old-name"
        self.write(f"{self.ticket}/scope.md", f"- {CRITERION}\n")
        self.write("scripts/test-all.sh", "#!/usr/bin/env bash\ntouch suite-ran\n")
        self.agreed = self.commit("Start a ticket with an invalid name")
        for command in ("test", "ready"):
            with self.subTest(command=command):
                self.assertIn("old-name", self.gate(command, success=False))
        self.assertFalse((self.repo / "suite-ran").exists())
        self.assertFalse((self.repo / self.ticket / "suite-pass").exists())

    def test_name_exception_still_requires_fresh_passing_evidence(self):
        self.ticket = "tickets/old-name"
        self.write(f"{self.ticket}/scope.md", f"- {CRITERION}\n")
        self.write(f"{self.ticket}/checklist.md", CHECKED)
        self.agreed = self.commit("Start an irregularly named ticket")
        exception = "tickets/ignore.md"
        self.write(exception, "- old-name\n")
        self.assertIn("uncommitted paths", self.gate("test", success=False))
        self.commit("Record an exact naming exception")
        revision = self.run_suite()
        counterexample = COUNTEREXAMPLE.format(revision=revision)
        self.assertIn("evidence.md", self.gate("ready", success=False))
        self.write(f"{self.ticket}/evidence.md", f"## 反例確認\n{counterexample}")
        self.assertIn("missing evidence", self.gate("ready", success=False))
        self.write(f"{self.ticket}/evidence.md", f"- Failed criterion | {revision} | failed\n")
        self.assertIn("unexpected or duplicate criterion", self.gate("ready", success=False))
        self.record_evidence(revision, counterexample.replace("問題なし", "未確認"))
        self.assertIn("未確認", self.gate("ready", success=False))
        self.record_evidence(revision, counterexample)
        self.gate("ready")
        self.write(exception, "- old-name\n- another-name\n")
        self.commit("Record an unrelated name exception")
        self.gate("ready")
        self.write(exception, "- another-name\n")
        self.assertIn("uncommitted paths", self.gate("ready", success=False))

    def test_added_check_runs_once_per_gate_even_for_a_name_exception(self):
        self.ticket = "tickets/custom"
        self.write(f"{self.ticket}/scope.md", f"- {CRITERION}\n")
        self.write(f"{self.ticket}/checklist.md", CHECKED)
        self.write("tickets/ignore.md", "- custom\n")
        check = "scripts/pdh-checks/verify-arguments.sh"
        header = '# 検査: 渡された引数を記録する。\n# 理由: 呼び出し規約を確認する。\n'
        self.write(check, header + 'printf "%s %s\\n" "$1" "$2" >> .git/check-runs\n')
        self.agreed = self.commit("Add a check alongside the ticket-name check")
        revision = self.run_suite()
        self.record_evidence(revision, COUNTEREXAMPLE.format(revision=revision))
        self.gate("ready")
        runs = (self.repo / ".git/check-runs").read_text().splitlines()
        self.assertEqual(runs, [f"{self.ticket} {self.agreed}"] * 2)
        self.write(check, header + "exit 7\n")
        self.commit("Make the added check fail")
        for command in ("test", "ready"):
            self.assertIn(f"{check}: check failed (exit 7)", self.gate(command, success=False))

    def test_ready_checks_each_qualitative_decision_without_repeating_the_suite(self):
        self.move_ticket()
        path = f"{self.ticket}/checklist.md"
        pending = "## 表示\n\n- [ ] 見分けられるか\n"
        self.write(path, pending)
        revision = self.run_suite()
        self.record_evidence(revision, COUNTEREXAMPLE.format(revision=revision))
        self.assertIn("checklist.md:3: 未チェック", self.gate("ready", success=False))
        for invalid in ("# 見出しだけ\n", "- [?] 表示\n", "- [x] 表示\n",
                        "- [-] 表示\n  根拠:   \n", CHECKED + "- [ ] 残件\n"):
            with self.subTest(invalid=invalid):
                self.write(path, invalid)
                self.assertIn("checklist.md:", self.gate("ready", success=False))
        (self.repo / path).unlink()
        self.assertIn("checklist.md が必要", self.gate("ready", success=False))
        self.write(path, CHECKED + "- [-] 送信\n  根拠: 今回は閲覧だけ。\n")
        self.assertIn("commit", self.gate("ready", success=False))
        self.commit("Record checklist decisions")
        self.gate("ready")

    def test_check_headers_reject_missing_empty_or_misplaced_explanations(self):
        path = "scripts/pdh-checks/check-headers.sh"
        script = (self.repo / path).read_text()
        shebang, rule, reason, body = script.split("\n", 3)
        for header in ([shebang, rule], [rule, "# 理由:   "], [reason, rule], [":", rule, reason]):
            with self.subTest(header=header):
                self.write(path, "\n".join([*header, body]))
                self.commit("Change the header check's own explanation")
                for command in ("test", "ready"):
                    self.assertIn(f"{path}: 冒頭", self.gate(command, success=False))

    def test_new_paths_outside_tickets_are_rejected_even_with_exception(self):
        self.write("tickets/ignore.md", f"- {TICKET_NAME}\n")
        for path in (f"other/{TICKET_NAME}", WORK):
            with self.subTest(path=path):
                self.ticket = path
                self.write(f"{path}/scope.md", "- New scope\n")
                self.agreed = self.commit("Start a ticket outside tickets after the naming policy")
                for command in ("test", "ready"):
                    self.assertIn(path, self.gate(command, success=False))

    def test_ready_requires_current_counterexample_with_a_passing_disposition(self):
        self.write("product.txt", "current product\n")
        self.commit("Change product")
        revision = self.run_suite()
        passed = COUNTEREXAMPLE.format(revision=revision)
        accepted = passed.replace("問題なし", "許容").replace("継続", "履歴のみ / 再読込 / 再発時")
        rejected = {
            "old format": "",
            "duplicate": passed + passed,
            "stale version": passed.replace(revision, self.agreed),
            "empty operation": passed.replace("一覧を再読込した", " "),
            "empty observation": passed.replace("結果が残った", " "),
            "empty disposition": passed.removesuffix("継続\n") + "\n",
            "incomplete acceptance": accepted.replace(" / 再発時", ""),
            "empty acceptance field": accepted.replace("再読込 /", " /"),
        }
        for status in ("要修正", "約束変更", "未確認"):
            rejected[status] = passed.replace("問題なし", status)

        for name, record in rejected.items():
            with self.subTest(name=name):
                self.record_evidence(revision, record)
                self.gate("ready", success=False)

        for record in (passed, accepted):
            with self.subTest(record=record):
                self.record_evidence(revision, record)
                self.gate("ready")

    def test_reagreement_requires_basis_both_options_and_choice(self):
        self.write(f"{WORK}/scope.md", "- 利用者が結果の範囲を確認できる\n")
        revised = self.commit("Change the promised result")
        missing_fields = [((), "変更案を承認"), (COMPARISON, "")]
        for i in range(len(COMPARISON)):
            incomplete = list(COMPARISON)
            incomplete[i] = ""
            missing_fields.append((incomplete, "変更案を承認"))
        for comparison, choice in missing_fields:
            with self.subTest(comparison=comparison, choice=choice):
                self.record_progress("")
                self.record_reagreement(revised, choice, comparison)
                self.commit("Record incomplete decision")
                self.gate("test", success=False)

    def test_ticket_started_with_previous_gate_reads_previous_approval(self):
        script = "scripts/pdh.py"
        checker = "scripts/check_ticket_name.py"
        entry = "scripts/pdh-checks/ticket-name.sh"
        (self.repo / entry).unlink()
        (self.repo / checker).unlink()
        self.write(script, "# gate from before the re-agreement format change\n")
        self.agreed = self.commit("Start ticket with the previous gate")
        self.write("product-brief.md", "# Revised brief\n")
        revised = self.commit("Revise brief")
        self.record_reagreement(revised, "改訂を承認", ())
        self.commit("Record approval under the previous format")
        shutil.copyfile(ROOT / script, self.repo / script)
        shutil.copyfile(ROOT / checker, self.repo / checker)
        (self.repo / entry).parent.mkdir(exist_ok=True)
        shutil.copyfile(ROOT / entry, self.repo / entry)
        self.commit("Update PDH")
        self.gate("test")
        self.write("product-brief.md", "# Updated again\n")
        revised_again = self.commit("Change brief after updating PDH")
        self.record_reagreement(revised_again, "次の変更も承認", ())
        self.commit("Add an approval in the obsolete format")
        self.gate("test", success=False)

    def test_changed_brief_requires_committed_current_reagreement(self):
        self.write("product-brief.md", "# Revised brief\n")
        revised = self.commit("Revise brief")
        self.gate("test", success=False)

        self.record_reagreement(revised, "依頼者が Brief の変更を承認した")
        self.gate("test", success=False)
        self.commit("Record explicit approval")

        revision = self.run_suite()
        self.record_evidence(revision, COUNTEREXAMPLE.format(revision=revision))
        self.gate("ready")

        self.write(f"{WORK}/scope.md", f"- {CRITERION}\n- 詳細を確認できる\n")
        self.commit("Revise scope after approval")
        self.gate("ready", success=False)
        self.gate("test", success=False)

    def test_return_to_original_brief_requires_another_reagreement(self):
        self.write("product-brief.md", "# Revised brief\n")
        revised = self.commit("Revise brief")
        self.record_reagreement(revised, "依頼者が Brief の変更を承認した")
        self.commit("Record explicit approval")
        self.gate("test")

        self.write("product-brief.md", "# Brief\n")
        restored = self.commit("Return to original brief")
        self.gate("test", success=False)

        self.record_reagreement(restored, "依頼者が元の Brief に戻すことを承認した")
        self.commit("Record explicit approval to restore brief")
        revision = self.run_suite()
        self.record_evidence(revision, COUNTEREXAMPLE.format(revision=revision))
        self.gate("ready")
