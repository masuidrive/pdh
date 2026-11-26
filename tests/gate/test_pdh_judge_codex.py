import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pdh_judge_codex as codex
from pdh_judge_api import COVERAGE_INSTRUCTIONS, ID_INSTRUCTIONS


VERDICT = {
    "verdict": "present",
    "criterion": "条件",
    "reason": "理由",
    "next": "次の行動",
}
CRITERIA = {"C1": VERDICT["criterion"], "C2": "別の条件"}
THREAD = {"type": "thread.started"}
START = {"type": "turn.started"}
COMPLETE = {"type": "turn.completed"}
MESSAGE = {
    "type": "item.completed",
    "item": {"type": "agent_message", "text": json.dumps({**VERDICT, "criterion": "C1"})},
}


def events(*entries):
    return b"\n".join(json.dumps(entry).encode() for entry in entries)


class CodexJudgeTest(unittest.TestCase):
    def test_accepts_completed_verdict_after_transport_fallback(self):
        warning = {"type": "error", "message": codex._FALLBACK_PREFIX + " retry"}
        reasoning = {"type": "item.completed", "item": {"type": "reasoning"}}
        self.assertEqual(
            codex._result(events(THREAD, START, warning, reasoning, MESSAGE, COMPLETE), CRITERIA),
            VERDICT,
        )

    def test_rejects_tools_failed_or_missing_turn_and_multiple_verdicts(self):
        for middle, ending in (
            ({"type": "item.started", "item": {"type": "command_execution"}}, (COMPLETE,)),
            ({"type": "item.completed", "item": {"type": "mcp_tool_call"}}, (COMPLETE,)),
            ({"type": "error", "message": "unexpected error"}, (COMPLETE,)),
            (MESSAGE, (COMPLETE,)),
            ({"type": "turn.failed"}, ()),
            ({"type": "item.completed", "item": {"type": "reasoning"}}, ()),
        ):
            with self.subTest(middle=middle, ending=ending), self.assertRaises(ValueError):
                codex._result(events(THREAD, START, MESSAGE, middle, *ending), CRITERIA)

    def test_rejects_nonmatching_criterion_id(self):
        for criterion in ("C3", "C1 ", VERDICT["criterion"]):
            message = {
                **MESSAGE,
                "item": {**MESSAGE["item"], "text": json.dumps({**VERDICT, "criterion": criterion})},
            }
            with self.subTest(criterion=criterion), self.assertRaises(ValueError):
                codex._result(events(THREAD, START, message, COMPLETE), CRITERIA)

    def test_sends_packet_only_via_stdin_to_isolated_session(self):
        self.assert_isolated_request("試験資料", ID_INSTRUCTIONS)

    def test_sends_coverage_instructions_to_isolated_session(self):
        self.assert_isolated_request(json.dumps({"coverage_test_sources": {}}), COVERAGE_INSTRUCTIONS)

    def assert_isolated_request(self, packet, instructions):
        with TemporaryDirectory() as dirname:
            home = Path(dirname)
            auth = home / ".codex/auth.json"
            auth.parent.mkdir()
            auth.touch()

            def run(args, **kwargs):
                self.assertIn("--clearenv", args)
                self.assertTrue(all(packet not in arg for arg in args))
                self.assertEqual(kwargs["env"], {})
                self.assertIn(["--ro-bind", str(auth), "/trial/.codex/auth.json"], [
                    args[i:i+3] for i in range(len(args))
                ])
                if args[-2:] == ["login", "status"]:
                    return subprocess.CompletedProcess(
                        args, 0, b"Logged in using ChatGPT", b"",
                    )
                self.assertEqual(kwargs["input"], packet.encode())
                self.assertIn("--ephemeral", args)
                self.assertIn("--ignore-user-config", args)
                self.assertIn("--ignore-rules", args)
                self.assertIn('web_search="disabled"', args)
                self.assertIn("shell_tool", args)
                self.assertIn("code_mode", args)
                self.assertIn("code_mode_only", args)
                self.assertIn("--ro-bind-data", args)
                (fd,) = kwargs["pass_fds"]
                schema = json.loads(os.pread(fd, os.fstat(fd).st_size, 0))
                self.assertEqual(schema["properties"]["criterion"]["enum"], ["C1", "C2"])
                self.assertIn(
                    f"developer_instructions={json.dumps(instructions, ensure_ascii=False)}",
                    args,
                )
                return subprocess.CompletedProcess(
                    args, 0, events(THREAD, START, MESSAGE, COMPLETE), b"",
                )

            with (
                patch.object(codex.Path, "home", return_value=home),
                patch.object(codex, "_codex_binary", return_value=Path("/native/codex")),
                patch.object(codex.shutil, "which", return_value="/usr/bin/bwrap"),
                patch.object(codex.subprocess, "run", side_effect=run) as process,
            ):
                self.assertEqual(codex.judge(packet, CRITERIA), VERDICT)
                self.assertEqual(process.call_count, 2)


if __name__ == "__main__":
    unittest.main()
