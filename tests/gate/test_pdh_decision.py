"""Exercise the decision command and readiness gate without an external API."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import os
import re
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_pdh as fixture


class DecisionTest(unittest.TestCase):
    git = fixture.GateTest.git
    write = fixture.GateTest.write
    commit = fixture.GateTest.commit
    move_ticket = fixture.GateTest.move_ticket
    record_progress = fixture.GateTest.record_progress
    record_evidence = fixture.GateTest.record_evidence
    gate = fixture.GateTest.gate
    run_suite = fixture.GateTest.run_suite

    def setUp(self):
        fixture.GateTest.setUp(self)
        scripts = ("scripts/pdh_decision.py", "scripts/pdh_judge_api.py", "scripts/pdh-ticket-ready.sh")
        for script in scripts:
            shutil.copyfile(fixture.ROOT / script, self.repo / script)
        transport = self.repo / scripts[1]
        with transport.open("a", encoding="utf-8") as script:
            script.write(f'''
def judge(packet, criteria):
    with open(".git/judge-calls", "a", encoding="utf-8") as calls:
        calls.write("sent\\n")
    return {{
        "verdict": os.environ.get("PDH_FIXTURE_VERDICT", "present"),
        "criterion": {fixture.CRITERION!r},
        "reason": "一覧に期待した結果が表示された",
        "next": "担当者に判定を渡す",
    }}
''')
        self.write("scripts/pdh_judge_codex.py", "from pdh_judge_api import judge\n")
        shutil.copyfile(fixture.ROOT / "scripts/pdh-prose.txt", self.repo / "scripts/pdh-prose.txt")
        self.move_ticket()
        self.write("docs/known-limits.md", "# 現在の制約\n")
        self.commit("Install judge with isolated transport")

    def prepare(self, *, opt_in=True):
        if opt_in:
            self.write(f"{self.ticket}/scope.md", f"## 独立検収\n\n- {fixture.CRITERION}\n")
            self.agreed = self.commit("Agree to independent judgment")
            self.write(f"{self.ticket}/progress.md", f"- 初回合意 | {self.agreed}\n")
            self.commit("Record the original agreement")
        self.refresh_evidence()

    def refresh_evidence(self):
        revision = self.run_suite()
        self.record_evidence(revision, fixture.COUNTEREXAMPLE.format(revision=revision))

    def decision(self, *args, verdict="present", success=True):
        result = subprocess.run(
            [sys.executable, "scripts/pdh.py", "decision", self.ticket, self.agreed, *args],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "PDH_FIXTURE_VERDICT": verdict},
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def close_hook(self, *, success):
        result = subprocess.run(
            ["bash", "scripts/pdh-ticket-ready.sh"],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "TICKET_NAME": fixture.TICKET_NAME, "TICKET_DIR": self.ticket},
        )
        self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)

    def preview(self):
        result = self.decision()
        packet = json.loads(result.stdout)
        self.assertIn(fixture.CRITERION, json.dumps(packet, ensure_ascii=False))
        digest = re.search(r"--send ([0-9a-f]{64})\b", result.stderr)
        self.assertIsNotNone(digest, result.stderr)
        return digest.group(1)

    @property
    def record(self):
        return self.repo / self.ticket / "decision.json"

    def calls(self):
        log = self.repo / ".git/judge-calls"
        return log.read_text(encoding="utf-8").splitlines() if log.exists() else []

    def submit(self, *, verdict="present"):
        digest = self.preview()
        self.decision("--send", digest, verdict=verdict, success=verdict == "present")
        self.assertTrue(self.record.is_file())
        self.commit("Record independent judgment")
        return digest

    def test_coverage_packet_signs_committed_results_and_unchanged_test_sources(self):
        self.review_coverage()

    def test_coverage_can_supply_observations_after_a_legacy_hold(self):
        self.review_coverage(legacy_hold=True)

    def review_coverage(self, *, legacy_hold=False):
        # Establish the application test before the agreement so it is absent from the diff.
        source = "app_test.go"
        code = "func TestVisibleResult(t *testing.T) { assertVisibleResult(t) }\n"
        self.write(source, code)
        self.write("unrelated.txt", "private local reference\n")
        self.commit("Add an existing application test")
        self.prepare()
        if legacy_hold:
            diagnostic = self.decision("--backend", "responses").stderr
            signature = re.search(r"--send ([0-9a-f]{64})", diagnostic).group(1)
            self.decision("--backend", "responses", "--send", signature, verdict="hold", success=False)
            self.commit("Commit judgment before coverage")

        matrix = f"{self.ticket}/tests/coverage.tsv"
        results = f"{self.ticket}/coverage-results.json"
        mapping = ["C1", "結果を表示", "auto", "visible-result"]
        self.write(matrix, "ac\tscenario\tkind\ttest\n" + "\t".join(mapping) + "\n")
        row = {"test": "visible-result", "mode": "auto", "sha": self.git("rev-parse", "HEAD"),
               "observation": "一覧を開くと結果を確認できた", "mapping": [mapping],
               "runner": ["go", "test", "./..."], "junit": '<testcase name="TestVisibleResult"/>',
               "sources": [source]}
        self.write(results, json.dumps({"rows": [row]}, ensure_ascii=False))
        self.commit("Record coverage")

        sys.path.insert(0, str(fixture.ROOT / "scripts"))
        self.addCleanup(sys.path.remove, str(fixture.ROOT / "scripts"))
        import pdh_decision
        import pdh_judge_api

        def git(*args):
            return subprocess.run(
                ["git", "--literal-pathspecs", *args], cwd=self.repo, check=True, capture_output=True,
            ).stdout

        def changed(old, new):
            return set(git("diff", "--name-only", old, new).decode().splitlines())

        def review(send=None, command="decision"):
            out, err = StringIO(), StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                pdh_decision.review(
                    command, self.repo, self.ticket, self.agreed, self.agreed,
                    self.git("rev-parse", "HEAD"), {fixture.CRITERION}, send,
                    git, changed, lambda: None, "responses", coverage=True,
                )
            return out.getvalue(), err.getvalue()

        preview, diagnostic = review()
        payload = json.loads(preview)
        self.assertEqual(json.loads(payload["materials"][results]), {"rows": [row]})
        self.assertIn(matrix, payload["materials"])
        self.assertEqual(payload["coverage_test_sources"], {source: code})
        self.assertNotIn(code, payload["diff"])
        self.assertNotIn("private local reference", preview)
        signature = re.search(r"--send ([0-9a-f]{64})", diagnostic).group(1)
        packet = pdh_decision.encode(payload)
        request = {
            "model": pdh_judge_api.MODEL, "instructions": pdh_judge_api.COVERAGE_INSTRUCTIONS,
            "packet": packet, "backend": "responses", "effort": pdh_judge_api.EFFORT,
            "schema": pdh_judge_api.verdict_schema(payload["criteria"]),
        }
        self.assertEqual(signature, pdh_decision.digest(pdh_decision.encode(request)))
        if legacy_hold:
            self.assertEqual(payload["recheck"]["previous_coverage_observations"], [])
            return

        verdict = {"verdict": "hold", "criterion": fixture.CRITERION,
                   "reason": "比較対象が不明", "next": "期待する結果と画面を合わせる"}
        with patch.object(pdh_decision, "judge", return_value=verdict) as judge:
            with self.assertRaisesRegex(ValueError, "hold"):
                review(signature)
        judge.assert_called_once_with(packet, payload["criteria"])
        self.commit("Commit coverage review")

        row["sha"] = self.git("rev-parse", "HEAD")
        self.write(results, json.dumps({"rows": [row]}, ensure_ascii=False))
        self.commit("Refresh coverage version")
        with self.assertRaisesRegex(ValueError, "新しい観察"):
            review()
        mapping[1] = "操作結果を表示"
        self.write(matrix, "ac\tscenario\tkind\ttest\n" + "\t".join(mapping) + "\n")
        self.write(results, json.dumps({"rows": [row]}, ensure_ascii=False))
        self.commit("Rename scenario only")
        with self.assertRaisesRegex(ValueError, "新しい観察"):
            review()
        self.write(source, code.replace("assertVisibleResult", "assertExactExpectedResult"))
        row["sha"] = self.commit("Check the exact displayed result")
        self.write(results, json.dumps({"rows": [row]}, ensure_ascii=False))
        self.commit("Capture rerun of the changed check")
        next_preview, diagnostic = review()
        recheck = json.loads(next_preview)["recheck"]
        self.assertEqual(recheck["previous_coverage_observations"],
                         [["結果を表示", "一覧を開くと結果を確認できた"]])
        next_signature = re.search(r"--send ([0-9a-f]{64})", diagnostic).group(1)
        with patch.object(pdh_decision, "judge", return_value={**verdict, "verdict": "present"}) as judge:
            with self.assertRaisesRegex(ValueError, "ハッシュ"):
                review(signature)
            judge.assert_not_called()
            review(next_signature)
        self.commit("Commit followup review")
        review(command="ready")

    def test_opt_in_requires_a_committed_result_and_progress_does_not_invalidate_it(self):
        self.prepare()
        self.close_hook(success=False)
        digest = self.preview()
        self.assertEqual(self.calls(), [])
        self.assertFalse(self.record.exists())
        wrong_digest = "0" * 64 if digest != "0" * 64 else "1" * 64
        self.decision("--send", wrong_digest, success=False)
        self.assertEqual(self.calls(), [])

        self.decision("--send", digest)
        self.assertEqual(self.calls(), ["sent"])
        self.gate("ready", success=False)
        self.commit("Record independent judgment")
        self.close_hook(success=True)

        self.write(f"{self.ticket}/progress.md", f"- 初回合意 | {self.agreed}\n- 完了承認を記録\n")
        self.commit("Record approval in progress")
        self.gate("ready")
        self.assertEqual(self.preview(), digest)

        self.record.unlink()
        self.commit("Remove the required judgment")
        self.gate("ready", success=False)
        self.decision(success=False)
        self.decision("--send", digest, success=False)
        self.assertEqual(self.calls(), ["sent"])
        self.assertFalse(self.record.exists())

    def test_scope_without_opt_in_can_pass_without_any_independent_result(self):
        self.prepare(opt_in=False)
        self.gate("ready")
        self.assertEqual(self.calls(), [])
        self.assertFalse(self.record.exists())

    def test_hold_is_reused_and_blocks_ready(self):
        self.prepare()
        digest = self.submit(verdict="hold")
        self.gate("ready", success=False)
        record_before = self.record.read_bytes()
        # Ask the stub for present on a second call, which must reuse the original hold.
        self.decision("--send", digest, success=False)
        self.assertEqual(self.calls(), ["sent"])
        self.assertEqual(self.record.read_bytes(), record_before)
        self.gate("ready", success=False)

    def amend_evidence(self, before, after):
        evidence = self.repo / self.ticket / "evidence.md"
        contents = evidence.read_text(encoding="utf-8")
        self.assertIn(before, contents)
        evidence.write_text(contents.replace(before, after, 1), encoding="utf-8")
        self.commit("Amend candidate evidence")

    def test_hold_allows_one_followup_for_changed_evidence(self):
        self.prepare()
        original_digest = self.submit(verdict="hold")
        self.write("docs/known-limits.md", "# 現在の制約\n\n既存の制約の説明を補足した。\n")
        self.commit("Amend unrelated known limits")
        self.decision(success=False)
        self.decision("--send", original_digest, success=False)
        self.assertEqual(self.calls(), ["sent"])

        self.amend_evidence("## 反例確認", "## 補足\n\n## 反例確認")
        self.decision(success=False)
        self.assertEqual(self.calls(), ["sent"])

        self.amend_evidence("一覧に期待した結果が表示された", "再試験で期待した結果とその更新時刻が表示された")
        self.decision("--send", original_digest, success=False)
        self.assertEqual(self.calls(), ["sent"])
        followup_digest = self.submit(verdict="hold")
        self.assertNotEqual(followup_digest, original_digest)

        saved = self.record.read_bytes()
        self.decision("--send", followup_digest, success=False)
        self.assertEqual(self.record.read_bytes(), saved)
        self.assertEqual(self.calls(), ["sent", "sent"])
        self.gate("ready", success=False)

        self.amend_evidence("結果が残った", "二回目の再読込でも結果が残った")
        self.decision(success=False)
        self.assertEqual(self.calls(), ["sent", "sent"])

    def test_new_flow_cannot_skip_decision_by_omitting_heading(self):
        self.write(f"{self.ticket}/scope.md", f"# AC\n- {fixture.CRITERION}\n")
        self.agreed = self.commit("Agree on scope with current PDH and no review heading")
        self.refresh_evidence()
        self.gate("ready", success=False)
        self.submit()
        self.gate("ready")
        self.assertEqual(json.loads(self.record.read_text())[-1]["backend"], "codex")

    def test_backend_is_bound_to_preview_and_agreement(self):
        self.prepare()
        default_hash = self.preview()
        api_preview = self.decision("--backend", "responses")
        api_hash = re.search(r"--send ([0-9a-f]{64})", api_preview.stderr)[1]
        self.assertNotEqual(api_hash, default_hash)
        self.decision("--send", api_hash, success=False)
        self.assertEqual(self.calls(), [])
        self.decision("--backend", "responses", "--send", api_hash)
        saved = json.loads(self.record.read_text())[-1]
        self.assertEqual((saved["backend"], saved["effort"], saved["criterion_id"]), ("responses", "medium", "C1"))
        self.commit("Record API judgment")
        self.decision("--backend", "codex", success=False)
        self.gate("ready")
        self.assertEqual(self.calls(), ["sent"])

    def test_legacy_api_receipt_is_verified_offline(self):
        import hashlib
        self.prepare()
        packet = json.loads(self.decision().stdout)
        self.submit()
        rows = json.loads(self.record.read_text())
        row = rows[-1]
        del row["backend"], row["effort"], row["criterion_id"]
        del packet["criteria"]
        from scripts.pdh_judge_api import INSTRUCTIONS, MODEL
        def encode(value):
            return json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2)
        def digest(value):
            return hashlib.sha256(encode(value).encode()).hexdigest()
        row["request_sha256"] = digest({"model": MODEL, "instructions": INSTRUCTIONS, "packet": encode(packet)})
        del row["receipt_sha256"]
        row["receipt_sha256"] = digest(row)
        # Replace the first receipt commit with a fixture in the historical format.
        self.git("reset", "--soft", "HEAD^")
        self.record.write_text(encode(rows))
        self.commit("Record pre-Codex API judgment")
        self.gate("ready")
        self.assertEqual(self.calls(), ["sent"])

    def test_human_can_reopen_second_hold_with_new_observation(self):
        self.prepare()
        self.submit(verdict="hold")
        self.amend_evidence("一覧に期待した結果が表示された", "一度目の再試験で時刻も表示された")
        self.submit(verdict="hold")
        receipt = json.loads(self.record.read_text())[-1]["receipt_sha256"]
        progress = self.repo / self.ticket / "progress.md"
        with progress.open("a", encoding="utf-8") as output:
            output.write(f"- 独立検収再開 | {receipt} | 人が同じACで追加の観察を依頼した\n")
        self.commit("Record human restart instruction")
        self.amend_evidence("結果が残った", "人の指定した手順でも結果が残った")
        self.submit()
        self.gate("ready")
        self.assertEqual(self.calls(), ["sent"] * 3)

    def test_changed_evidence_invalidates_preview_and_stored_judgment(self):
        self.prepare()
        digest = self.submit()
        self.amend_evidence("一覧に期待した結果が表示された", "一覧に期待した結果が二件表示された")
        self.gate("ready", success=False)
        self.decision("--send", digest, success=False)
        self.assertEqual(self.calls(), ["sent"])
        self.assertNotEqual(self.preview(), digest)

    def test_changed_known_limits_invalidates_stored_judgment(self):
        self.prepare()
        digest = self.submit()
        self.write("docs/known-limits.md", "# 現在の制約\n\n追加の観察を記録した。\n")
        self.commit("Amend known limits")
        self.gate("ready", success=False)
        self.assertNotEqual(self.preview(), digest)

    def test_changed_product_invalidates_stored_judgment_after_fresh_tests(self):
        self.prepare()
        digest = self.submit()
        self.write("product.txt", "Updated product\n")
        self.commit("Update product")
        self.refresh_evidence()
        self.gate("ready", success=False)
        self.assertNotEqual(self.preview(), digest)

    def test_tampered_record_is_rejected_even_after_commit(self):
        self.prepare()
        self.submit(verdict="hold")
        receipts = json.loads(self.record.read_text(encoding="utf-8"))
        receipts[-1]["result"]["verdict"] = "present"
        self.record.write_text(json.dumps(receipts, ensure_ascii=False) + "\n", encoding="utf-8")
        self.commit("Tamper with the stored verdict")
        self.gate("ready", success=False)
