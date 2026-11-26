"""Exercise capture, revision pinning and migration using disposable Git repositories."""
import json
import os
import shutil
import subprocess
import sys
import unittest

import test_pdh as fixture


class CoverageTest(unittest.TestCase):
    git = fixture.GateTest.git
    write = fixture.GateTest.write
    commit = fixture.GateTest.commit
    record_progress = fixture.GateTest.record_progress

    def setUp(self):
        fixture.GateTest.setUp(self)
        self.matrix = self.ticket + "/tests/coverage.tsv"
        self.result = self.repo / self.ticket / "coverage-results.json"
        self.header = "ac\tscenario\tkind\ttest\n"
        self.rows = self.header + "C1\topen\tauto\tcase\nC1\trefresh\tmanual\treader\n"
        for rel in ["scripts/pdh_coverage.py", "scripts/pdh-checks/verify-coverage.sh"]:
            shutil.copyfile(fixture.ROOT / rel, self.repo / rel)
        # Isolated report generator exercises the boundary to heterogeneous JUnit runners.
        self.source = self.ticket + "/tests/runner.py"
        self.write(self.source, """import os, sys
from pathlib import Path
case = os.environ.get("CASE_XML", '<testcase name="case"/>')
Path(sys.argv[1]).write_text("<testsuite>" + case + "</testsuite>")
sys.exit(int(os.environ.get("EXIT", 0)))
""")
        self.commit("Install coverage gate")

    def cli(self, *args, ok=True, env=None):
        proc = subprocess.run([sys.executable, "-B", "scripts/pdh_coverage.py", *args],
                              cwd=self.repo, capture_output=True, text=True,
                              env={**os.environ, **(env or {})})
        self.assertEqual(proc.returncode == 0, ok, proc.stdout + proc.stderr)
        return proc.stderr

    def prepare(self):
        self.write(self.matrix, self.rows)
        self.commit("Map agreed criterion")
        self.collect()
        self.cli("observe", self.ticket, "reader", "two messages appeared after refresh")
        self.cli("bind", self.ticket)
        self.commit("Record both results")

    def verify(self, **kw):
        return self.cli("verify", self.ticket, self.agreed, **kw)

    def test_capture_and_version(self):
        self.prepare()
        self.verify()
        self.write("app.py", "changed = True\n")
        self.commit("Change product")
        self.assertIn("differ", self.verify(ok=False))

    @unittest.skipUnless(shutil.which("node"), "Node required for native JUnit integration")
    def test_native_runner_executes_committed_test(self):
        source = self.ticket + "/tests/name.test.mjs"
        self.write(source, 'import {test} from "node:test";\n'
                           'import assert from "node:assert/strict";\n'
                           'test("adds", () => assert.equal(1 + 2, 3));\n')
        self.write(self.matrix, self.header + "C1\taddition\tauto\ttest::adds\n")
        sha = self.commit("Add native Node test")
        self.cli("collect", self.ticket, "--source", source, "--", "node", "--test",
                 "--test-reporter", "junit", "--test-reporter-destination", "{junit}", source)
        self.cli("bind", self.ticket)
        row, = json.loads(self.result.read_text())["rows"]
        self.assertEqual((row["test"], row["sha"], row["sources"]), ("test::adds", sha, [source]))
        self.commit("Save native observations")
        self.verify()

    def collect(self, *options, **kw):
        return self.cli("collect", self.ticket, "--source", self.source, "--", sys.executable,
                        self.source, "{junit}", *options, **kw)

    def test_run_before_mapping_then_add_only_missing_probe(self):
        self.write(self.matrix, self.header)
        self.write(self.ticket + "/tests/helper.feature", "Feature: refresh\n")
        first = self.commit("Agree and implement use case first")
        self.collect()
        self.cli("observe", self.ticket, "reader", "reader saw two messages after refresh")
        self.assertFalse(self.result.exists())
        self.write(self.matrix, self.rows + "C1\tresume\tauto\tresume\n")
        self.commit("Map existing tests and identify a gap")
        self.assertIn("resume", self.cli("bind", self.ticket, ok=False))
        self.assertEqual([r["sha"] for r in json.loads(self.result.read_text())["rows"]], [first, first])
        self.write(self.ticket + "/tests/extra.py", (self.repo / self.source).read_text())
        self.commit("Add only the missing probe")
        self.cli("collect", self.ticket, "--source", self.ticket + "/tests/extra.py",
                 "--", sys.executable, self.ticket + "/tests/extra.py", "{junit}",
                 env={"CASE_XML": '<testcase name="resume"/>'})
        self.cli("bind", self.ticket)
        self.commit("Bind use cases to observed revisions")
        self.verify()
        self.write(self.ticket + "/tests/helper.feature", "Feature: changed dependency\n")
        self.commit("Change existing helper")
        self.assertIn("helper.feature", self.cli("bind", self.ticket, ok=False))

    def test_partial_failure_and_filtered_rerun(self):
        self.write(self.matrix, self.rows.replace("manual", "auto"))
        self.commit("Map two executions")
        failed = '<testcase name="reader"><failure/></testcase>'
        self.collect(env={"CASE_XML": '<testcase name="case"/>' + failed, "EXIT": "1"}, ok=False)
        self.assertIn("reader", self.cli("bind", self.ticket, ok=False))
        rows = json.loads(self.result.read_text())["rows"]
        self.assertEqual([row["test"] for row in rows], ["case"])
        self.collect("only-reader", env={"CASE_XML": '<testcase name="reader"/>'})
        self.cli("bind", self.ticket)
        self.commit("Record full coverage")
        self.verify()
        self.collect("only-reader", env={"CASE_XML": '<testcase name="reader"><skipped/></testcase>'})
        self.git("restore", "--", str(self.result))
        self.assertIn("latest execution", self.verify(ok=False))
        self.assertIn("reader", self.cli("bind", self.ticket, ok=False))

    def test_source_added_after_capture_is_not_evidence(self):
        self.prepare()
        added = self.ticket + "/tests/later.robot"
        self.write(added, "*** Test Cases ***\n")
        self.commit("Add unrelated later test")
        results = json.loads(self.result.read_text())
        results["rows"][0]["sources"] = [added]
        self.write(self.result, json.dumps(results))
        self.commit("Reference later test in older observation")
        self.assertIn(added, self.verify(ok=False))

    def test_expected_skipped_failed_missing_and_duplicate(self):
        self.prepare()
        for xml in ('<testcase name="case"><skipped/></testcase>',
                    '<testcase name="case"><error/></testcase>',
                    '<testcase name="case"><failure/></testcase>',
                    '<testcase name="case" status="notrun"/>',
                    '<testcase name="case"/><testcase name="case"/>',
                    '<testcase name="case-longer"/>'):
            with self.subTest(xml=xml):
                self.collect()
                self.collect(env={"CASE_XML": xml})
                self.cli("bind", self.ticket, ok=False)
                saved = json.loads(self.result.read_text())["rows"]
                self.assertEqual([r["test"] for r in saved], ["reader"])
                self.verify(ok=False)
        self.collect()
        self.collect(ok=False, env={"EXIT": "1"})
        self.commit("Record failed rerun")
        self.assertIn("missing", self.verify(ok=False))

    def test_matrix_change_deletion_and_opt_in(self):
        self.verify()  # Preexisting agreement without the table.
        self.prepare()
        self.write(self.matrix, self.rows.replace("refresh", "reopen"))
        self.commit("Change scenario")
        self.verify(ok=False)
        (self.repo / self.matrix).unlink()
        self.commit("Delete matrix after opting in")
        self.assertIn(self.matrix, self.verify(ok=False))

    def test_new_agreement_requires_matrix(self):
        self.agreed = self.git("rev-parse", "HEAD")
        self.assertIn(self.matrix, self.verify(ok=False))

    def test_unmapped_and_duplicate_results(self):
        self.prepare()
        saved = json.loads(self.result.read_text())
        saved["rows"].append(saved["rows"][0])
        self.write(self.result, json.dumps(saved))
        self.commit("Duplicate result")
        self.assertIn("duplicate", self.verify(ok=False))
        self.write(self.matrix, self.header)
        self.commit("Leave criterion unmapped")
        self.assertIn("missing scenarios for C1", self.verify(ok=False))
