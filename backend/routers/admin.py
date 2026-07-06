import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from backend.articles.chunking import estimate_tokens, split_article_text
from backend.articles.feeds import fetch_feed_entries
from backend.articles.sources import SUPPORTED_SOURCES
from backend.db.dependencies import SessionDep
from backend.db.repositories import (
    create_article_refresh_job,
    delete_admin_article,
    get_admin_api_usage,
    get_admin_learner_detail,
    get_article_catalog_item,
    get_article_refresh_job,
    list_admin_articles,
    list_admin_learners,
    publish_article,
    trim_article_refresh_jobs,
    update_admin_article,
    update_article_refresh_job,
    upsert_article_with_chunks,
    upsert_feed_articles,
)
from backend.db.session import SessionFactory
from backend.exceptions import ARTICLE_REFRESH_ERRORS, ARTICLE_REFRESH_JOB_ERRORS, log_exception
from backend.routers.common import CurrentUserDep, require_admin_user
from backend.schemas.admin import (
    ArticleCreateIn,
    ArticleFeedRefreshIn,
    ArticlePublishIn,
    ArticleUpdateIn,
)

router = APIRouter(tags=["admin"])
logger = logging.getLogger(__name__)
ARTICLE_REFRESH_JOB_LIMIT = 20


async def _trim_article_refresh_jobs(session: SessionDep) -> None:
    await trim_article_refresh_jobs(session, ARTICLE_REFRESH_JOB_LIMIT)


async def _refresh_job_snapshot(session: SessionDep, job_id: str) -> dict:
    job = await get_article_refresh_job(session, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="업데이트 작업을 찾을 수 없습니다.")
    return {
        **job,
        "results": [dict(item) for item in job.get("results", [])],
    }


async def _run_article_feed_refresh_job(
    job_id: str,
    source_keys: list[str],
    publish: bool,
    max_items: int,
) -> None:
    source_by_key = {source.key: source for source in SUPPORTED_SOURCES}
    sources = [source_by_key[key] for key in source_keys if key in source_by_key]

    try:
        async with SessionFactory() as job_session:
            job = await get_article_refresh_job(job_session, job_id)
            if not job:
                return

            job = await update_article_refresh_job(
                job_session,
                job_id,
                status="running",
                started_at=True,
                current_source="",
                message="콘텐츠 업데이트를 시작했습니다.",
            ) or job
            results = list(job.get("results") or [])
            total_saved = int(job.get("saved") or 0)
            total_skipped = int(job.get("skipped") or 0)

            for source in sources:
                await update_article_refresh_job(
                    job_session,
                    job_id,
                    current_source=source.name,
                    message=f"{source.name} 뉴스를 가져오는 중입니다.",
                )
                try:
                    entries = await run_in_threadpool(fetch_feed_entries, source, 8, max_items)
                    result = await upsert_feed_articles(job_session, entries, publish=publish)
                    saved = int(result.get("saved") or 0)
                    skipped = int(result.get("skipped") or 0)
                    total_saved += saved
                    total_skipped += skipped
                    results.append(
                        {
                            "source_key": source.key,
                            "source": source.name,
                            "ok": True,
                            "fetched": len(entries),
                            "saved": saved,
                            "skipped": skipped,
                            "error": "",
                        }
                    )
                except ARTICLE_REFRESH_ERRORS as exc:
                    await job_session.rollback()
                    results.append(
                        {
                            "source_key": source.key,
                            "source": source.name,
                            "ok": False,
                            "fetched": 0,
                            "saved": 0,
                            "skipped": 0,
                            "error": str(exc),
                        }
                    )
                finally:
                    completed_sources = min(
                        len(results),
                        int(job.get("total_sources") or len(sources)),
                    )
                    job = await update_article_refresh_job(
                        job_session,
                        job_id,
                        completed_sources=completed_sources,
                        saved=total_saved,
                        skipped=total_skipped,
                        results=results,
                    ) or job

        has_success = any(item.get("ok") for item in results)
        async with SessionFactory() as job_session:
            await update_article_refresh_job(
                job_session,
                job_id,
                status="completed" if has_success else "failed",
                current_source="",
                finished_at=True,
                message=(
                    "콘텐츠 업데이트가 완료되었습니다."
                    if has_success
                    else "콘텐츠 업데이트에 실패했습니다."
                ),
                ok=has_success,
            )
    except ARTICLE_REFRESH_JOB_ERRORS as exc:
        log_exception(logger, "Article feed refresh job failed job_id=%s", job_id)
        async with SessionFactory() as job_session:
            await update_article_refresh_job(
                job_session,
                job_id,
                status="failed",
                current_source="",
                finished_at=True,
                message="콘텐츠 업데이트 중 오류가 발생했습니다.",
                error=str(exc),
                ok=False,
            )


def _require_article_admin(user: dict) -> None:
    require_admin_user(user)


