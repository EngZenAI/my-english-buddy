import hashlib
import json
import logging
import threading
from _thread import LockType

import requests
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from backend.config import settings
from backend.db.dependencies import SessionDep
from backend.db.repositories import (
    delete_roleplay_session,
    get_all_words,
    get_roleplay_sessions,
    insert_words,
    record_api_usage_events,
    save_roleplay_session,
)
from backend.exceptions import ROLEPLAY_CONTEXT_ERRORS, ROLEPLAY_RUNTIME_ERRORS, log_exception
from backend.llm import (
    LLMConcurrencyLimitError,
    coach_roleplay_turn,
    continue_roleplay,
    start_roleplay,
    stream_roleplay_reply,
    summarize_roleplay,
)
from backend.prompts.roleplay import roleplay_system_prompt
from backend.routers.common import CurrentUserDep, needs_translation, safe_persist_usage_capture
from backend.schemas.roleplay import (
    RoleplayContinueIn,
    RoleplayRealtimeCoachingIn,
    RoleplayRealtimeSessionIn,
    RoleplayRealtimeUsageIn,
    RoleplaySaveWordsIn,
    RoleplayStartIn,
    RoleplaySummaryIn,
)
from backend.search.dictionary import translate_korean
from backend.usage.realtime import build_realtime_usage_records
from backend.usage.tracking import start_usage_capture

router = APIRouter(tags=["roleplay"])
logger = logging.getLogger(__name__)

ROLEPLAY_BUSY_MESSAGE = "이전 롤플레잉 AI 응답이 아직 끝나지 않았어요. 완료 후 다시 시도해주세요."
ROLEPLAY_LIMIT_MESSAGE = "AI 롤플레잉 요청이 많아 잠시 대기 중입니다. 방금 전 요청이 끝난 뒤 다시 시도해주세요."

_roleplay_lock_guard = threading.Lock()
_roleplay_user_locks: dict[str, LockType] = {}


async def _roleplay_words(
    session: SessionDep,
    user_id: str,
    scenario: str,
    tag: str | None,
):
    """모드에 맞는 단어 목록을 고른다.

    태그 모드일 때만 해당 태그의 단어를 가져와 "활용 연습" 대상 어휘로 쓴다.
    OPIc/일반 모드는 단어장에 의존하지 않으므로 빈 목록을 반환한다.
    """
    if (scenario or "").lower() == "tag" and tag:
        return await get_all_words(session, user_id, tag)
    return []


def _norm_turn(h) -> list:
    """history 한 항목을 [user, bot, coaching] 3-튜플로 정규화한다."""
    return [
        h[0] if len(h) > 0 else "",
        h[1] if len(h) > 1 else "",
        h[2] if len(h) > 2 else "",
    ]


def _roleplay_lock_for(user_id: str) -> LockType:
    with _roleplay_lock_guard:
        lock = _roleplay_user_locks.get(user_id)
        if lock is None:
            lock = threading.Lock()
            _roleplay_user_locks[user_id] = lock
        return lock


def _acquire_roleplay_request_lock(user_id: str) -> LockType:
    lock = _roleplay_lock_for(str(user_id))
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail=ROLEPLAY_BUSY_MESSAGE)
    return lock


def _release_roleplay_request_lock(lock: LockType | None) -> None:
    if not lock:
        return
    try:
        lock.release()
    except RuntimeError:
        logger.warning("Roleplay request lock was already released")


def _raise_roleplay_limit_error(exc: LLMConcurrencyLimitError) -> None:
    raise HTTPException(status_code=429, detail=ROLEPLAY_LIMIT_MESSAGE) from exc


def _realtime_safety_identifier(user_id: str) -> str:
    seed = f"{settings.auth_secret}:{user_id}".encode("utf-8")
    return hashlib.sha256(seed).hexdigest()


def _create_realtime_client_secret(
    *,
    user_id: str,
    instructions: str,
    model: str,
    voice: str,
    transcription_model: str,
) -> dict:
    body = {
        "expires_after": {"anchor": "created_at", "seconds": 600},
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": instructions,
            "audio": {
                "input": {
                    "transcription": {
                        "model": transcription_model,
                    },
                },
                "output": {
                    "voice": voice,
                },
            },
        },
    }
    response = requests.post(
        "https://api.openai.com/v1/realtime/client_secrets",
        headers={
            "Authorization": f"Bearer {settings.effective_roleplay_api_key}",
            "Content-Type": "application/json",
            "OpenAI-Safety-Identifier": _realtime_safety_identifier(user_id),
        },
        json=body,
        timeout=20,
    )
    if response.status_code >= 400:
        detail = response.text[:1000]
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI Realtime 세션 발급에 실패했습니다: {detail}",
        )
    return response.json()


