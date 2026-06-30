"""React 프론트엔드가 사용하는 REST API.

검색 / 단어장 / 퀴즈 / 롤플레잉 / 슬랭 / TTS 기능을 HTTP 엔드포인트로 노출한다.

비회원도 가능: 단어 검색(/search), 발음(/tts), 로그인 상태 확인(/me).
회원 전용: 단어장/태그/퀴즈/롤플레잉/슬랭 (require_user 의존성으로 보호).
"""

import csv
import io
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.api_usage import start_usage_capture, stop_usage_capture
from backend.articles.chunking import estimate_tokens, split_article_text
from backend.articles.extractor import extract_article_text
from backend.articles.retrieval import select_relevant_chunks
from backend.articles.sources import fallback_image_for, match_supported_source
from backend.articles.tutor import (
    answer_article_question,
    complete_article,
    generate_article_study,
)
from backend.auth.password_reset import PasswordResetError, validate_reset_password
from backend.auth.users import get_current_user_from_cookie, password_helper
from backend.dictionary import translate_korean
from backend.db.dependencies import SessionDep
from backend.db.repositories import (
    add_label,
    bulk_delete_words,
    bulk_import_words,
    bulk_update_words,
    count_words_by_tag,
    delete_label,
    delete_article_session,
    delete_word,
    disconnect_oauth_account,
    existing_words_lower,
    get_account_status,
    get_all_words,
    get_article_session,
    get_article_sessions,
    get_article_catalog_item,
    get_activity_summary,
    get_quiz_stats,
    get_user_password_hash,
    get_words_for_quiz,
    get_labels,
    list_admin_articles,
    list_article_sources,
    list_published_articles,
    get_mypage_learning,
    get_mypage_overview,
    get_roleplay_sessions,
    insert_words,
    is_word_saved,
    record_api_usage_events,
    rename_label,
    reorder_words,
    save_word,
    save_roleplay_session,
    create_article_session,
    delete_roleplay_session,
    publish_article,
    update_article_completion,
    update_article_study,
    upsert_article_with_chunks,
    update_user_password_hash,
    update_word,
)
from backend.llm import (
    continue_roleplay,
    explain_slang,
    start_roleplay,
    summarize_roleplay,
)
from backend.quiz.schemas import QuizGenerateIn, QuizGradeIn, QuizReviewScheduleApplyIn
from backend.quiz.service import apply_review_schedule, generate_assignment, grade_assignment
from backend.services import (
    search_from_english,
    search_from_korean,
    synthesize_tts,
)

router = APIRouter(prefix="/api", tags=["api"])


async def require_user(request: Request, session: SessionDep) -> dict:
    """로그인(쿠키) 안 돼 있으면 401. 회원 전용 엔드포인트 보호용."""
    user = await get_current_user_from_cookie(request, session)
    if not user:
        raise HTTPException(status_code=401, detail="회원 전용 기능입니다.")
    return user


CurrentUserDep = Annotated[dict, Depends(require_user)]


async def persist_usage_capture(token, user: dict | None) -> None:
    events = stop_usage_capture(token)
    await record_api_usage_events(user.get("id") if user else None, events)


def defer_usage_capture(
    background_tasks: BackgroundTasks,
    token,
    user: dict | None,
) -> None:
    events = stop_usage_capture(token)
    user_id = user.get("id") if user else None
    if user_id and events:
        background_tasks.add_task(record_api_usage_events, user_id, events)


# ── 스키마 ─────────────────────────────────────────────────
class SaveWordIn(BaseModel):
    word: str
    korean: str = ""
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""  # 선택한 태그(카테고리)
    slang_def: str = ""


class UpdateWordIn(BaseModel):
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""
    next_review: str = ""  # 'YYYY-MM-DD' (빈값이면 변경 안 함)


class BulkUpdateItem(BaseModel):
    id: int
    word: str = ""  # 빈값이면 영어단어 변경 안 함 (기존값 유지)
    korean: str = ""
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""
    next_review: str = ""


