import json
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import Mock, patch

import requests
from fastapi import HTTPException

from backend.exceptions import RealtimeUpstreamError
from backend.routers.roleplay import _create_realtime_call, roleplay_realtime_session
from backend.schemas.roleplay import RoleplayRealtimeSessionIn


def _response(
    status: int,
    *,
    text: str = "",
    request_id: str = "req_test",
    error_type: str = "server_error",
) -> Mock:
    response = Mock(spec=requests.Response)
    response.status_code = status
    response.ok = status < 400
    response.text = text
    response.headers = {"x-request-id": request_id}
    response.json.return_value = {
        "error": {"type": error_type, "code": None, "message": "redacted test error"}
    }
    return response


class RealtimeSessionBootstrapTests(TestCase):
    def _call(self):
        return _create_realtime_call(
            user_id="user-1",
            sdp="v=0\r\nmock-offer",
            instructions="Act as a tutor.",
            model="gpt-realtime-2.1-mini",
            voice="marin",
            transcription_model="gpt-4o-mini-transcribe",
        )

    @patch("backend.routers.roleplay.requests.post")
    def test_posts_multipart_session_and_returns_answer(self, post: Mock):
        post.return_value = _response(200, text="v=0\r\nmock-answer")

        answer, request_id = self._call()

        self.assertEqual(answer, "v=0\r\nmock-answer")
        self.assertEqual(request_id, "req_test")
        kwargs = post.call_args.kwargs
        self.assertNotIn("Content-Type", kwargs["headers"])
        self.assertEqual(kwargs["files"]["sdp"][1], "v=0\r\nmock-offer")
        session_config = json.loads(kwargs["files"]["session"][1])
        self.assertEqual(session_config["model"], "gpt-realtime-2.1-mini")
        self.assertEqual(session_config["audio"]["output"]["voice"], "marin")
        self.assertEqual(
            session_config["audio"]["input"]["transcription"]["model"],
            "gpt-4o-mini-transcribe",
        )
        self.assertEqual(session_config["instructions"], "Act as a tutor.")
        self.assertTrue(kwargs["headers"]["OpenAI-Safety-Identifier"])

    @patch("backend.routers.roleplay.time.sleep")
    @patch("backend.routers.roleplay.requests.post")
    def test_retries_one_server_error(self, post: Mock, sleep: Mock):
        post.side_effect = [
            _response(500, request_id="req_failed"),
            _response(200, text="answer", request_id="req_ok"),
        ]

        answer, request_id = self._call()

        self.assertEqual((answer, request_id), ("answer", "req_ok"))
        self.assertEqual(post.call_count, 2)
        sleep.assert_called_once()

    @patch("backend.routers.roleplay.time.sleep")
    @patch("backend.routers.roleplay.requests.post")
    def test_retries_one_rate_limit(self, post: Mock, sleep: Mock):
        limited = _response(429, request_id="req_limited", error_type="rate_limit_error")
        limited.headers["retry-after"] = "9"
        post.side_effect = [limited, _response(200, text="answer")]

        self._call()

        self.assertEqual(post.call_count, 2)
        sleep.assert_called_once_with(2.0)

    @patch("backend.routers.roleplay.time.sleep")
    @patch("backend.routers.roleplay.requests.post")
    def test_does_not_retry_configuration_error(self, post: Mock, sleep: Mock):
        for status in (400, 401, 403):
            with self.subTest(status=status):
                post.reset_mock()
                sleep.reset_mock()
                post.return_value = _response(
                    status,
                    request_id=f"req_bad_{status}",
                    error_type="invalid_request_error",
                )

                with self.assertRaises(RealtimeUpstreamError) as caught:
                    self._call()

                self.assertEqual(post.call_count, 1)
                sleep.assert_not_called()
                self.assertEqual(caught.exception.code, "realtime_configuration_error")
                self.assertEqual(caught.exception.request_id, f"req_bad_{status}")
                self.assertFalse(caught.exception.retryable)

    @patch("backend.routers.roleplay.time.sleep")
    @patch("backend.routers.roleplay.requests.post")
    def test_retries_connect_failure_before_response(self, post: Mock, sleep: Mock):
        post.side_effect = [requests.ConnectTimeout("connect failed"), _response(200, text="answer")]

        answer, _ = self._call()

        self.assertEqual(answer, "answer")
        self.assertEqual(post.call_count, 2)
        sleep.assert_called_once()

    @patch("backend.routers.roleplay.time.sleep")
    @patch("backend.routers.roleplay.requests.post")
    def test_does_not_retry_read_timeout(self, post: Mock, sleep: Mock):
        post.side_effect = requests.ReadTimeout("do not expose request data")

        with self.assertRaises(RealtimeUpstreamError) as caught:
            self._call()

        self.assertEqual(post.call_count, 1)
        sleep.assert_not_called()
        self.assertEqual(caught.exception.code, "realtime_unavailable")
        self.assertTrue(caught.exception.retryable)

    @patch("backend.routers.roleplay.time.sleep")
    @patch("backend.routers.roleplay.requests.post")
    def test_retry_log_does_not_contain_sensitive_payloads(self, post: Mock, sleep: Mock):
        post.side_effect = [
            _response(500, request_id="req_safe"),
            _response(200, text="answer"),
        ]

        with self.assertLogs("backend.routers.roleplay", level="WARNING") as captured:
            self._call()

        output = "\n".join(captured.output)
        self.assertIn("req_safe", output)
        self.assertNotIn("mock-offer", output)
        self.assertNotIn("Act as a tutor", output)
        self.assertNotIn("Authorization", output)


class RealtimeSessionRouteTests(IsolatedAsyncioTestCase):
    @patch(
        "backend.routers.roleplay.settings",
        SimpleNamespace(
            effective_roleplay_api_key="configured",
            openai_realtime_model="gpt-realtime-2.1-mini",
            openai_realtime_voice="marin",
            openai_realtime_transcribe_model="gpt-4o-mini-transcribe",
        ),
    )
    @patch("backend.routers.roleplay._create_realtime_call")
    async def test_returns_structured_upstream_error(self, create_call: Mock):
        create_call.side_effect = RealtimeUpstreamError(
            status_code=503,
            code="realtime_unavailable",
            message="다시 시도해주세요.",
            retryable=True,
            request_id="req_route",
        )

        with self.assertRaises(HTTPException) as caught:
            await roleplay_realtime_session(
                RoleplayRealtimeSessionIn(sdp="v=0\r\nmock"),
                session=None,
                _user={"id": "user-1"},
            )

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(
            caught.exception.detail,
            {
                "code": "realtime_unavailable",
                "message": "다시 시도해주세요.",
                "retryable": True,
                "request_id": "req_route",
            },
        )
