import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TICKET = "261125-120000-pdh-close"
WORK = Path("tickets") / TICKET
CRITERION = "利用者が結果を確認できる"


class TicketIntegrationTest(unittest.TestCase):
    def run_command(self, cwd, *args, success=True, env=None):
        result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=False, env=env)
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0 if success else 1, output)
        return output

    def write(self, cwd, path, text):
        target = cwd / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def commit(self, cwd, message):
        self.run_command(cwd, "git", "add", ".")
        self.run_command(cwd, "git", "commit", "-qm", message)
        return self.run_command(cwd, "git", "rev-parse", "HEAD").strip()

    def test_ticket_worktree_restore_and_normal_close(self):
        temporary_root = ROOT / "tmp"
        temporary_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="pdh-ticket-", dir=temporary_root) as temporary:
            base = Path(temporary) / "base"
            base.mkdir()
            config = (ROOT / ".ticket-config.yaml").read_text(encoding="utf-8")
            base_branch = re.search(r'^default_branch: "([^"]+)"$', config, re.M)[1]
            self.run_command(base, "git", "init", "-qb", base_branch)
            self.run_command(base, "git", "config", "user.name", "PDH Test")
            self.run_command(base, "git", "config", "user.email", "pdh@example.invalid")
            self.run_command(base, "git", "config", "commit.gpgsign", "false")
            for name in ("ticket.sh", ".gitignore", "tickets/.gitignore", "scripts/pdh.py",
                         "scripts/pdh-ticket-ready.sh", "scripts/pdh_decision.py", "scripts/pdh_coverage.py",
                         "scripts/pdh_judge_api.py", "scripts/pdh-prose.txt",
                         "scripts/check_ticket_name.py", "scripts/test-ticket-local.sh"):
                target = base / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
            shutil.copytree(ROOT / "scripts/pdh-checks", base / "scripts/pdh-checks")
            self.write(base, ".ticket-config.yaml",
                       config + 'post_start_command: "echo run >> .post-start"\n')
            (base / "current_ticket").symlink_to((ROOT / "current_ticket").readlink())
            self.write(base, ".git/info/exclude", ".post-start\n")
            self.write(base, "product-brief.md", "# Brief\n")
            self.write(base, "scripts/test-all.sh", "exit 0\n")
            verdict = {"verdict": "present", "criterion": CRITERION,
                       "reason": "結果が表示された", "next": "承認を依頼する"}
            self.write(base, "scripts/pdh_judge_codex.py",
                       f"def judge(packet, criteria):\n    assert {CRITERION!r} in packet\n    return {verdict!r}\n")
            self.commit(base, "Set up isolated PDH")
            self.run_command(base, "./ticket.sh", "new", "pdh-close",
                             "--created-at", "261125-120000")
            self.assertIn("[完了条件](scope.md)", (base / WORK / "ticket.md").read_text())
            table = WORK / "tests/coverage.tsv"
            header = "ac\tscenario\tkind\ttest\n"
            self.assertEqual((base / table).read_text(), header)
            self.assertIn("利用場面の試験計画", (base / WORK / "checklist.md").read_text())
            scope = base / WORK / "scope.md"
            self.assertEqual(scope.read_text(), "## 独立検収\n")
            self.commit(base, "Create ticket with independent acceptance")
            # The new default remains required even when the heading is removed.
            self.write(base, WORK / "scope.md", f"- {CRITERION}\n")
            agreed = self.commit(base, "Record agreed scope")
            rejected = self.run_command(base, "./ticket.sh", "close", "--no-merge", TICKET, success=False)
            self.assertIn("PDH independent acceptance requires", rejected)

            self.write(base, WORK / "progress.md", f"- 初回合意 | {agreed}\n")
            self.commit(base, "Record original agreement SHA")

            rejected = self.run_command(base, "./ticket.sh", "close", "--no-merge", TICKET, success=False)
            self.assertIn("PDH independent acceptance requires", rejected)
            self.assertIn("feature worktree", self.run_command(base, "./ticket.sh", "decision", success=False))
            self.assertTrue((base / WORK / "ticket.md").is_file())

            started = self.run_command(base, "./ticket.sh", "start", TICKET)
            self.assertIn("Running post_start_command", started)
            worktree = next(path.parent for path in Path(temporary).rglob(".post-start"))
            restarted = self.run_command(base, "./ticket.sh", "start", TICKET)
            self.assertNotIn("Running post_start_command", restarted)
            self.assertEqual((worktree / ".post-start").read_text(), "run\n")
            self.assertFalse((base / "current_ticket").exists())
            self.assertEqual(self.run_command(worktree, "git", "branch", "--show-current").strip(),
                             f"features/{TICKET}")

            self.assertTrue((worktree / "current_ticket").is_dir())
            for link in ("current-ticket", "current-ticket.md"):
                (worktree / link).unlink()
            self.assertFalse((worktree / "current_ticket").exists())
            self.run_command(worktree, "./ticket.sh", "restore")
            self.assertTrue((worktree / "current_ticket").is_dir())
            probe = WORK / "tests/test-ticket-local.sh"
            self.write(worktree, probe, '#!/usr/bin/env bash\nprintf "%s\\n" "$1"\n')
            (worktree / probe).chmod(0o755)
            self.assertEqual(
                self.run_command(worktree, "./current_ticket/tests/test-ticket-local.sh", "direct"),
                "direct\n",
            )
            self.assertEqual(
                self.run_command(worktree, "./scripts/test-ticket-local.sh", "--", "active"),
                "active\n",
            )

            self.write(worktree, WORK / "checklist.md", "- [ ] 確認する。\n")
            revision = self.commit(worktree, "Add a repeatable ticket test")
            self.run_command(worktree, sys.executable, "scripts/pdh.py", "test", str(WORK), agreed)
            self.run_command(worktree, sys.executable, "scripts/pdh_coverage.py", "observe", str(WORK),
                             "一覧の表示", "一覧に結果の名前が表示された")
            self.write(worktree, table, header + "C1\t一覧を開く\tmanual\t一覧の表示\n")
            self.commit(worktree, "Map the observed result to the agreement")
            self.run_command(worktree, sys.executable, "scripts/pdh_coverage.py", "bind", str(WORK))
            self.write(worktree, WORK / "evidence.md",
                       f"- {CRITERION} | {revision} | 専用試験で結果が表示された\n"
                       f"\n## 反例確認\n- 問題なし | {revision} | 再読込 | 結果が残った | 継続\n")
            feature_before = self.commit(worktree, "Record observations")
            base_before = self.run_command(base, "git", "rev-parse", "HEAD")
            rejected = self.run_command(worktree, "./ticket.sh", "close", success=False)
            self.assertIn(f"{WORK}/checklist.md:1", rejected)
            self.assertEqual(self.run_command(worktree, "git", "rev-parse", "HEAD").strip(),
                             feature_before)
            self.assertEqual(self.run_command(base, "git", "rev-parse", "HEAD"), base_before)

            self.write(worktree, WORK / "checklist.md", "- [x] 確認する。\n  根拠: 結果を再読込した。\n")
            self.write(worktree, WORK / "progress.md",
                       f"- 初回合意 | {agreed}\n- テスト用の完了承認 | {revision}\n")
            self.commit(worktree, "Record checklist and simulated human approval")
            misleading_env = dict(os.environ, TICKET_NAME="wrong-ticket", TICKET_DIR="wrong-directory",
                                  TICKET_FILE="wrong-file", TICKET_BRANCH="wrong-branch")
            rejected = self.run_command(worktree, "./ticket.sh", "close", success=False,
                                        env=misleading_env)
            self.assertIn("decision.json", rejected)
            self.assertEqual(self.run_command(base, "git", "rev-parse", "HEAD"), base_before)

            preview = self.run_command(worktree, "./ticket.sh", "decision")
            packet, end = json.JSONDecoder().raw_decode(preview)
            confirmation = preview[end:]
            self.assertEqual(packet["initial_agreement"], agreed)
            self.assertIn("codex / ", confirmation)
            signature = re.search(r"--send ([a-f0-9]{64})", confirmation)[1]
            self.assertFalse((worktree / WORK / "decision.json").exists())
            sent = self.run_command(worktree, "./ticket.sh", "decision", "--backend", "codex",
                                    "--send", signature)
            self.assertIn(f"present — {CRITERION}", sent)
            receipt = json.loads((worktree / WORK / "decision.json").read_text())
            self.assertEqual(receipt[0]["backend"], "codex")
            self.commit(worktree, "Record independent acceptance")
            closed = self.run_command(worktree, "./ticket.sh", "close")
            self.assertIn("Evidence and full suite recorded", closed)
            self.assertEqual(
                self.run_command(base, "./scripts/test-ticket-local.sh", TICKET, "--", "archived"),
                "archived\n",
            )