class BulkUpdateIn(BaseModel):
    items: list[BulkUpdateItem]


class IdsIn(BaseModel):
    ids: list[int]


class ImportItem(BaseModel):
    word: str
    korean: str = ""
    korean_detail: str = ""
    example: str = ""
    tag: str = ""


class ImportCommitIn(BaseModel):
    items: list[ImportItem]
    overwrite: bool = False  # True면 이미 있는 단어를 값 있는 칸만 덮어씀


class LabelIn(BaseModel):
    name: str


class RenameLabelIn(BaseModel):
    old_name: str
    new_name: str


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


class SlangIn(BaseModel):
    word: str
    korean: str = ""


class AccountPasswordIn(BaseModel):
    current_password: str = ""
    new_password: str


class ArticleAdminIngestIn(BaseModel):
    url: str
    title: str = ""
    source: str = ""
    description: str = ""
    content: str = ""
    image_url: str = ""
    published_at: str = ""
    topic: str = ""
    level: str = ""
    estimated_minutes: int = 0
    publish: bool = False


class ArticleAskIn(BaseModel):
    question: str


class ArticleSaveWordsIn(BaseModel):
    items: list[dict] = Field(..., max_length=100)
    tag: str | None = "뉴스"


class ArticlePublishIn(BaseModel):
    is_published: bool = True


# ── 현재 사용자 ─────────────────────────────────────────────
@router.get("/me")
async def me(request: Request, session: SessionDep):
    user = await get_current_user_from_cookie(request, session)
    return {"user": user}


@router.get("/mypage/overview")
async def mypage_overview(session: SessionDep, _user: CurrentUserDep):
    return await get_mypage_overview(session, _user["id"])


@router.get("/mypage/learning")
async def mypage_learning(session: SessionDep, _user: CurrentUserDep):
    return await get_mypage_learning(session, _user["id"])


@router.get("/mypage/activity")
async def mypage_activity(session: SessionDep, _user: CurrentUserDep):
    return await get_activity_summary(session, _user["id"])


@router.get("/account/status")
async def account_status(session: SessionDep, _user: CurrentUserDep):
    return await get_account_status(session, _user["id"])


@router.post("/account/password")
async def update_account_password(
    payload: AccountPasswordIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    try:
        new_password = validate_reset_password(payload.new_password)
    except PasswordResetError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    current_hash = await get_user_password_hash(session, _user["id"])
    if current_hash:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="현재 비밀번호를 입력해주세요.")
        verified, _updated_hash = password_helper.verify_and_update(
            payload.current_password,
            current_hash,
        )
        if not verified:
            raise HTTPException(status_code=400, detail="현재 비밀번호가 일치하지 않습니다.")

    await update_user_password_hash(
        session,
        _user["id"],
        password_helper.hash(new_password),
    )
    return {"ok": True, "has_password": True}


@router.delete("/account/oauth/{provider}")
async def disconnect_account_oauth(
    provider: str,
    session: SessionDep,
    _user: CurrentUserDep,
):
    provider = provider.strip().lower()
    if provider != "google":
        raise HTTPException(status_code=400, detail="지원하지 않는 연결입니다.")

    status = await get_account_status(session, _user["id"])
    if not status.get("google_connected"):
        return {"ok": True, "deleted": 0}
    if not status.get("has_password"):
        raise HTTPException(
            status_code=400,
            detail="비밀번호를 먼저 설정한 뒤 Google 연결을 해제할 수 있습니다.",
        )

    deleted = await disconnect_oauth_account(session, _user["id"], provider)
    return {"ok": True, "deleted": deleted}


# ── 검색 (비회원 허용) ──────────────────────────────────────
@router.get("/search/english")
async def search_english(
    word: str = "",
    *,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDep,
):
    user = await get_current_user_from_cookie(request, session)
    usage_token = start_usage_capture()
    try:
        return await run_in_threadpool(search_from_english, word)
    finally:
        defer_usage_capture(background_tasks, usage_token, user)


