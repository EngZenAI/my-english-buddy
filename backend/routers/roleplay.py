import json
import logging
import threading
from _thread import LockType

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response, StreamingResponse

from backend.api_usage import start_usage_capture
from backend.dictionary import translate_korean
from backend.db.dependencies import SessionDep
from backend.db.repositories import (
    delete_roleplay_session,
    get_all_words,
    get_roleplay_sessions,
    insert_words,
    save_roleplay_session,
)
from backend.llm import (
    LLMConcurrencyLimitError,
    coach_roleplay_turn,
    continue_roleplay,
    start_roleplay,
    stream_roleplay_reply,
    summarize_roleplay,
)
from backend.roleplay_tts import (
    DEFAULT_TTS_MODEL,
    DEFAULT_TTS_VOICE,
    normalize_tts_text,
    roleplay_tts_cache_key,
    synthesize_roleplay_tts,
)
from backend.routers.common import CurrentUserDep, needs_translation, safe_persist_usage_capture

router = APIRouter(tags=["roleplay"])
logger = logging.getLogger(__name__)

ROLEPLAY_TTS_MAX_CHARS = 400
ROLEPLAY_BUSY_MESSAGE = "이전 롤플레잉 AI 응답이 아직 끝나지 않았어요. 완료 후 다시 시도해주세요."
ROLEPLAY_LIMIT_MESSAGE = "AI 롤플레잉 요청이 많아 잠시 대기 중입니다. 방금 전 요청이 끝난 뒤 다시 시도해주세요."

_roleplay_lock_guard = threading.Lock()
_roleplay_user_locks: dict[str, LockType] = {}


class RoleplayStartIn(BaseModel):
    level: str = "intermediate"          # beginner | intermediate | advanced
    scenario: str = "general"            # general | opic | tag
    tag: str | None = None               # scenario == "tag" 일 때 사용
    situation: str = ""                  # 예시 카드/자유 입력의 구체적 상황


class RoleplayContinueIn(BaseModel):
    history: list  # [[user, bot, coaching], ...]
    message: str
    level: str = "intermediate"
    scenario: str = "general"
    tag: str | None = None
    situation: str = ""
    wrap_up: bool = False  # True면 AI가 자연스럽게 대화를 마무리하도록 유도


class RoleplaySummaryIn(BaseModel):
    history: list  # [[user, bot, coaching], ...]
    level: str = "intermediate"
    scenario: str = "general"
    tag: str | None = None
    situation: str = ""
    title: str = ""  # 진행 칩 제목(카드 라벨 / 자유주제 / #태그) — 학습노트 표시용


class RoleplaySaveWordsIn(BaseModel):
    items: list  # [{word, korean, korean_detail?, english_def?, example?}, ...]
    tag: str | None = None


class RoleplayTtsIn(BaseModel):
    text: str


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


@router.post("/roleplay/start")
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


@router.post("/roleplay/continue")
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


@router.post("/roleplay/continue/stream")
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
    except Exception:
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
        except Exception:
            logger.exception("Roleplay streaming failed")
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


@router.post("/roleplay/summary")
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


@router.post("/roleplay/save-words")
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


@router.post("/roleplay/tts")
async def roleplay_tts(
    payload: RoleplayTtsIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    """Gemini TTS로 roleplay 답변 음성을 만들고, 저장 없이 오디오 바이트를 반환한다."""
    text_value = normalize_tts_text(payload.text)
    if not text_value:
        raise HTTPException(status_code=400, detail="읽을 문장이 없습니다.")
    if len(text_value) > ROLEPLAY_TTS_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"읽을 문장은 {ROLEPLAY_TTS_MAX_CHARS}자 이내로 입력해주세요.",
        )

    model = DEFAULT_TTS_MODEL
    voice = DEFAULT_TTS_VOICE
    cache_key = roleplay_tts_cache_key(text_value, model=model, voice=voice)

    usage_token = start_usage_capture()
    try:
        wav_bytes, mime_type, model, voice = await run_in_threadpool(
            synthesize_roleplay_tts,
            text_value,
            model=model,
            voice=voice,
        )
        return Response(
            content=wav_bytes,
            media_type=mime_type,
            headers={
                "X-TTS-Cache-Key": cache_key,
                "X-TTS-Source": "generated",
                "X-TTS-Model": model,
                "X-TTS-Voice": voice,
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        )
    except Exception:
        logger.exception("Roleplay TTS generation failed")
        raise HTTPException(
            status_code=502,
            detail="AI 음성 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
        )
    finally:
        await safe_persist_usage_capture(usage_token, _user)


@router.get("/roleplay/sessions")
async def roleplay_sessions(session: SessionDep, _user: CurrentUserDep):
    """학습노트: 저장된 롤플레잉 결과 목록(최신순)."""
    return {"sessions": await get_roleplay_sessions(session, _user["id"])}


@router.delete("/roleplay/sessions/{session_id}")
async def roleplay_session_delete(session_id: int, session: SessionDep, _user: CurrentUserDep):
    ok = await delete_roleplay_session(session, _user["id"], session_id)
    return {"ok": ok}
