"""All writes for an issue hold one workflow lock, including CI decision and repair."""
import os
from pathlib import Path
import unittest
import yaml
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'.github/workflows/coding-bot.yml').is_file())

class IssueLock(unittest.TestCase):
    def test_ci_decision_and_repair_share_one_workflow_lock(self):
        workflow=yaml.safe_load(Path(os.environ.get('BOT_WORKFLOW_PATH',ROOT/'.github/workflows/coding-bot.yml')).read_text())
        lock=workflow['concurrency']
        self.assertIs(lock['cancel-in-progress'],False);self.assertEqual(lock['queue'],'max')
        self.assertIn('inputs.ci_autofix_issue || inputs.issue',lock['group'])
        self.assertIn("format('pr-{0}'",lock['group'])
        self.assertNotIn('context',workflow['jobs'])
        for name in ['ci-autofix','agent']:
            self.assertNotIn('concurrency',workflow['jobs'][name])
        self.assertNotIn('needs.context',workflow['jobs']['agent']['if'])
        caller=yaml.safe_load((ROOT/'.github/workflows/coding-bot-ci-autofix.yml').read_text())
        self.assertEqual(caller['jobs']['autofix']['with']['ci_autofix_issue'],'${{ needs.context.outputs.issue_number }}')
        self.assertNotIn('concurrency',caller['jobs']['autofix'])

if __name__=='__main__':unittest.main(verbosity=2)
