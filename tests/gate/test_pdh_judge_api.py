import io
import json
import os
from pathlib import Path
import sys
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pdh/scripts"))
import pdh_judge_api


PRESENT = {
    "verdict": "present",
    "criterion": "利用者が結果を確認できる",
    "reason": "観察結果が条件と一致する",
    "next": "利用者に確認を依頼する",
}


CRITERIA = {"C1": PRESENT["criterion"], "C2": "利用者が画面を開ける"}
PRESENT_ID = {**PRESENT, "criterion": "C1"}


def response(result):
    return {
        "status": "completed",
        "output": [
            {"type": "reasoning", "summary": []},
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": json.dumps(result)}],
            },
        ],
    }


class JudgeAPITest(unittest.TestCase):
    def setUp(self):
        credentials = patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=True)
        self.addCleanup(credentials.stop)
        credentials.start()

    @patch("pdh_judge_api.build_opener")
    def test_sends_packet_to_independent_structured_judge(self, opener):
        send = opener.return_value.open
        send.return_value = io.BytesIO(json.dumps(response(PRESENT_ID)).encode())
        self.assertEqual(pdh_judge_api.judge("checked evidence", CRITERIA), PRESENT)

        request = send.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(request.full_url, "https://api.openai.com/v1/responses")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertIsInstance(send.call_args.kwargs["timeout"], (int, float))
        self.assertEqual(payload["input"], "checked evidence")
        self.assertEqual(payload["model"], "gpt-6.2-astra")
        self.assertEqual(payload["reasoning"], {"effort": "medium"})
        self.assertFalse(payload["store"])
        self.assertEqual(payload["tools"], [])
        self.assertEqual(payload["instructions"], pdh_judge_api.ID_INSTRUCTIONS)
        output_format = payload["text"]["format"]
        self.assertTrue(output_format["strict"])
        self.assertEqual(output_format["schema"]["properties"]["criterion"]["enum"], ["C1", "C2"])
        self.assertNotIn("enum", pdh_judge_api.VERDICT_SCHEMA["properties"]["criterion"])
        self.assertLessEqual(payload["max_output_tokens"], 4096)

    @patch("pdh_judge_api.build_opener")
    def test_sends_coverage_instructions_when_packet_contains_test_sources(self, opener):
        send = opener.return_value.open
        send.return_value = io.BytesIO(json.dumps(response(PRESENT_ID)).encode())
        packet = json.dumps({"coverage_test_sources": {}})
        self.assertEqual(pdh_judge_api.judge(packet, CRITERIA), PRESENT)
        payload = json.loads(send.call_args.args[0].data)
        self.assertEqual(payload["input"], packet)
        self.assertEqual(payload["instructions"], pdh_judge_api.COVERAGE_INSTRUCTIONS)

    @patch("pdh_judge_api.build_opener")
    def test_missing_key_skips_network(self, opener):
        del os.environ["OPENAI_API_KEY"]
        with self.assertRaisesRegex(RuntimeError, "OPENAI_API_KEY"):
            pdh_judge_api.judge("checked evidence", CRITERIA)
        opener.assert_not_called()

    @patch("pdh_judge_api.build_opener")
    def test_network_failure_is_sanitized_and_not_retried(self, opener):
        send = opener.return_value.open
        send.side_effect = URLError("test-key and checked evidence")
        with self.assertRaisesRegex(RuntimeError, "^判定 API に接続できませんでした$") as error:
            pdh_judge_api.judge("checked evidence", CRITERIA)
        self.assertTrue(error.exception.__suppress_context__)
        send.assert_called_once()

    @patch("pdh_judge_api.build_opener")
    def test_http_error_reports_only_status(self, opener):
        body = io.BytesIO(b"test-key and checked evidence")
        send = opener.return_value.open
        send.side_effect = HTTPError("https://api.openai.com", 429, "secret", {}, body)
        with self.assertRaisesRegex(RuntimeError, "^判定 API が HTTP 429 を返しました$"):
            pdh_judge_api.judge("checked evidence", CRITERIA)
        self.assertTrue(body.closed)
        send.assert_called_once()

    @patch("pdh_judge_api.build_opener")
    def test_limits_response_size(self, opener):
        response_body = opener.return_value.open.return_value.__enter__.return_value
        response_body.read.return_value = b" " * (64 * 1024 + 1)
        with self.assertRaisesRegex(RuntimeError, "^判定 API の応答から有効な判定を取得できませんでした$"):
            pdh_judge_api.judge("checked evidence", CRITERIA)
        response_body.read.assert_called_once_with(64 * 1024 + 1)

    @patch("pdh_judge_api.build_opener")
    def test_rejects_incomplete_refused_and_invalid_answers(self, opener):
        refused = response(PRESENT_ID)
        refused["output"][1]["content"] = [{"type": "refusal", "refusal": "secret"}]
        payloads = (
            {**response(PRESENT_ID), "status": "incomplete"},
            refused,
            response({**PRESENT_ID, "criterion": "C3"}),
            response(PRESENT),
            response({**PRESENT_ID, "criterion": "C1 "}),
            response({**PRESENT_ID, "verdict": "unknown", "reason": "secret"}),
        )
        for payload in payloads:
            with self.subTest(status=payload["status"]):
                opener.return_value.open.return_value = io.BytesIO(json.dumps(payload).encode())
                with self.assertRaisesRegex(RuntimeError, "^判定 API の応答から有効な判定を取得できませんでした$"):
                    pdh_judge_api.judge("checked evidence", CRITERIA)

    def test_cached_verdict_has_exact_fields_and_nonempty_strings(self):
        self.assertEqual(pdh_judge_api.validate({**PRESENT, "verdict": "hold"}), {**PRESENT, "verdict": "hold"})
        for invalid in (
            None,
            {"verdict": "present"},
            {**PRESENT, "reason": " "},
            {**PRESENT, "criterion": 123},
            {**PRESENT, "verdict": []},
            {**PRESENT, "extra": "unexpected"},
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    pdh_judge_api.validate(invalid)
