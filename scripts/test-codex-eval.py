#!/usr/bin/env python3
"""Evidence integrity tests. These do not invoke a model or use credentials."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("codex_eval", Path(__file__).with_name("codex-eval.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class EvidenceTests(unittest.TestCase):
    def parse(self, lines):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "events.jsonl"
            p.write_text("\n".join(json.dumps(x) if isinstance(x, dict) else x for x in lines))
            return runner.summarize_events(p)

    def completed(self):
        return {"type": "turn.completed", "usage": {"input_tokens": 12, "cached_input_tokens": 5, "output_tokens": 3}}

    def test_usage_is_bound_to_this_stream_and_summed_once(self):
        r = self.parse([{"type": "thread.started", "thread_id": "this-run"}, self.completed(), self.completed()])
        self.assertEqual(r["thread_ids"], ["this-run"])
        self.assertEqual(r["usage"], {"input_tokens": 24, "cached_input_tokens": 10, "output_tokens": 6})
        self.assertTrue(r["usage_complete"])

    def test_missing_usage_is_unknown(self):
        r = self.parse([{"type": "turn.completed"}])
        self.assertEqual(r["usage"], dict.fromkeys(runner.USAGE_KEYS))
        self.assertFalse(r["usage_complete"])

    def test_partial_usage_is_not_underreported(self):
        r = self.parse([self.completed(), {"type": "turn.completed", "usage": {"input_tokens": 4}}])
        self.assertEqual(r["usage"]["input_tokens"], 16)
        self.assertIsNone(r["usage"]["output_tokens"])
        self.assertFalse(r["usage_complete"])

    def test_bad_stream_or_failed_turn_cannot_pass(self):
        for bad in ('not json', '[]', {"type": "turn.failed", "error": {"message": "failure"}}):
            with self.subTest(bad=bad):
                r = self.parse([self.completed(), bad])
                self.assertEqual(runner.execution_status(0, False, r, "answer"), "failed")

    def test_tool_use_invalidates_prompt_only_evaluation(self):
        r = self.parse([{"type": "item.started", "item": {"id": "x", "type": "command_execution"}}, self.completed()])
        self.assertEqual(runner.execution_status(0, False, r, "answer"), "invalid_tool_use")

    def test_nonzero_exit_or_missing_completion_cannot_pass(self):
        r = self.parse([self.completed()])
        self.assertEqual(runner.execution_status(1, False, r, "answer"), "failed")
        self.assertEqual(runner.execution_status(0, False, self.parse([]), "answer"), "failed")

    def test_empty_answer_and_timeout_remain_incomplete(self):
        r = self.parse([self.completed()])
        self.assertEqual(runner.execution_status(0, False, r, " \n"), "missing_output")
        self.assertEqual(runner.execution_status(0, True, r, "answer"), "timeout")

    def test_completed_execution_is_not_a_quality_grade(self):
        r = self.parse([self.completed()])
        self.assertEqual(runner.execution_status(0, False, r, "incorrect answer"), "completed")
        self.assertNotIn("grade", r)


if __name__ == "__main__":
    unittest.main()