@router.get(
    "/admin/api-usage",
    summary="관리자 API 사용량 조회",
    description="운영자가 날짜, 기간, 집계 단위별 API 사용량을 확인합니다.",
)
async def admin_api_usage(
    date: str = "",
    start_date: str = "",
    end_date: str = "",
    group_by: str = "hour",
    range_key: str = Query("day", alias="range"),
    *,
    session: SessionDep,
    _user: CurrentUserDep,
):
    require_admin_user(_user)
    raw_date = (date or datetime.now().date().isoformat()).strip()
    try:
        date_value = datetime.strptime(raw_date, "%Y-%m-%d").date()
    except ValueError:
        date_value = datetime.now().date()

    def parse_optional_date(value: str):
        value = (value or "").strip()
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            return None

    start_date_value = parse_optional_date(start_date)
    end_date_value = parse_optional_date(end_date)
    return await get_admin_api_usage(
        session,
        date_value,
        group_by,
        range_key,
        start_date_value,
        end_date_value,
    )


@router.get(
    "/admin/learners",
    summary="관리자 학습자 목록 조회",
    description="검색어, 상태, 페이지 조건으로 가입 학습자 목록을 조회합니다.",
)
async def admin_learners(
    q: str = "",
    status: str = "",
    page: int = 1,
    page_size: int = 20,
    *,
    session: SessionDep,
    _user: CurrentUserDep,
):
    require_admin_user(_user)
    return await list_admin_learners(session, q=q, status=status, page=page, page_size=page_size)


@router.get(
    "/admin/learners/{learner_ref}",
    summary="관리자 학습자 상세 조회",
    description="이메일 또는 내부 식별자로 특정 학습자의 상세 학습/계정 정보를 조회합니다.",
)
async def admin_learner_detail(learner_ref: str, session: SessionDep, _user: CurrentUserDep):
    require_admin_user(_user)
    data = await get_admin_learner_detail(session, learner_ref)
    if not data:
        raise HTTPException(status_code=404, detail="학습자를 찾을 수 없습니다.")
    return data


@router.get(
    "/article-admin/status",
    summary="뉴스 관리자 권한 상태 조회",
    description="현재 사용자가 뉴스 콘텐츠 관리 권한을 가진 운영자인지 확인합니다.",
)
async def article_admin_status(_user: CurrentUserDep):
    return {
        "is_admin": bool(_user.get("is_superuser")),
        "admin_configured": True,
    }


@router.get(
    "/admin/articles",
    summary="관리자 뉴스 자료 목록 조회",
    description="공개/비공개를 포함한 뉴스 학습 자료 목록을 운영자 화면에서 조회합니다.",
)
async def article_admin_list(
    page: int = 1,
    q: str = "",
    *,
    session: SessionDep,
    _user: CurrentUserDep,
):
    _require_article_admin(_user)
    return await list_admin_articles(session, page=page, q=q.strip())


@router.post(
    "/admin/articles",
    summary="관리자 뉴스 자료 생성",
    description="운영자가 직접 입력한 기사 제목, 원문 URL, 본문, 주제, 레벨로 학습 자료를 생성합니다.",
)
async def article_admin_create(
    payload: ArticleCreateIn,
    *,
    session: SessionDep,
    _user: CurrentUserDep,
):
    _require_article_admin(_user)
    title = payload.title.strip()
    url = payload.url.strip()
    content = payload.content.strip()
    source_name = payload.source.strip()
    if not title:
        raise HTTPException(status_code=400, detail="제목을 입력해주세요.")
    if not url:
        raise HTTPException(status_code=400, detail="원본 URL을 입력해주세요.")
    if not source_name:
        raise HTTPException(status_code=400, detail="소스를 입력해주세요.")
    if not content:
        raise HTTPException(status_code=400, detail="본문을 입력해주세요.")
    source_key = "manual-" + uuid.uuid5(uuid.NAMESPACE_URL, source_name.lower()).hex[:16]
    chunks = [
        {"chunk_index": index, "text": chunk, "token_count": estimate_tokens(chunk)}
        for index, chunk in enumerate(split_article_text(content))
    ]
    article_id = await upsert_article_with_chunks(
        session,
        {
            "source_key": source_key,
            "source": source_name,
            "title": title,
            "url": url,
            "image_url": payload.image_url.strip(),
            "topic": payload.topic.strip() or "General",
            "level": payload.level.strip() or "B1",
            "description": payload.description.strip() or content[:280],
            "content_snippet": content[:700],
            "license_status": "approved",
            "collection_method": "manual",
        },
        chunks,
        extracted_text=content,
        extraction_status="manual",
        publish=bool(payload.is_published),
    )
    return {"ok": True, "article_id": article_id}


