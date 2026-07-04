import json
import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from backend.api_usage import start_usage_capture
from backend.articles.feeds import fetch_feed_entries
from backend.articles.retrieval import select_relevant_chunks
from backend.articles.sources import SUPPORTED_SOURCES
from backend.articles.tutor import (
    answer_article_question,
    complete_article,
    generate_article_study,
)
from backend.dictionary import translate_korean
from backend.db.dependencies import SessionDep
from backend.db.repositories import (
    add_label,
    create_article_refresh_job,
    create_article_session,
    delete_admin_article,
    delete_article_session,
    get_admin_api_usage,
    get_admin_learner_detail,
    get_article_catalog_item,
    get_article_refresh_job,
    get_article_session,
    get_article_sessions,
    get_labels,
    insert_words,
    list_admin_articles,
    list_admin_learners,
    list_article_sources,
    list_published_articles,
    publish_article,
    trim_article_refresh_jobs,
    update_admin_article,
    update_article_completion,
    update_article_refresh_job,
    update_article_study,
    upsert_article_with_chunks,
    upsert_feed_articles,
)
from backend.db.session import SessionFactory
from backend.routers.common import (
    CurrentUserDep,
    needs_translation,
    persist_usage_capture,
    require_admin_user,
)
from backend.schemas.articles import ArticleAskIn, ArticleSaveWordsIn

router = APIRouter(tags=["articles"])
logger = logging.getLogger(__name__)


@router.get("/article-sources")
async def article_sources(session: SessionDep):
    return {"sources": await list_article_sources(session)}


@router.get("/articles")
async def article_catalog(
    topic: str = "",
    level: str = "",
    q: str = "",
    page: int = 1,
    *,
    session: SessionDep,
):
    if topic.strip().lower() == "opinion":
        return {
            "articles": [],
            "page": max(1, int(page or 1)),
            "page_size": 12,
            "total": 0,
        }
    return await list_published_articles(
        session,
        topic=topic.strip(),
        level=level.strip(),
        q=q.strip(),
        page=page,
    )


@router.get("/articles/{article_id}")
async def article_detail(article_id: int, session: SessionDep):
    data = await get_article_catalog_item(
        session, article_id, include_unpublished=False
    )
    if not data:
        raise HTTPException(status_code=404, detail="공개된 기사를 찾을 수 없습니다.")
    return data


@router.post("/articles/{article_id}/sessions")
async def article_session_create(
    article_id: int, session: SessionDep, _user: CurrentUserDep
):
    article = await get_article_catalog_item(
        session, article_id, include_unpublished=False
    )
    if not article:
        raise HTTPException(status_code=404, detail="공개된 기사를 찾을 수 없습니다.")
    session_id = await create_article_session(session, _user["id"], article_id)
    return {"ok": True, "session_id": session_id, "article_id": article_id}


@router.get("/article-sessions")
async def article_sessions(session: SessionDep, _user: CurrentUserDep):
    return {"sessions": await get_article_sessions(session, _user["id"])}


@router.get("/article-sessions/{session_id}")
async def article_session_detail(
    session_id: int, session: SessionDep, _user: CurrentUserDep
):
    data = await get_article_session(session, _user["id"], session_id)
    if not data:
        raise HTTPException(
            status_code=404, detail="뉴스 리딩 세션을 찾을 수 없습니다."
        )
    return data


@router.post("/article-sessions/{session_id}/study")
async def article_study(session_id: int, session: SessionDep, _user: CurrentUserDep):
    usage_token = start_usage_capture()
    try:
        data = await get_article_session(session, _user["id"], session_id)
        if not data:
            raise HTTPException(
                status_code=404, detail="뉴스 리딩 세션을 찾을 수 없습니다."
            )
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
            raise HTTPException(
                status_code=404, detail="뉴스 리딩 세션을 찾을 수 없습니다."
            )
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
            raise HTTPException(
                status_code=404, detail="뉴스 리딩 세션을 찾을 수 없습니다."
            )
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
async def article_session_delete(
    session_id: int, session: SessionDep, _user: CurrentUserDep
):
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
            raise HTTPException(
                status_code=404, detail="뉴스 리딩 세션을 찾을 수 없습니다."
            )
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
            if needs_translation(korean):
                korean = await run_in_threadpool(translate_korean, word)
                if needs_translation(korean):
                    korean = ""
            items.append(
                {
                    "word": word,
                    "korean": korean,
                    "korean_detail": (it.get("korean_detail") or "").strip(),
                    "english_def": (it.get("english_def") or "").strip(),
                    "example": (it.get("example") or "").strip(),
                    "tag": tag,
                }
            )
        if not items:
            return {"ok": False, "added": 0, "updated": 0, "skipped": 0}
        result = await insert_words(session, _user["id"], items)
        return {"ok": True, **result, "tag": tag}
    finally:
        await persist_usage_capture(usage_token, _user)