@router.get("/search/korean")
async def search_korean(
    word: str = "",
    *,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDep,
):
    user = await get_current_user_from_cookie(request, session)
    usage_token = start_usage_capture()
    try:
        return await run_in_threadpool(search_from_korean, word)
    finally:
        defer_usage_capture(background_tasks, usage_token, user)


# ── TTS (비회원 허용) ───────────────────────────────────────
@router.get("/tts")
async def tts(
    word: str = "",
    lang: str = "en",
    *,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDep,
):
    user = await get_current_user_from_cookie(request, session)
    usage_token = start_usage_capture()
    try:
        audio_b64 = await run_in_threadpool(synthesize_tts, word, lang)
        return {"audio": audio_b64}  # base64 mp3 또는 null
    finally:
        defer_usage_capture(background_tasks, usage_token, user)


# ── 기사 학습 ───────────────────────────────────────────────
def _require_article_admin(user: dict) -> None:
    if user.get("is_superuser"):
        return
    raise HTTPException(status_code=403, detail="기사 운영자 권한이 필요합니다.")


def _fallback_article_text(payload: ArticleAdminIngestIn, metadata: dict) -> str:
    parts = [
        payload.title or metadata.get("title", ""),
        payload.description or metadata.get("description", ""),
        payload.content,
    ]
    return "\n\n".join([p.strip() for p in parts if p and p.strip()])


def _level_from_text(text: str) -> str:
    words = len((text or "").split())
    if words < 450:
        return "easy"
    if words > 1100:
        return "hard"
    return "medium"


def _minutes_from_text(text: str) -> int:
    words = len((text or "").split())
    return max(3, min(20, round(words / 150) + 3))


@router.get("/article-sources")
async def article_sources(session: SessionDep):
    return {"sources": await list_article_sources(session)}


@router.get("/article-admin/status")
async def article_admin_status(_user: CurrentUserDep):
    return {
        "is_admin": bool(_user.get("is_superuser")),
        "admin_configured": True,
    }


@router.get("/articles")
async def article_catalog(
    topic: str = "",
    level: str = "",
    q: str = "",
    page: int = 1,
    *,
    session: SessionDep,
):
    return await list_published_articles(
        session,
        topic=topic.strip(),
        level=level.strip(),
        q=q.strip(),
        page=page,
    )


@router.get("/articles/{article_id}")
async def article_detail(article_id: int, session: SessionDep):
    data = await get_article_catalog_item(session, article_id, include_unpublished=False)
    if not data:
        raise HTTPException(status_code=404, detail="공개된 기사를 찾을 수 없습니다.")
    return data


@router.post("/articles/{article_id}/sessions")
async def article_session_create(article_id: int, session: SessionDep, _user: CurrentUserDep):
    article = await get_article_catalog_item(session, article_id, include_unpublished=False)
    if not article:
        raise HTTPException(status_code=404, detail="공개된 기사를 찾을 수 없습니다.")
    session_id = await create_article_session(session, _user["id"], article_id)
    return {"ok": True, "session_id": session_id, "article_id": article_id}


@router.get("/admin/articles")
async def article_admin_list(
    page: int = 1,
    *,
    session: SessionDep,
    _user: CurrentUserDep,
):
    _require_article_admin(_user)
    return await list_admin_articles(session, page=page)