@router.post(
    "/roleplay/realtime/session",
    summary="Realtime 음성 롤플레잉 세션 발급",
    description="브라우저 WebRTC 연결에 사용할 OpenAI Realtime ephemeral client secret을 발급합니다.",
)
async def roleplay_realtime_session(
    payload: RoleplayRealtimeSessionIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    if not settings.effective_roleplay_api_key:
        return {
            "client_secret": "",
            "mode": "fallback",
            "reason": "roleplay_api_key_missing",
        }

    words = await _roleplay_words(session, _user["id"], payload.scenario, payload.tag)
    instructions = roleplay_system_prompt(
        payload.level,
        payload.scenario,
        payload.tag,
        payload.situation,
        words,
    )
    instructions += (
        "\nRealtime voice mode:\n"
        "- Start the role-play when the session begins if the user has not spoken yet.\n"
        "- Keep spoken replies natural, concise, and fully in English.\n"
        "- Do not provide Korean coaching in the spoken reply; coaching is handled separately.\n"
    )
    model = settings.openai_realtime_model
    voice = settings.openai_realtime_voice
    transcription_model = settings.openai_realtime_transcribe_model
    try:
        data = await run_in_threadpool(
            _create_realtime_client_secret,
            user_id=str(_user["id"]),
            instructions=instructions,
            model=model,
            voice=voice,
            transcription_model=transcription_model,
        )
    except HTTPException:
        raise
    except ROLEPLAY_RUNTIME_ERRORS:
        log_exception(logger, "OpenAI Realtime session creation failed")
        raise HTTPException(
            status_code=502,
            detail="OpenAI Realtime 세션 발급에 실패했습니다. 잠시 후 다시 시도해주세요.",
        )

    return {
        "client_secret": data.get("value") or data.get("client_secret", {}).get("value") or "",
        "mode": "realtime",
        "model": model,
        "voice": voice,
        "transcription_model": transcription_model,
        "expires_at": data.get("expires_at") or data.get("client_secret", {}).get("expires_at"),
    }


@router.post(
    "/roleplay/realtime/coaching",
    summary="Realtime 롤플레잉 턴 코칭",
    description="Realtime 음성 턴의 transcript를 바탕으로 한국어 교정 팁을 비동기로 생성합니다.",
)
async def roleplay_realtime_coaching(
    payload: RoleplayRealtimeCoachingIn,
    _user: CurrentUserDep,
):
    usage_token = start_usage_capture()
    try:
        context = [(t[0], t[1]) for t in (_norm_turn(h) for h in payload.history)]
        coaching = await run_in_threadpool(
            coach_roleplay_turn,
            context,
            payload.user_message,
            payload.assistant_reply,
            level=payload.level,
            scenario=payload.scenario,
            tag=payload.tag,
            situation=payload.situation,
        )
        return {"coaching": coaching or ""}
    except LLMConcurrencyLimitError:
        return {"coaching": ""}
    except ROLEPLAY_RUNTIME_ERRORS:
        log_exception(logger, "Realtime roleplay coaching failed")
        return {"coaching": ""}
    finally:
        await safe_persist_usage_capture(usage_token, _user)


@router.post(
    "/roleplay/realtime/usage",
    summary="Realtime 롤플레잉 사용량 기록",
    description="브라우저가 Realtime 이벤트에서 받은 usage 정보를 기존 API 사용량 테이블에 저장합니다.",
)
async def roleplay_realtime_usage(payload: RoleplayRealtimeUsageIn, _user: CurrentUserDep):
    records = build_realtime_usage_records(
        payload,
        realtime_model=settings.openai_realtime_model,
        transcription_model=settings.openai_realtime_transcribe_model,
    )
    stored = await record_api_usage_events(_user["id"], records)
    if not stored:
        raise HTTPException(status_code=503, detail="사용량 기록을 잠시 후 다시 시도해주세요.")
    return {"ok": True}


@router.post(
    "/roleplay/start",
    summary="롤플레잉 대화 시작",
    description=(
        "선택한 레벨, 시나리오, 태그, 상황 설명을 바탕으로 AI 상대역의 첫 메시지를 생성합니다. "
        "태그 모드일 때만 해당 태그 단어를 참고합니다."
    ),
)
async def roleplay_start(payload: RoleplayStartIn, session: SessionDep, _user: CurrentUserDep):
    request_lock = _acquire_roleplay_request_lock(_user["id"])
    usage_token = start_usage_capture()
    try:
        words = await _roleplay_words(session, _user["id"], payload.scenario, payload.tag)
        reply = await run_in_threadpool(
            start_roleplay,
            level=payload.level,
            scenario=payload.scenario,
            tag=payload.tag,
            situation=payload.situation,
            words=words,
        )
        # 첫 턴: 사용자 발화 없음, 코칭 없음.
        return {"history": [["", reply, ""]]}
    except LLMConcurrencyLimitError as exc:
        _raise_roleplay_limit_error(exc)
    finally:
        await safe_persist_usage_capture(usage_token, _user)
        _release_roleplay_request_lock(request_lock)


@router.post(
    "/roleplay/continue",
    summary="롤플레잉 대화 이어가기",
    description=(
        "프론트가 전달한 전체 대화 기록과 새 사용자 메시지를 바탕으로 AI 답변과 한국어 코칭을 "
        "함께 생성합니다."
    ),
)
async def roleplay_continue(payload: RoleplayContinueIn, session: SessionDep, _user: CurrentUserDep):
    request_lock = _acquire_roleplay_request_lock(_user["id"])
    usage_token = start_usage_capture()
    try:
        # LLM 맥락용으로는 (user, bot)만 필요(코칭 제외).
        context = [(t[0], t[1]) for t in (_norm_turn(h) for h in payload.history)]
        words = await _roleplay_words(session, _user["id"], payload.scenario, payload.tag)
        result = await run_in_threadpool(
            continue_roleplay,
            context,
            payload.message,
            level=payload.level,
            scenario=payload.scenario,
            tag=payload.tag,
            situation=payload.situation,
            words=words,
            wrap_up=payload.wrap_up,
        )
        new_history = [_norm_turn(h) for h in payload.history]
        new_history.append([payload.message, result["reply"], result["coaching"]])
        return {"history": new_history}
    except LLMConcurrencyLimitError as exc:
        _raise_roleplay_limit_error(exc)
    finally:
        await safe_persist_usage_capture(usage_token, _user)
        _release_roleplay_request_lock(request_lock)


@router.post(
    "/roleplay/continue/stream",
    summary="롤플레잉 스트리밍 응답",
    description=(
        "AI 답변을 NDJSON 스트림으로 순차 전송하고, 답변이 끝난 뒤 코칭과 갱신된 history를 "
        "추가 이벤트로 반환합니다."
    ),
)
async def roleplay_continue_stream(
    payload: RoleplayContinueIn,
    request: Request,
    session: SessionDep,
    _user: CurrentUserDep,
):
    request_lock = _acquire_roleplay_request_lock(_user["id"])
    try:
        # LLM 맥락용으로는 (user, bot)만 필요(코칭 제외).
        context = [(t[0], t[1]) for t in (_norm_turn(h) for h in payload.history)]
        words = await _roleplay_words(session, _user["id"], payload.scenario, payload.tag)
    except ROLEPLAY_CONTEXT_ERRORS:
        _release_roleplay_request_lock(request_lock)
        raise

    async def events():
        usage_token = start_usage_capture()
        reply_parts: list[str] = []
        sentinel = object()
        iterator = None

        def _line(event: dict) -> str:
            return json.dumps(event, ensure_ascii=False) + "\n"

        try:
            iterator = stream_roleplay_reply(
                context,
                payload.message,
                level=payload.level,
                scenario=payload.scenario,
                tag=payload.tag,
                situation=payload.situation,
                words=words,
                wrap_up=payload.wrap_up,
            )
            while True:
                if await request.is_disconnected():
                    return
                chunk = await run_in_threadpool(next, iterator, sentinel)
                if chunk is sentinel:
                    break
                reply_parts.append(chunk)
                yield _line({"type": "delta", "text": chunk})

                if await request.is_disconnected():
                    return

            reply = "".join(reply_parts).strip()
            coaching = await run_in_threadpool(
                coach_roleplay_turn,
                context,
                payload.message,
                reply,
                level=payload.level,
                scenario=payload.scenario,
                tag=payload.tag,
                situation=payload.situation,
            )
            if coaching:
                yield _line({"type": "coaching", "text": coaching})

            new_history = [_norm_turn(h) for h in payload.history]
            new_history.append([payload.message, reply, coaching])
            yield _line({"type": "done", "history": new_history})
        except LLMConcurrencyLimitError:
            yield _line({"type": "error", "message": ROLEPLAY_LIMIT_MESSAGE})
        except ROLEPLAY_RUNTIME_ERRORS:
            log_exception(logger, "Roleplay streaming failed")
            yield _line({"type": "error", "message": "AI 답변을 생성하지 못했어요. 잠시 후 다시 시도해주세요."})
        finally:
            close = getattr(iterator, "close", None)
            if callable(close):
                close()
            await safe_persist_usage_capture(usage_token, _user)
            _release_roleplay_request_lock(request_lock)

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )


@router.post(
    "/roleplay/summary",
    summary="롤플레잉 대화 정리",
    description=(
        "대화 전체에서 요약, 다음에 재사용할 표현, 유용한 어휘를 추출하고 학습노트 세션으로 저장합니다."
    ),
)
async def roleplay_summary(payload: RoleplaySummaryIn, session: SessionDep, _user: CurrentUserDep):
    """대화 전체에서 요약 + 유용 표현 + 유용 어휘를 추출하고 저장한다."""
    request_lock = _acquire_roleplay_request_lock(_user["id"])
    usage_token = start_usage_capture()
    try:
        context = [(t[0], t[1]) for t in (_norm_turn(h) for h in payload.history)]
        result = await run_in_threadpool(
            summarize_roleplay,
            context,
            level=payload.level,
            scenario=payload.scenario,
            tag=payload.tag,
            situation=payload.situation,
        )
        # 사용자 발화 턴 수 = history에서 user가 있는 항목 수
        turns = sum(1 for u, _b in context if (u or "").strip())
        session_id = await save_roleplay_session(
            session,
            _user["id"],
            payload.level,
            payload.scenario,
            payload.tag,
            payload.situation,
            payload.title,
            turns,
            result.get("summary", ""),
            result.get("expressions", []),
            result.get("vocab", []),
        )
        return {**result, "session_id": session_id}
    except LLMConcurrencyLimitError as exc:
        _raise_roleplay_limit_error(exc)
    finally:
        await safe_persist_usage_capture(usage_token, _user)
        _release_roleplay_request_lock(request_lock)


