import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pdh/scripts"))
import pdh_judge_claude as claude
from pdh_judge_api import COVERAGE_INSTRUCTIONS

CRITERIA = {"C1": "一覧に2件が表示される"}
VERDICT = {"criterion": "C1", "verdict": "hold", "reason": "1件だけ表示された", "next": "欠落を調べる"}
RESULT = {"type": "result", "subtype": "success", "is_error": False, "modelUsage": {claude.MODEL: {}},
          "permission_denials": [], "structured_output": VERDICT}


class ClaudeJudgeTest(unittest.TestCase):
    def test_rejects_errors_fallback_and_invalid_verdicts(self):
        for change in ({"type": "assistant"}, {"subtype": "error_max_turns"}, {"is_error": True},
                       {"modelUsage": {"other": {}}}, {"permission_denials": ["read"]},
                       {"structured_output": {**VERDICT, "criterion": "C2"}}, {"structured_output": None}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                claude._result(json.dumps({**RESULT, **change}).encode(), CRITERIA)

    def test_sends_only_packet_in_a_fresh_tool_free_session(self):
        packet = '{"coverage_test_sources": {}}'
        with TemporaryDirectory() as temp, patch.dict(claude.os.environ, {"CLAUDE_CONFIG_DIR": temp}):
            auth = Path(temp) / ".credentials.json"
            auth.touch()
            login = subprocess.CompletedProcess([], 0, b'{"loggedIn":true,"authMethod":"claude.ai"}')
            done = subprocess.CompletedProcess([], 0, json.dumps(RESULT).encode())
            with (patch.object(claude.shutil, "which", side_effect=lambda name: "/bin/" + name),
                  patch.object(claude.subprocess, "run", side_effect=[login, done]) as run):
                self.assertEqual(claude.judge(packet, CRITERIA), {**VERDICT, "criterion": CRITERIA["C1"]})
                call = run.call_args
                args = call.args[0]
                self.assertEqual(call.kwargs["input"], packet.encode())
                self.assertEqual(call.kwargs["env"], {})
                self.assertNotIn(packet, args)
                self.assertEqual(args[args.index("--tools") + 1], "")
                self.assertEqual(args[args.index("--system-prompt") + 1], COVERAGE_INSTRUCTIONS)
                self.assertIn(["--ro-bind", str(auth.resolve()), "/trial/.claude/.credentials.json"],
                              [args[i:i + 3] for i in range(len(args))])
                for flag in ("--clearenv", "--safe-mode", "--restricted", "--strict-mcp-config", "--no-session-persistence"):
                    self.assertIn(flag, args)
                schema = json.loads(args[args.index("--json-schema") + 1])
                self.assertEqual(schema["properties"]["criterion"]["enum"], ["C1"])
            with (patch.object(claude.shutil, "which", return_value="/bin/mock"),
                  patch.object(claude.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b'{}')) as run,
                  self.assertRaises(RuntimeError)):
                claude.judge(packet, CRITERIA)
            self.assertEqual(run.call_count, 1)
