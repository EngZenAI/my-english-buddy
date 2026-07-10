from types import SimpleNamespace
from unittest import TestCase

from backend.usage.pricing import estimate_llm_cost_usd
from backend.usage.realtime import build_realtime_usage_records
from backend.usage.tracking import extract_token_usage


class RealtimeUsageTest(TestCase):
    def _payload(self, **overrides):
        data = {
            "usage_group_id": "response:test",
            "operation": "realtime",
            "usage": {},
            "success": True,
            "error_message": "",
        }
        data.update(overrides)
        return SimpleNamespace(**data)

    def test_splits_official_realtime_usage_without_double_counting_request(self):
        payload = self._payload(
            usage={
                "total_tokens": 253,
                "input_tokens": 132,
                "output_tokens": 121,
                "input_token_details": {
                    "text_tokens": 119,
                    "audio_tokens": 13,
                    "image_tokens": 0,
                    "cached_tokens": 64,
                    "cached_tokens_details": {
                        "text_tokens": 64,
                        "audio_tokens": 0,
                        "image_tokens": 0,
                    },
                },
                "output_token_details": {"text_tokens": 30, "audio_tokens": 91},
            }
        )

        records = build_realtime_usage_records(
            payload,
            realtime_model="gpt-realtime-2.1-mini",
            transcription_model="gpt-4o-mini-transcribe",
        )

        self.assertEqual(sum(record["total_tokens"] or 0 for record in records), 253)
        self.assertEqual(sum(record["units"] for record in records), 1)
        self.assertEqual({record["usage_group_id"] for record in records}, {"response:test"})
        self.assertEqual(
            {record["model"] for record in records},
            {
                "gpt-realtime-2.1-mini:text",
                "gpt-realtime-2.1-mini:text_cached",
                "gpt-realtime-2.1-mini:audio",
            },
        )

    def test_transcription_usage_is_one_separate_request(self):
        payload = self._payload(
            usage_group_id="transcription:test",
            operation="realtime_transcription",
            usage={"total_tokens": 26, "input_tokens": 17, "output_tokens": 9},
        )

        records = build_realtime_usage_records(
            payload,
            realtime_model="gpt-realtime-2.1-mini",
            transcription_model="gpt-4o-mini-transcribe",
        )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["model"], "gpt-4o-mini-transcribe")
        self.assertEqual(records[0]["total_tokens"], 26)
        self.assertEqual(records[0]["units"], 1)
        self.assertEqual(estimate_llm_cost_usd(records[0]), 0.000066)

    def test_failure_uses_server_model_and_sanitizes_negative_tokens(self):
        payload = self._payload(
            operation="realtime_error",
            usage={"input_tokens": -10, "output_tokens": -3},
            success=False,
            error_message="  connection   failed  ",
        )

        records = build_realtime_usage_records(
            payload,
            realtime_model="gpt-realtime-2.1-mini",
            transcription_model="gpt-4o-mini-transcribe",
        )

        self.assertEqual(records[0]["model"], "gpt-realtime-2.1-mini")
        self.assertEqual(records[0]["input_tokens"], 0)
        self.assertEqual(records[0]["output_tokens"], 0)
        self.assertFalse(records[0]["success"])
        self.assertEqual(records[0]["error_message"], "connection failed")


class TokenExtractionTest(TestCase):
    def test_extracts_langchain_and_provider_usage_shapes(self):
        cases = [
            (
                SimpleNamespace(
                    usage_metadata={"input_tokens": 10, "output_tokens": 4, "total_tokens": 14},
                    response_metadata={},
                ),
                {"input_tokens": 10, "output_tokens": 4, "total_tokens": 14},
            ),
            (
                SimpleNamespace(
                    usage_metadata=None,
                    response_metadata={
                        "token_usage": {
                            "prompt_tokens": 11,
                            "completion_tokens": 5,
                            "total_tokens": 16,
                        }
                    },
                ),
                {"input_tokens": 11, "output_tokens": 5, "total_tokens": 16},
            ),
        ]

        for response, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(extract_token_usage(response), expected)