@router.post("/admin/articles/ingest")
async def article_admin_ingest(
    payload: ArticleAdminIngestIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    _require_article_admin(_user)
    url = payload.url.strip()
    source = match_supported_source(url)
    if not source:
        raise HTTPException(status_code=400, detail="지원하지 않는 기사 소스입니다.")

    extraction = await run_in_threadpool(extract_article_text, url)
    metadata = extraction.get("metadata") or {}
    text = extraction.get("text") or ""
    status = extraction.get("status") or "failed"
    if len(text.strip()) < 300:
        text = _fallback_article_text(payload, metadata)
        status = f"{status}:fallback_snippet"
    chunks_text = split_article_text(text)
    if not chunks_text:
        raise HTTPException(status_code=422, detail="학습할 기사 본문을 찾지 못했습니다.")

    topic = (payload.topic or source.default_topic or "world").strip().lower()
    image_url = (
        payload.image_url.strip()
        or (metadata.get("image_url") or "").strip()
        or source.fallback_image_url
        or fallback_image_for(topic)
    )
    article_payload = {
        **payload.model_dump(),
        "source_key": source.key,
        "source": payload.source.strip() or source.name,
        "title": payload.title.strip() or metadata.get("title") or url,
        "description": payload.description.strip() or metadata.get("description") or "",
        "image_url": image_url,
        "published_at": payload.published_at or metadata.get("published_at") or "",
        "topic": topic,
        "level": payload.level.strip() or _level_from_text(text),
        "estimated_minutes": payload.estimated_minutes or _minutes_from_text(text),
    }
    chunks = [
        {"chunk_index": idx, "text": chunk, "token_count": estimate_tokens(chunk)}
        for idx, chunk in enumerate(chunks_text)
    ]
    can_publish = payload.publish and status.startswith("extracted")
    article_id = await upsert_article_with_chunks(
        session,
        article_payload,
        chunks,
        extracted_text=text[:20000],
        extraction_status=status,
        publish=can_publish,
    )
    return {
        "ok": True,
        "article_id": article_id,
        "published": can_publish,
        "extraction_status": status,
        "chunk_count": len(chunks),
    }


@router.patch("/admin/articles/{article_id}/publish")
async def article_admin_publish(
    article_id: int,
    payload: ArticlePublishIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    _require_article_admin(_user)
    ok = await publish_article(session, article_id, payload.is_published)
    return {"ok": ok, "is_published": payload.is_published}


@router.get("/article-sessions")
async def article_sessions(session: SessionDep, _user: CurrentUserDep):
    return {"sessions": await get_article_sessions(session, _user["id"])}


@router.get("/article-sessions/{session_id}")
async def article_session_detail(session_id: int, session: SessionDep, _user: CurrentUserDep):
    data = await get_article_session(session, _user["id"], session_id)
    if not data:
        raise HTTPException(status_code=404, detail="기사 학습 세션을 찾을 수 없습니다.")
    return data


@router.post("/article-sessions/{session_id}/study")
async def article_study(session_id: int, session: SessionDep, _user: CurrentUserDep):
    usage_token = start_usage_capture()
    try:
        data = await get_article_session(session, _user["id"], session_id)
        if not data:
            raise HTTPException(status_code=404, detail="기사 학습 세션을 찾을 수 없습니다.")
        study = await run_in_threadpool(
            generate_article_study,
            data.get("title") or "",
            data.get("source") or "",
            data.get("chunks") or [],
        )
        await update_article_study(session, _user["id"], session_id, study)
        return {"ok": True, "study": study, "chunks": data.get("chunks") or []}
    finally:
        await persist_usage_capture(usage_token, _user)


@router.post("/article-sessions/{session_id}/ask")
async def article_ask(
    session_id: int,
    payload: ArticleAskIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="질문을 입력해주세요.")
    usage_token = start_usage_capture()
    try:
        data = await get_article_session(session, _user["id"], session_id)
        if not data:
            raise HTTPException(status_code=404, detail="기사 학습 세션을 찾을 수 없습니다.")
        chunks = select_relevant_chunks(data.get("chunks") or [], question)
        answer = await run_in_threadpool(answer_article_question, question, chunks)
        return {"ok": True, "answer": answer, "evidence": chunks}
    finally:
        await persist_usage_capture(usage_token, _user)


@router.post("/article-sessions/{session_id}/complete")
async def article_complete(session_id: int, session: SessionDep, _user: CurrentUserDep):
    usage_token = start_usage_capture()
    try:
        data = await get_article_session(session, _user["id"], session_id)
        if not data:
            raise HTTPException(status_code=404, detail="기사 학습 세션을 찾을 수 없습니다.")
        completion = await run_in_threadpool(
            complete_article,
            data.get("title") or "",
            data.get("chunks") or [],
        )
        await update_article_completion(session, _user["id"], session_id, completion)
        return {"ok": True, "completion": completion}
    finally:
        await persist_usage_capture(usage_token, _user)


@router.delete("/article-sessions/{session_id}")
async def article_session_delete(session_id: int, session: SessionDep, _user: CurrentUserDep):
    ok = await delete_article_session(session, _user["id"], session_id)
    return {"ok": ok}


@router.post("/article-sessions/{session_id}/save-words")
async def article_save_words(
    session_id: int,
    payload: ArticleSaveWordsIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    usage_token = start_usage_capture()
    try:
        if not await get_article_session(session, _user["id"], session_id):
            raise HTTPException(status_code=404, detail="기사 학습 세션을 찾을 수 없습니다.")
        tag = (payload.tag or "뉴스").strip() or "뉴스"
        labels = await get_labels(session, _user["id"])
        if tag not in labels:
            labels, ok = await add_label(session, _user["id"], tag)
            if not ok and tag not in labels:
                tag = "미지정"
        items = []
        for it in payload.items:
            word = (it.get("word") or "").strip()
            if not word:
                continue
            korean = (it.get("korean") or "").strip()
            if _needs_translation(korean):
                korean = await run_in_threadpool(translate_korean, word)
                if _needs_translation(korean):
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
            return {"ok": False, "added": 0, "updated": 0, "skipped": 0}
        result = await insert_words(session, _user["id"], items)
        return {"ok": True, **result, "tag": tag}
    finally:
        await persist_usage_capture(usage_token, _user)


# ── 단어 저장여부 (검색 화면 배지용, 공개) ──────────────────
@router.get("/words/saved")
async def word_saved(word: str = "", *, session: SessionDep, _user: CurrentUserDep):
    return {"saved": await is_word_saved(session, _user["id"], word)}


# ── 태그(카테고리) — 회원 전용 ─────────────────────────────
@router.get("/labels")
async def list_labels(session: SessionDep, _user: CurrentUserDep):
    return {"labels": await get_labels(session, _user["id"])}


@router.post("/labels")
async def create_label(payload: LabelIn, session: SessionDep, _user: CurrentUserDep):
    labels, ok = await add_label(session, _user["id"], payload.name)
    return {"labels": labels, "ok": ok, "max": 20}


@router.post("/labels/rename")
async def rename_label_ep(payload: RenameLabelIn, session: SessionDep, _user: CurrentUserDep):
    labels, ok, message = await rename_label(
        session,
        _user["id"],
        payload.old_name,
        payload.new_name,
    )
    return {"labels": labels, "ok": ok, "message": message}


@router.get("/labels/word-count")
async def label_word_count(tag: str = "", *, session: SessionDep, _user: CurrentUserDep):
    return {"count": await count_words_by_tag(session, _user["id"], tag) if tag else 0}


@router.delete("/labels")
async def delete_label_ep(name: str = "", *, session: SessionDep, _user: CurrentUserDep):
    labels, ok, message, deleted = await delete_label(session, _user["id"], name)
    return {"labels": labels, "ok": ok, "message": message, "deleted": deleted}


# ── 단어장 — 회원 전용 ─────────────────────────────────────
@router.get("/words")
async def list_words(tag: str = "", *, session: SessionDep, _user: CurrentUserDep):
    return {"words": await get_all_words(session, _user["id"], tag or None)}


@router.post("/words")
async def create_word(payload: SaveWordIn, session: SessionDep, _user: CurrentUserDep):
    word = payload.word.strip()
    if not word:
        return {"ok": False, "message": "단어가 비어 있습니다."}
    final_def = payload.slang_def.strip() or payload.english_def
    tag = payload.tag.strip() or "미지정"  # 태그 미선택 시 기본값
    message = await save_word(
        session,
        _user["id"],
        word.lower(),
        payload.korean,
        payload.korean_detail,
        final_def,
        payload.example,
        tag,
    )
    return {"ok": True, "message": message, "saved": True}


@router.patch("/words/{word_id}")
async def edit_word(word_id: int, payload: UpdateWordIn, session: SessionDep, _user: CurrentUserDep):
    ok = await update_word(
        session,
        _user["id"],
        word_id,
        payload.korean_detail,
        payload.english_def,
        payload.example,
        payload.tag.strip(),
        payload.next_review.strip(),
    )
    if not ok:
        return {"ok": False, "message": "수정할 단어를 찾을 수 없어요."}
    return {"ok": True, "message": "✏️ 수정했어요!"}


@router.delete("/words/{word_id}")
async def remove_word(word_id: int, session: SessionDep, _user: CurrentUserDep):
    ok = await delete_word(session, _user["id"], word_id)
    if not ok:
        return {"ok": False, "message": "삭제할 단어를 찾을 수 없어요."}
    return {"ok": True, "message": "🗑️ 삭제했어요!"}


@router.post("/words/bulk-update")
async def bulk_update(payload: BulkUpdateIn, session: SessionDep, _user: CurrentUserDep):
    items = [it.model_dump() for it in payload.items]
    res = await bulk_update_words(session, _user["id"], items)
    updated = res.get("updated", 0)
    conflicts = res.get("conflicts", [])
    if not res.get("ok", True):
        # swap 등으로 전체 실패
        return {
            "ok": False,
            "updated": 0,
            "skipped": res.get("skipped", 0),
            "conflicts": conflicts,
            "message": res.get("message", "중복으로 저장하지 못했어요."),
        }
    message = f"💾 {updated}개 저장했어요!"
    if conflicts:
        message += (
            f" ({len(conflicts)}개는 이미 있는 단어와 겹쳐 건너뜀: "
            + ", ".join(conflicts) + ")"
        )
    return {
        "ok": True,
        "updated": updated,
        "skipped": res.get("skipped", 0),
        "conflicts": conflicts,
        "message": message,
    }


@router.post("/words/bulk-delete")
async def bulk_delete(payload: IdsIn, session: SessionDep, _user: CurrentUserDep):
    deleted = await bulk_delete_words(session, _user["id"], payload.ids)
    return {"ok": True, "deleted": deleted, "message": f"🗑️ {deleted}개 삭제했어요!"}


@router.post("/words/reorder")
async def reorder(payload: IdsIn, session: SessionDep, _user: CurrentUserDep):
    updated = await reorder_words(session, _user["id"], payload.ids)
    return {"ok": True, "updated": updated}


# ── CSV/XLSX 일괄 가져오기 — 회원 전용 ──────────────────────
def _decode_bytes(content: bytes) -> str:
    """구글 내보내기는 UTF-8, Excel 재저장본은 CP949일 수 있어 차례로 시도."""
    for enc in ("utf-8-sig", "cp949", "utf-8"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


_LANG_EN = {"영어", "english", "en", "eng"}
_LANG_KO = {"한국어", "korean", "ko", "kor"}
_ALL_LANG = _LANG_EN | _LANG_KO


def _looks_like_header(a: str, b: str) -> bool:
    s = (a + " " + b).lower()
    keys = ("영어", "한국어", "english", "word", "korean", "뜻", "translation", "단어")
    return any(k in s for k in keys)


def _row_to_pair(cells) -> tuple[str, str] | None:
    """한 행을 (영어단어, 한국어뜻)으로 변환.
    구글 번역 내보내기는 4열 [소스언어, 타깃언어, 소스텍스트, 타깃텍스트]이고
    행마다 영→한/한→영 방향이 다르므로 언어 라벨을 보고 영어 쪽을 단어로 잡는다.
    그 외에는 단순 2열 [영어, 한국어]로 처리."""
    cells = [("" if c is None else str(c)).strip() for c in cells]
    if (
        len(cells) >= 4
        and cells[0].lower() in _ALL_LANG
        and cells[1].lower() in _ALL_LANG
    ):
        src_lang, tgt_lang, src_txt, tgt_txt = (
            cells[0].lower(), cells[1].lower(), cells[2], cells[3],
        )
        if src_lang in _LANG_EN:
            return src_txt, tgt_txt
        if tgt_lang in _LANG_EN:
            return tgt_txt, src_txt
        return src_txt, tgt_txt
    if len(cells) >= 2:
        return cells[0], cells[1]
    return None


def _rows_from_records(records) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for i, r in enumerate(records):
        pair = _row_to_pair(r)
        if not pair:
            continue
        word, korean = pair
        if not word:
            continue
        # 단순 2열 파일의 헤더 줄만 건너뜀 (구글 4열은 매 행이 데이터)
        if i == 0 and len(list(r)) < 3 and _looks_like_header(word, korean):
            continue
        rows.append((word, korean))
    return rows


def _parse_rows_csv(content: bytes) -> list[tuple[str, str]]:
    text = _decode_bytes(content)
    return _rows_from_records(csv.reader(io.StringIO(text)))


def _parse_rows_xlsx(content: bytes) -> list[tuple[str, str]]:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    return _rows_from_records(ws.iter_rows(values_only=True))


def _parse_upload(file: UploadFile, content: bytes) -> list[tuple[str, str]]:
    name = (file.filename or "").lower()
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        return _parse_rows_xlsx(content)
    return _parse_rows_csv(content)


@router.post("/words/import/preview")
async def import_preview(
    *,
    file: UploadFile = File(...),
    session: SessionDep,
    _user: CurrentUserDep,
):
    """파일을 파싱만 해서 미리보기 행을 돌려준다(저장하지 않음).
    각 행에 이미 보유 중인 단어인지(dup) 표시한다."""
    content = await file.read()
    try:
        rows = _parse_upload(file, content)
    except Exception:
        return {"ok": False, "message": "파일을 읽지 못했어요. CSV 또는 XLSX인지, 첫 두 열이 영어/한국어인지 확인해주세요."}

    if not rows:
        return {"ok": False, "message": "가져올 단어가 없어요. 첫 두 열이 '영어 | 한국어' 형식인지 확인해주세요."}

    existing = await existing_words_lower(session, _user["id"])
    out = [
        {"word": w, "korean": k, "dup": w.lower() in existing}
        for w, k in rows
    ]
    return {"ok": True, "rows": out, "count": len(out)}


@router.post("/words/import/commit")
async def import_commit(payload: ImportCommitIn, session: SessionDep, _user: CurrentUserDep):
    """미리보기에서 검토·편집한 행들을 실제로 저장한다."""
    items = [it.model_dump() for it in payload.items]
    if not items:
        return {"ok": False, "message": "적용할 단어가 없어요."}
    result = await insert_words(session, _user["id"], items, overwrite=payload.overwrite)
    parts = [f"📥 {result['added']}개 추가"]
    if result.get("updated"):
        parts.append(f"{result['updated']}개 덮어씀")
    if result.get("skipped"):
        parts.append(f"{result['skipped']}개는 이미 있어 건너뜀")
    return {
        "ok": True,
        "message": ", ".join(parts),
        **result,
    }


# ── 슬랭 / 구어체 설명 — 회원 전용 (LLM 비용) ──────────────
@router.post("/slang")
async def slang(payload: SlangIn, session: SessionDep, _user: CurrentUserDep):
    word = payload.word.strip()
    if not word:
        return {"explanation": "단어를 먼저 검색해주세요."}
    usage_token = start_usage_capture()
    try:
        return {
            "explanation": await run_in_threadpool(
                explain_slang,
                word,
                payload.korean.strip(),
            )
        }
    finally:
        await persist_usage_capture(usage_token, _user)


# ── 퀴즈 — 회원 전용 ───────────────────────────────────────
@router.post("/quiz/generate")
async def quiz_generate(payload: QuizGenerateIn, session: SessionDep, _user: CurrentUserDep):
    # TODO: 복습 스케줄 기반 출제로 되돌릴 때 get_words_for_quiz에 next_review 조건을 추가한다.
    words = await get_words_for_quiz(
        session,
        _user["id"],
        mode=payload.mode,
        tag=payload.tag.strip(),
        saved_from=payload.saved_from.strip(),
        saved_to=payload.saved_to.strip(),
        limit=max(payload.question_count * 3, payload.question_count),
    )
    usage_token = start_usage_capture()
    try:
        return await generate_assignment(session, _user["id"], words, payload)
    finally:
        await persist_usage_capture(usage_token, _user)


@router.post("/quiz/grade")
async def quiz_grade(payload: QuizGradeIn, session: SessionDep, _user: CurrentUserDep):
    usage_token = start_usage_capture()
    try:
        return await grade_assignment(
            session,
            _user["id"],
            payload.answer_token,
            [answer.model_dump() for answer in payload.answers],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await persist_usage_capture(usage_token, _user)


@router.post("/quiz/review-schedule/apply")
async def quiz_review_schedule_apply(
    payload: QuizReviewScheduleApplyIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    result = await apply_review_schedule(
        session,
        _user["id"],
        payload.session_id,
        payload.incorrect_interval,
    )
    if not result.ok:
        raise HTTPException(status_code=404, detail=result.message)
    return result


@router.get("/quiz/stats")
async def quiz_stats(session: SessionDep, _user: CurrentUserDep):
    return await get_quiz_stats(session, _user["id"])


# ── 롤플레잉 — 회원 전용 ───────────────────────────────────
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


def _needs_translation(value: str) -> bool:
    """LLM/외부 API 결과가 비어 있거나 실패값이면 번역 보강 대상으로 본다."""
    text = (value or "").strip()
    return not text or text in {"번역 실패", "translation failed"}


@router.post("/roleplay/start")
async def roleplay_start(payload: RoleplayStartIn, session: SessionDep, _user: CurrentUserDep):
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
    finally:
        await persist_usage_capture(usage_token, _user)


@router.post("/roleplay/continue")
async def roleplay_continue(payload: RoleplayContinueIn, session: SessionDep, _user: CurrentUserDep):
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
    finally:
        await persist_usage_capture(usage_token, _user)


@router.post("/roleplay/summary")
async def roleplay_summary(payload: RoleplaySummaryIn, session: SessionDep, _user: CurrentUserDep):
    """대화 전체에서 요약 + 유용 표현 + 유용 어휘를 추출하고 저장한다."""
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
    finally:
        await persist_usage_capture(usage_token, _user)


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
            if _needs_translation(korean):
                korean = await run_in_threadpool(translate_korean, word)
                if _needs_translation(korean):
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
        await persist_usage_capture(usage_token, _user)


@router.get("/roleplay/sessions")
async def roleplay_sessions(session: SessionDep, _user: CurrentUserDep):
    """학습노트: 저장된 롤플레잉 결과 목록(최신순)."""
    return {"sessions": await get_roleplay_sessions(session, _user["id"])}


@router.delete("/roleplay/sessions/{session_id}")
async def roleplay_session_delete(session_id: int, session: SessionDep, _user: CurrentUserDep):
    ok = await delete_roleplay_session(session, _user["id"], session_id)
    return {"ok": ok}
