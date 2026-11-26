import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from migration import ENTRY, IMPORT_ROUTE, MARKER, plan_migration

ROOT = Path(__file__).resolve().parents[1]


class ProjectEntrypointTest(unittest.TestCase):
    def test_generator_and_custom_instructions_survive_the_update(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            (project / "scripts").mkdir()
            generator = project / "scripts/gen-agents-md.sh"
            generator.write_bytes(subprocess.check_output([
                "git", "show", "5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41:claude/templates/gen-agents-md.sh"
            ], cwd=ROOT))
            (project / ".codex").mkdir()
            (project / ".codex/config.toml").write_text("")
            (project / "CLAUDE.md").write_text("@product-brief.md\n@PDH-AGENTS.md\nUse our disposable test database.\n")
            (project / "product-brief.md").write_text("Project intent\n")
            (project / "PDH-AGENTS.md").write_text("Detailed legacy stage rules\n")
            subprocess.run(["bash", str(generator)], check=True)

            plan = plan_migration(project, ROOT, ("claude", "codex"))
            self.assertEqual(set(plan), {"AGENTS.md", "CLAUDE.md"})
            self.assertNotIn("Detailed legacy stage rules", plan["AGENTS.md"].decode())
            self.assertLessEqual(len(plan["CLAUDE.md"].decode()), len((project / "CLAUDE.md").read_text()))
            shutil.copyfile(ROOT / "shared" / ENTRY, project / ENTRY)
            for name, data in plan.items():
                (project / name).write_bytes(data)
                self.assertIn(IMPORT_ROUTE if name == "CLAUDE.md" else MARKER, data.decode())
                self.assertIn("Use our disposable test database.", data.decode())
            subprocess.run(["bash", str(generator), "--check"], check=True)
            self.assertEqual(plan_migration(project, ROOT, ("claude", "codex")), {})

    def test_upgrade_refreshes_the_installed_inline_instructions(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            former = MARKER + "\nPrior release instructions.\n<!-- /pdh-workflow -->"
            (project / ENTRY).write_text(former + "\n")
            (project / "AGENTS.md").write_text(former + "\n\nOur project instructions.\n")
            (project / "CLAUDE.md").symlink_to("AGENTS.md")
            updated = plan_migration(project, ROOT, ("claude", "codex"))["AGENTS.md"].decode()
            self.assertEqual(updated, (ROOT / "shared" / ENTRY).read_text() + "\nOur project instructions.\n")
            (project / "AGENTS.md").write_text(updated.replace("製品の変更", "User customization"))
            with self.assertRaisesRegex(ValueError, "workflow block was edited"):
                plan_migration(project, ROOT, ("claude", "codex"))

    def test_existing_entrypoint_symlink_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            (project / "AGENTS.md").write_text("Use our test server.\n")
            (project / "CLAUDE.md").symlink_to("AGENTS.md")
            plan = plan_migration(project, ROOT, ("claude", "codex"))
            self.assertEqual(set(plan), {"AGENTS.md"})
            self.assertIn("Use our test server.", plan["AGENTS.md"].decode())
