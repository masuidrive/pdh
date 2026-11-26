"""Exercise the release's ordinary installer and its ticket entrypoints."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
FORMER_RELEASE = "cc95056cc1cd59958fbbcf1125e3c9d1eb21161e"
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
        for name in ("install.py", "migration.py", "README.md", "USAGE.md"):
            shutil.copyfile(ROOT / name, self.release / name)
        for name in ("integration", "scripts", "checks", "skills"):
            shutil.copytree(ROOT / name, self.release / name, symlinks=True,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
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

    def install_former(self, *, real_agents=False):
        former = self.work / "former-release"
        former.mkdir()
        archive = subprocess.check_output(["git", "-C", str(ROOT), "archive", FORMER_RELEASE])
        subprocess.run(["tar", "-xf", "-"], cwd=former, input=archive, check=True)
        if real_agents:
            (self.project / ".agents/skills/pdh").mkdir(parents=True)
        subprocess.run([sys.executable, str(former / "install.py"), "--target", str(self.project)],
                       check=True, capture_output=True)
        self.commit(self.project, "install the previous shared distribution")

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
        for engine in (".agents", ".claude"):
            for skill in ("pdh", "pdh-update"):
                alias = self.project / engine / "skills" / skill
                self.assertEqual(os.readlink(alias), f"../../pdh/skills/{skill}")
                self.assertTrue((alias / "SKILL.md").is_file())
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
        new = self.release / "skills/pdh/SKILL.md"
        new.write_text(new.read_text() + "\nA second release.\n")
        config = self.release / "integration/.ticket-config.yaml"
        config.write_text(config.read_text().replace("## 独立検収", "## 独立検収\n      New shared template line"))
        self.commit(self.release, "update the distribution")
        checked = self.install("--check").stdout
        self.assertIn("update\tpdh/skills/pdh/SKILL.md", checked)
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

    def test_non_bot_upgrade_keeps_records_without_installing_the_stage_workflow(self):
        name = self.legacy()
        old_ticket = self.project / "tickets" / name / "ticket.md"
        before = old_ticket.read_bytes()
        self.install()
        self.assertEqual(before, old_ticket.read_bytes())
        self.assertFalse((self.project / ".pdh-legacy").exists())
        self.assertIn("pdh-ticket-ready.sh", (self.project / ".ticket-config.yaml").read_text())
        self.assertEqual(self.install("--check").stdout, "PDH already up to date\n")

    def test_migration_preserves_ticket_records_and_the_installed_bot(self):
        name = self.legacy(bot=True)
        self.install()
        configuration = (self.project / ".ticket-config.yaml").read_text()
        self.assertIn('post_start_command: "printf preparing"', configuration)
        self.assertIn('repository: "product-remote"', configuration)
        self.assertIn('pre_close_command: "bash pdh/scripts/pdh-ticket-ready.sh"', configuration)
        self.assertIn('require_checklist_groups:', (self.project / ".pdh-legacy/ticket-config.yaml").read_text())
        self.assertTrue((self.project / "tickets" / name / "ticket.md").is_file())
        self.assertFalse((self.project / ".pdh-legacy/tickets").exists())
        self.commit(self.project, "migrate")
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
        self.assertIn("bash pdh/scripts/pdh-ticket-ready.sh", result.stdout)
        self.assertNotIn("legacy-pre-close", result.stdout)

    def test_installs_the_committed_git_snapshot_with_modes_and_links(self):
        self.write(self.release / "tools/pdh-extra", "#!/bin/sh\nexit 0\n", 0o755)
        (self.release / "tools/pdh-link").symlink_to("pdh-extra")
        self.write(self.release / ".github/pdh-example.md", "downstream must get tracked files\n")
        self.commit(self.release, "commit all fixture paths")
        self.write(self.release / "tools/pdh-extra", "local source edit\n")
        self.write(self.release / "tools/untracked", "untracked source data\n")
        self.install()
        paths = self.run_git(self.release, "ls-tree", "-r", "--name-only", "HEAD").splitlines()
        snapshot = self.project / "pdh"
        observed = sorted(path.relative_to(snapshot).as_posix()
                          for path in snapshot.rglob("*") if path.is_file() or path.is_symlink())
        self.assertEqual(observed, sorted(paths))
        for name in paths:
            path = snapshot / name
            mode = self.run_git(self.release, "ls-tree", "HEAD", "--", name).split()[0]
            expected = subprocess.check_output(["git", "-C", str(self.release), "show", f"HEAD:{name}"])
            if mode == "120000":
                self.assertEqual(os.fsencode(os.readlink(path)), expected)
            else:
                self.assertEqual(path.read_bytes(), expected)
                self.assertEqual(path.stat().st_mode & 0o777, 0o755 if mode == "100755" else 0o644)
        state = json.loads((self.project / ".pdh-install.lock").read_text())
        self.assertEqual(state["release"], self.run_git(self.release, "rev-parse", "HEAD").strip())
        self.assertFalse((snapshot / ".git").exists())
        self.assertFalse((snapshot / "install.lock").exists())
        self.assertEqual(self.install("--check").stdout, "PDH already up to date\n")

    def test_previous_shared_installation_removes_only_proven_old_distribution_paths(self):
        self.install_former(real_agents=True)
        custom = "scripts/test-ticket-local.sh"
        self.write(self.project / custom, "#!/bin/sh\nprintf project\n", 0o755)
        harmless = self.project / "scripts/local-kept.sh"
        self.write(harmless, "project check\n")
        known_stage = "scripts/pdh.py"
        stage_data = (self.project / known_stage).read_bytes()
        legacy = (
            f"# upstream: masuidrive/pdh@{self.old_revision}\n"
            f"{known_stage}\tclaude/templates/pdh.py\t{hashlib.sha256(stage_data).hexdigest()}\n"
        )
        self.write(self.project / ".pdh-lock", legacy)
        evidence = self.project / "tickets/261125-090000-old/evidence.md"
        self.write(evidence, "Existing signed-off observation\n")
        self.commit(self.project, "retain project-owned work and legacy inventory")
        staged = "scripts/pdh_judge_api.py"
        staged_file = self.project / staged
        prior_bytes = staged_file.read_bytes()
        staged_file.write_bytes(b"staged custom edit\n")
        self.run_git(self.project, "add", staged)
        staged_file.write_bytes(prior_bytes)

        before = self.run_git(self.project, "status", "--porcelain")
        check = self.install("--check").stdout
        self.assertIn("delete\tscripts/pdh_coverage.py\n", check)
        self.assertIn("delete\tscripts/pdh-checks/ticket-name.sh\n", check)
        self.assertIn("delete\ttickets/PDH.md\n", check)
        for preserved in (known_stage, custom, staged):
            self.assertIn(f"retain\t{preserved}\n", check)
        self.assertEqual(self.run_git(self.project, "status", "--porcelain"), before)
        self.assertFalse((self.project / "pdh").exists())
        self.assertEqual(self.install().stdout, check)
        self.assertEqual((self.project / ".pdh-lock").read_text(), legacy)
        self.assertEqual((self.project / known_stage).read_bytes(), stage_data)
        self.assertIn("printf project", (self.project / custom).read_text())
        self.assertEqual(staged_file.read_bytes(), prior_bytes)
        self.assertEqual(self.run_git(self.project, "show", f":{staged}"), "staged custom edit\n")
        self.assertEqual(evidence.read_text(), "Existing signed-off observation\n")
        self.assertEqual(harmless.read_text(), "project check\n")
        self.assertFalse((self.project / "scripts/pdh_coverage.py").exists())
        self.assertTrue((self.project / "pdh/scripts/pdh_coverage.py").is_file())
        self.assertEqual(os.readlink(self.project / ".claude/skills/pdh"), "../../pdh/skills/pdh")
        self.assertEqual(os.readlink(self.project / ".agents/skills/pdh"), "../../pdh/skills/pdh")
        lock = json.loads((self.project / ".pdh-install.lock").read_text())
        for preserved in (known_stage, custom, staged):
            self.assertNotIn(preserved, lock["files"])
        self.assertEqual(self.install("--check").stdout, "PDH already up to date\n")

    def test_existing_private_skill_file_prevents_alias_swap_without_changes(self):
        self.install_former(real_agents=True)
        extra = self.project / ".agents/skills/pdh/project-notes.md"
        self.write(extra, "private instructions\n")
        before = self.run_git(self.project, "status", "--porcelain")
        for flags in (("--check",), ()):
            stopped = self.install(*flags, expect=1)
            self.assertIn(".agents/skills/pdh/project-notes.md", stopped.stderr)
            self.assertEqual(self.run_git(self.project, "status", "--porcelain"), before)
            self.assertFalse((self.project / "pdh").exists())
            self.assertEqual(extra.read_text(), "private instructions\n")

    def test_snapshot_retirement_preserves_custom_content(self):
        self.write(self.release / "tools/old.sh", "old tool\n")
        self.write(self.release / "tools/editable.sh", "unchanged source\n")
        self.commit(self.release, "two old paths")
        self.install()
        self.commit(self.project, "initial snapshot")
        custom = self.project / "pdh/tools/editable.sh"
        self.write(custom, "local project adaptation\n")
        self.write(self.project / "pdh/project-notes.md", "local notes outside the inventory\n")
        self.run_git(self.release, "rm", "tools/old.sh", "tools/editable.sh")
        self.run_git(self.release, "commit", "-m", "drop obsolete tool files")

        result = self.install("--check").stdout
        self.assertIn("delete\tpdh/tools/old.sh\n", result)
        self.assertIn("retain\tpdh/tools/editable.sh\n", result)
        self.assertEqual(self.install().stdout, result)
        self.assertFalse((self.project / "pdh/tools/old.sh").exists())
        self.assertEqual(custom.read_text(), "local project adaptation\n")
        self.assertEqual((self.project / "pdh/project-notes.md").read_text(), "local notes outside the inventory\n")
        self.assertEqual(self.install("--check").stdout, "PDH already up to date\n")

    def test_rejects_nested_git_data_and_uninitialized_gitlink_before_writing(self):
        metadata = self.project / "pdh/.git"
        self.write(metadata, "gitdir: ../unrelated-worktree\n")
        self.assertIn("without its own Git data", self.install("--check", expect=1).stderr)
        self.assertEqual(metadata.read_text(), "gitdir: ../unrelated-worktree\n")
        self.assertFalse((self.project / "ticket.sh").exists())
        metadata.unlink()
        metadata.parent.rmdir()
        project_commit = self.run_git(self.project, "rev-parse", "HEAD").strip()
        self.run_git(self.project, "update-index", "--add", "--cacheinfo", f"160000,{project_commit},pdh")
        self.assertIn("contains a Git submodule", self.install("--check", expect=1).stderr)
        self.run_git(self.project, "commit", "-m", "track a gitlink")
        self.run_git(self.project, "rm", "--cached", "pdh")
        self.assertIn("contains a Git submodule", self.install(expect=1).stderr)
        self.assertFalse((self.project / "pdh").exists())
        self.assertFalse((self.project / "ticket.sh").exists())

    def test_apply_failure_restores_removed_assets_and_real_skill_directory(self):
        from install import File, Plan, read_file

        former = "scripts/obsolete-pdh.sh"
        skill = ".agents/skills/pdh"
        self.write(self.project / former, "removed only on success\n")
        self.write(self.project / skill / "SKILL.md", "skill backup\n")
        plan = Plan(self.project)
        plan.add(former, None, read_file(self.project, former))
        plan.add(skill, File(b"../../pdh/skills/pdh", 0, True), read_file(self.project, skill, directory_ok=True))
        plan.add("simulate-write-failure", File(b"new"), None)
        import install
        put = install._put

        def fail_last(path, file, directories):
            if path.name == "simulate-write-failure":
                raise OSError("injected write failure")
            return put(path, file, directories)

        with patch("install._put", side_effect=fail_last):
            with self.assertRaisesRegex(OSError, "injected write failure"):
                plan.apply()
        self.assertEqual((self.project / former).read_text(), "removed only on success\n")
        self.assertFalse((self.project / skill).is_symlink())
        self.assertEqual((self.project / skill / "SKILL.md").read_text(), "skill backup\n")
        self.assertFalse(list(self.project.glob(".pdh-install-backup-*")))


if __name__ == "__main__":
    unittest.main()