@router.post(
    "/roleplay/save-words",
    summary="롤플레잉 어휘 단어장 저장",
    description=(
        "정리 페이지에서 선택한 어휘를 단어장에 저장합니다. 한국어 뜻이 비어 있거나 실패값이면 "
        "번역을 보강합니다."
    ),
)
async def roleplay_save_words(payload: RoleplaySaveWordsIn, session: SessionDep, _user: CurrentUserDep):
    """정리 페이지에서 선택한 어휘를 단어장에 저장한다(insert_words 재사용)."""
    usage_token = start_usage_capture()
    try:
        tag = (payload.tag or "미지정").strip() or "미지정"
        items = []
        for it in payload.items:
            word = (it.get("word") or "").strip()
            if not word:
                continue
            korean = (it.get("korean") or "").strip()
            if needs_translation(korean):
                korean = await run_in_threadpool(translate_korean, word)
                if needs_translation(korean):
                    korean = ""
            items.append({
                "word": word,
                "korean": korean,
                "korean_detail": (it.get("korean_detail") or "").strip(),
                "english_def": (it.get("english_def") or "").strip(),
                "example": (it.get("example") or "").strip(),
                "tag": tag,
            })
        if not items:
            return {"ok": False, "added": 0, "skipped": 0}
        result = await insert_words(session, _user["id"], items)
        return {"ok": True, **result}
    finally:
        await safe_persist_usage_capture(usage_token, _user)


@router.get(
    "/roleplay/sessions",
    summary="롤플레잉 학습노트 목록",
    description="저장된 롤플레잉 정리 세션을 최신순으로 조회합니다.",
)
async def roleplay_sessions(session: SessionDep, _user: CurrentUserDep):
    """학습노트: 저장된 롤플레잉 결과 목록(최신순)."""
    return {"sessions": await get_roleplay_sessions(session, _user["id"])}


@router.delete(
    "/roleplay/sessions/{session_id}",
    summary="롤플레잉 학습노트 삭제",
    description="현재 사용자의 저장된 롤플레잉 정리 세션을 삭제합니다.",
)
async def roleplay_session_delete(session_id: int, session: SessionDep, _user: CurrentUserDep):
    ok = await delete_roleplay_session(session, _user["id"], session_id)
    return {"ok": ok}
