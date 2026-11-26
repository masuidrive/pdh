import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from migration import ENTRY, IMPORT_ROUTE, MARKER, plan_migration

ROOT = Path(__file__).resolve().parents[1]
USAGE = (ROOT / "integration" / ENTRY).read_bytes()


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

            plan = plan_migration(project, USAGE)
            self.assertEqual(set(plan), {"AGENTS.md", "CLAUDE.md"})
            self.assertNotIn("Detailed legacy stage rules", plan["AGENTS.md"].decode())
            self.assertLessEqual(len(plan["CLAUDE.md"].decode()), len((project / "CLAUDE.md").read_text()))
            (project / ENTRY).write_bytes(USAGE)
            for name, data in plan.items():
                (project / name).write_bytes(data)
                self.assertIn(IMPORT_ROUTE if name == "CLAUDE.md" else MARKER, data.decode())
                self.assertIn("Use our disposable test database.", data.decode())
            subprocess.run(["bash", str(generator), "--check"], check=True)
            self.assertEqual(plan_migration(project, USAGE), {})

    def test_upgrade_refreshes_the_installed_inline_instructions(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            former = MARKER + "\nPrior release instructions.\n<!-- /pdh-workflow -->"
            (project / ENTRY).write_text(former + "\n")
            (project / "AGENTS.md").write_text(former + "\n\nOur project instructions.\n")
            (project / "CLAUDE.md").symlink_to("AGENTS.md")
            updated = plan_migration(project, USAGE)["AGENTS.md"].decode()
            self.assertEqual(updated, USAGE.decode() + "\nOur project instructions.\n")
            (project / "AGENTS.md").write_text(updated.replace("製品の変更", "User customization"))
            with self.assertRaisesRegex(ValueError, "workflow block was edited"):
                plan_migration(project, USAGE)

    def test_existing_entrypoint_symlink_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            (project / "AGENTS.md").write_text("Use our test server.\n")
            (project / "CLAUDE.md").symlink_to("AGENTS.md")
            plan = plan_migration(project, USAGE)
            self.assertEqual(set(plan), {"AGENTS.md"})
            self.assertIn("Use our test server.", plan["AGENTS.md"].decode())

    def test_only_session_start_commands_using_the_project_helper_are_moved(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            templates = {
                ".claude/settings.json": (
                    '"$CLAUDE_PROJECT_DIR/scripts/pdh-session-hook.sh"',
                    '"$CLAUDE_PROJECT_DIR/pdh/scripts/pdh-session-context.sh"',
                ),
                ".codex/hooks.json": (
                    """sh -c 'exec "$(git rev-parse --show-toplevel)/scripts/pdh-session-context.sh"'""",
                    """sh -c 'exec "$(git rev-parse --show-toplevel)/pdh/scripts/pdh-session-context.sh"'""",
                ),
            }
            expected_text = {}
            for name, (old, new) in templates.items():
                path = project / name
                path.parent.mkdir()
                doc = json.dumps({
                    "hooks": {
                        "SessionStart": [{"hooks": [
                            {"type": "command", "command": old},
                            {"type": "command", "command": "/opt/other/scripts/pdh-session-hook.sh"},
                        ]}],
                        "Stop": [{"hooks": [{"type": "command", "command": old}]}],
                    },
                    "comment": "Keep existing formatting",
                }, indent=4) + "\n"
                path.write_text(doc)
                expected_text[name] = doc.replace(json.dumps(old), json.dumps(new), 1)
            plan = plan_migration(project, USAGE)
            for name, expected in expected_text.items():
                self.assertEqual(plan[name].decode(), expected)
                (project / name).write_text(expected)
            self.assertFalse(set(templates) & plan_migration(project, USAGE).keys())
