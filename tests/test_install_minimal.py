"""Exercise the release's ordinary installer and its ticket entrypoints."""

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONFIG = """default_branch: "trunk"
branch_prefix: "features/"
repository: "product-remote"
worktree_mode: true
auto_push: false
delete_remote_on_close: false
pre_close_command: "bash scripts/check-pdh-ticket.sh"
require_checklist: true
require_checklist_groups:
  - "Required-Probes"
  - "Checklist"
post_start_command: "printf preparing"
ticket_files:
  - path: progress.md
    content: |
      # Progress: $$TICKET_NAME$$
note_content: |
  ## Status: PDH-ticket-write

  ## Required-Probes
  - [x] Keep the old probe

  ## Checklist
  - [x] Keep the old checklist
default_content: |
  ### Why
  Keep an old ticket workflow.
"""
OLD_CHECK = """#!/usr/bin/env bash
set -e
printf '%s\\n' legacy-pre-close
ticket_is_on_this_branch() { return 0; }
tickets_dir=tickets
for t in "$tickets_dir"/*/ticket.md; do
  [ -f "$t" ] || continue
  d=${t%/ticket.md}
  ticket_is_on_this_branch "$d" || continue
  seen=1
  printf 'legacy ticket: %s\\n' "$d"
done
"""


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.work = Path(self.scratch.name)
        self.release = self.work / "release"
        self.release.mkdir()
        for name in ("install.py", "migration.py"):
            shutil.copyfile(ROOT / name, self.release / name)
        shutil.copytree(ROOT / "shared", self.release / "shared")
        self.init_repo(self.release)
        template = self.release / "claude/templates/.ticket-config.yaml"
        self.write(template, CONFIG)
        self.commit(self.release, "legacy template")
        self.old_revision = self.run_git(self.release, "rev-parse", "HEAD").strip()
        self.project = self.work / "product"
        self.init_repo(self.project)
        self.write(self.project / "product-brief.md", "# My product\n")
        self.write(self.project / "tickets/README.md", "Product-specific ticket notes.\n")
        self.write(self.project / "scripts/test-all.sh", "#!/bin/sh\nexit 0\n", 0o755)
        self.write(self.project / "scripts/checks/product.sh", "local check\n", 0o755)
        self.write(self.project / ".gitignore", "local-generated.txt\n")
        self.commit(self.project, "product settings")

    def init_repo(self, path):
        path.mkdir(exist_ok=True)
        self.run_git(path, "init", "--initial-branch=trunk")
        self.run_git(path, "config", "user.name", "Fixture")
        self.run_git(path, "config", "user.email", "fixture@example.test")

    @staticmethod
    def write(path, value, mode=0o644):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        path.chmod(mode)

    @staticmethod
    def run_git(path, *args):
        return subprocess.run(
            ["git", "-C", str(path), *args], check=True,
            capture_output=True, text=True,
        ).stdout

    def commit(self, path, message):
        self.run_git(path, "add", "-A")
        self.run_git(path, "commit", "-m", message)

    def install(self, *flags, expect=0):
        result = subprocess.run(
            [sys.executable, str(self.release / "install.py"), "--target", str(self.project), *flags],
            cwd=self.work, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, expect, result.stdout + result.stderr)
        return result

    def ticket(self, *args, extra=None):
        return subprocess.run(
            ["bash", "ticket.sh", *args], cwd=self.project, capture_output=True, text=True,
            env={**os.environ, **(extra or {})},
        )

    def legacy(self, *, bot=False):
        config = CONFIG + (
            "# Based on https://github.com/masuidrive/pdh/blob/"
            f"{self.old_revision}/claude/templates/.ticket-config.yaml\n"
        )
        self.write(self.project / ".ticket-config.yaml", config)
        self.write(self.project / "scripts/check-pdh-ticket.sh", OLD_CHECK, 0o755)
        self.write(self.project / ".pdh-lock", (
            f"# upstream: masuidrive/pdh@{self.old_revision}\n"
            f"scripts/check-pdh-ticket.sh\tclaude/templates/check-pdh-ticket.sh\t"
            f"{hashlib.sha256(OLD_CHECK.encode()).hexdigest()}\n"
        ))
        name = "261125-090000-keep-legacy"
        self.write(self.project / "tickets" / name / "ticket.md", "---\npriority: 2\ncreated_at: '2026-11-25T09:00:00Z'\nstarted_at: null\nclosed_at: null\n---\n\n# Retain\n")
        self.write(self.project / "tickets" / name / "note.md", "## Required-Probes\n- [x] Done\n\n## Checklist\n- [x] Done\n")
        if bot:
            self.write(self.project / ".github/workflows/coding-bot.yml", "name: Existing bot\n")
        self.commit(self.project, "legacy project")
        return name

    def test_fresh_check_is_read_only_and_reapply_is_a_no_op(self):
        status = self.run_git(self.project, "status", "--short")
        checked = self.install("--check")
        self.assertIn("create\tcurrent_ticket", checked.stdout)
        self.assertEqual(self.run_git(self.project, "status", "--short"), status)
        self.assertFalse((self.project / ".ticket-config.yaml").exists())
        self.assertFalse((self.release / "__pycache__").exists())

        self.assertEqual(checked.stdout, self.install().stdout)
        self.assertIn('default_branch: "trunk"', (self.project / ".ticket-config.yaml").read_text())
        self.assertEqual(os.readlink(self.project / "current_ticket"), "current-ticket")
        self.assertEqual(os.readlink(self.project / ".agents/skills/pdh"), "../../.claude/skills/pdh")
        self.assertEqual(os.readlink(self.project / ".agents/skills/pdh-update"), "../../.claude/skills/pdh-update")
        self.assertTrue(os.access(self.project / "ticket.sh", os.X_OK))
        self.assertEqual((self.project / "tickets/README.md").read_text(), "Product-specific ticket notes.\n")
        self.assertEqual((self.project / "scripts/checks/product.sh").read_text(), "local check\n")
        self.assertEqual(self.install().stdout, "PDH already up to date\n")

    def test_fresh_project_can_use_its_unborn_branch(self):
        self.project = self.work / "unborn"
        self.init_repo(self.project)
        self.install()
        self.assertIn('default_branch: "trunk"', (self.project / ".ticket-config.yaml").read_text())
        self.assertEqual(self.install("--check").stdout, "PDH already up to date\n")

    def test_versions_update_only_owned_bytes(self):
        self.install()
        self.commit(self.project, "install")
        new = self.release / "shared/.claude/skills/pdh/SKILL.md"
        new.write_text(new.read_text() + "\nA second release.\n")
        config = self.release / "shared/.ticket-config.yaml"
        config.write_text(config.read_text().replace("## 独立検収", "## 独立検収\n      New shared template line"))
        checked = self.install("--check").stdout
        self.assertIn("update\t.claude/skills/pdh/SKILL.md", checked)
        self.assertIn("update\t.ticket-config.yaml", checked)
        self.install()
        self.assertIn("New shared template line", (self.project / ".ticket-config.yaml").read_text())
        self.assertTrue((self.project / ".agents/skills/pdh/SKILL.md").read_text().endswith("A second release.\n"))
        self.assertEqual(self.install("--check").stdout, "PDH already up to date\n")
        installed = self.project / ".claude/skills/pdh/SKILL.md"
        local = installed.read_text() + "Project edit.\n"
        installed.write_text(local)
        self.assertIn("existing contents differ", self.install(expect=1).stderr)
        self.assertEqual(installed.read_text(), local)

    def test_refuses_unknown_pre_close_and_symlink_before_writing(self):
        path = self.project / ".ticket-config.yaml"
        self.write(path, 'pre_close_command: "custom command"\n')
        self.commit(self.project, "custom gate")
        self.assertIn("cannot classify", self.install("--check", expect=1).stderr)
        self.assertFalse((self.project / "ticket.sh").exists())
        self.assertEqual(path.read_text(), 'pre_close_command: "custom command"\n')

        path.unlink()
        self.commit(self.project, "remove custom gate")
        outside = self.work / "outside"
        outside.mkdir()
        (self.project / ".agents").symlink_to(outside)
        self.install(expect=1)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertFalse((self.project / ".ticket-config.yaml").exists())

    def test_only_known_untracked_worktree_local_files_are_ignored(self):
        config = """default_branch: trunk
worktree_copy_files:
  - .env
  - "CLAUDE.local.md"
  - product-local.txt
"""
        self.write(self.project / ".ticket-config.yaml", config)
        self.write(self.project / "CLAUDE.local.md", "tracked project data\n")
        self.commit(self.project, "track one of the configured names")
        self.write(self.project / ".env", "untracked private fixture\n")
        self.install()
        ignored = (self.project / ".gitignore").read_text().splitlines()
        self.assertIn("/.env", ignored)
        self.assertNotIn("/CLAUDE.local.md", ignored)
        self.assertNotIn("/product-local.txt", ignored)
        self.assertEqual((self.project / ".env").read_text(), "untracked private fixture\n")

    def test_existing_ticket_and_bot_keep_the_old_close_path(self):
        name = self.legacy(bot=True)
        self.install()
        configuration = (self.project / ".ticket-config.yaml").read_text()
        self.assertIn('post_start_command: "printf preparing"', configuration)
        self.assertIn('repository: "product-remote"', configuration)
        self.assertIn('pre_close_command: "bash scripts/pdh-ticket-ready.sh"', configuration)
        self.assertIn('require_checklist_groups:', (self.project / ".pdh-legacy/ticket-config.yaml").read_text())
        self.assertIn(name, (self.project / ".pdh-legacy/tickets").read_text().splitlines())
        self.commit(self.project, "migrate")
        started = self.ticket("start", name, "--no-worktree", "--no-post-start")
        self.assertEqual(started.returncode, 0, started.stdout + started.stderr)
        closed = self.ticket("close", "--dry-run", "--no-push")
        self.assertEqual(closed.returncode, 0, closed.stdout + closed.stderr)
        self.assertIn("legacy-pre-close", closed.stdout)
        self.run_git(self.project, "switch", "trunk")
        new = self.ticket("new", "issue-12", "--created-at", "261126-093000", "--branch", "agent/issue-12",
                          extra={"GITHUB_ACTIONS": "true", "ISSUE_NUMBER": "12"})
        self.assertEqual(new.returncode, 0, new.stdout + new.stderr)
        bot = self.project / "tickets/261126-093000-issue-12"
        self.assertIn("pdh_workflow: legacy-bot", (bot / "ticket.md").read_text())
        self.assertIn("PDH-ticket-write", (bot / "note.md").read_text())
        self.assertFalse((bot / "scope.md").exists())
        self.commit(self.project, "bot created ticket")
        started = self.ticket("start", bot.name, "--no-worktree", "--no-post-start")
        self.assertEqual(started.returncode, 0, started.stdout + started.stderr)
        closed = self.ticket("close", "--dry-run", "--no-push")
        self.assertEqual(closed.returncode, 0, closed.stdout + closed.stderr)
        self.assertIn("legacy-pre-close", closed.stdout)

    def test_new_close_stays_on_shared_gate_with_missing_scope(self):
        self.legacy(bot=True)
        self.install()
        self.commit(self.project, "migrate")
        new = self.ticket("new", "issue-42", "--created-at", "261126-093000")
        self.assertEqual(new.returncode, 0, new.stdout + new.stderr)
        ticket = self.project / "tickets/261126-093000-issue-42"
        self.assertIn("pdh_workflow: shared", (ticket / "ticket.md").read_text())
        self.assertIn("## 独立検収", (ticket / "scope.md").read_text())
        self.commit(self.project, "create with shared workflow")
        started = self.ticket("start", ticket.name, "--no-worktree", "--no-post-start")
        self.assertEqual(started.returncode, 0, started.stdout + started.stderr)
        (ticket / "scope.md").unlink()
        metadata = ticket / "ticket.md"
        metadata.write_text(metadata.read_text().replace("pdh_workflow: shared", "pdh_workflow: legacy-bot"))
        self.commit(self.project, "simulate missing scope and edited marker")
        result = self.ticket("close", "--dry-run", "--no-push", extra={"PDH_USE_LEGACY_TICKETS": "1"})
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("bash scripts/pdh-ticket-ready.sh", result.stdout)
        self.assertNotIn("legacy-pre-close", result.stdout)


if __name__ == "__main__":
    unittest.main()