@router.get(
    "/admin/articles/{article_id}",
    summary="관리자 뉴스 자료 상세 조회",
    description="공개 여부와 무관하게 특정 뉴스 학습 자료의 상세 정보를 조회합니다.",
)
async def article_admin_detail(article_id: int, session: SessionDep, _user: CurrentUserDep):
    _require_article_admin(_user)
    data = await get_article_catalog_item(session, article_id, include_unpublished=True)
    if not data:
        raise HTTPException(status_code=404, detail="뉴스 자료를 찾을 수 없습니다.")
    return data


@router.patch(
    "/admin/articles/{article_id}",
    summary="관리자 뉴스 자료 수정",
    description="운영자가 뉴스 학습 자료의 메타데이터, 공개 여부, 본문을 수정합니다.",
)
async def article_admin_update(
    article_id: int,
    payload: ArticleUpdateIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    _require_article_admin(_user)
    title = payload.title.strip()
    url = payload.url.strip()
    content = payload.content.strip()
    source_name = payload.source.strip()
    if not title:
        raise HTTPException(status_code=400, detail="제목을 입력해주세요.")
    if not url:
        raise HTTPException(status_code=400, detail="원본 URL을 입력해주세요.")
    if not source_name:
        raise HTTPException(status_code=400, detail="소스를 입력해주세요.")
    if not content:
        raise HTTPException(status_code=400, detail="본문을 입력해주세요.")
    source_key = "manual-" + uuid.uuid5(uuid.NAMESPACE_URL, source_name.lower()).hex[:16]
    ok = await update_admin_article(
        session,
        article_id,
        {
            "source_key": source_key,
            "source": source_name,
            "title": title,
            "url": url,
            "image_url": payload.image_url.strip(),
            "topic": payload.topic.strip() or "General",
            "level": payload.level.strip() or "B1",
            "description": payload.description.strip() or content[:280],
            "is_published": bool(payload.is_published),
        },
        content,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="뉴스 자료를 찾을 수 없습니다.")
    return {"ok": True, "article_id": article_id}


@router.delete(
    "/admin/articles/{article_id}",
    summary="관리자 뉴스 자료 삭제",
    description="운영자가 뉴스 학습 자료를 삭제합니다.",
)
async def article_admin_delete(article_id: int, session: SessionDep, _user: CurrentUserDep):
    _require_article_admin(_user)
    ok = await delete_admin_article(session, article_id)
    if not ok:
        raise HTTPException(status_code=404, detail="뉴스 자료를 찾을 수 없습니다.")
    return {"ok": True}


@router.post(
    "/admin/article-feeds/refresh",
    summary="뉴스 피드 업데이트 시작",
    description="승인된 뉴스 RSS/피드 출처에서 새 기사를 가져오는 백그라운드 작업을 시작합니다.",
)
async def article_feed_refresh(
    payload: ArticleFeedRefreshIn,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    _user: CurrentUserDep,
):
    _require_article_admin(_user)
    requested_key = payload.source_key.strip()
    sources = [
        source
        for source in SUPPORTED_SOURCES
        if source.is_active
        and source.license_status == "approved"
        and source.feed_url
        and (not requested_key or source.key == requested_key)
    ]
    if requested_key and not sources:
        raise HTTPException(status_code=404, detail="업데이트할 언론사를 찾지 못했습니다.")

    job_id = uuid.uuid4().hex
    job = await create_article_refresh_job(session, {
        "job_id": job_id,
        "status": "queued",
        "ok": False,
        "source_key": requested_key,
        "total_sources": len(sources),
        "completed_sources": 0,
        "current_source": "",
        "saved": 0,
        "skipped": 0,
        "results": [],
        "error": "",
        "message": "콘텐츠 업데이트 대기 중입니다.",
    })
    await _trim_article_refresh_jobs(session)
    background_tasks.add_task(
        _run_article_feed_refresh_job,
        job_id,
        [source.key for source in sources],
        bool(payload.publish),
        int(payload.max_items or 1),
    )
    return job


@router.get(
    "/admin/article-feeds/refresh/{job_id}",
    summary="뉴스 피드 업데이트 상태 조회",
    description="뉴스 피드 백그라운드 업데이트 작업의 진행 상태와 출처별 결과를 조회합니다.",
)
async def article_feed_refresh_status(job_id: str, session: SessionDep, _user: CurrentUserDep):
    _require_article_admin(_user)
    return await _refresh_job_snapshot(session, job_id)


@router.patch(
    "/admin/articles/{article_id}/publish",
    summary="뉴스 자료 공개 상태 변경",
    description="운영자가 뉴스 학습 자료의 공개/비공개 상태만 빠르게 변경합니다.",
)
async def article_admin_publish(
    article_id: int,
    payload: ArticlePublishIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    _require_article_admin(_user)
    ok = await publish_article(session, article_id, payload.is_published)
    return {"ok": ok, "is_published": payload.is_published}
