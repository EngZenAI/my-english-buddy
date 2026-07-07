from __future__ import annotations

import logging
from typing import Any

from backend.db.repositories import (
    create_agent_job,
    get_all_words,
    get_words_to_review,
    update_agent_job,
)
from backend.db.session import SessionFactory
from backend.exceptions import AGENT_JOB_ERRORS, log_exception

logger = logging.getLogger(__name__)


async def create_wordbook_audit_job(user_id: str) -> str:
    async with SessionFactory() as session:
        return await create_agent_job(
            session,
            user_id,
            "wordbook_audit",
            "단어장을 점검할 준비 중입니다.",
        )


async def run_wordbook_audit_job(user_id: str, job_id: str) -> None:
    async with SessionFactory() as session:
        try:
            await update_agent_job(
                session,
                user_id,
                job_id,
                status="running",
                message="단어장 데이터를 읽고 있습니다.",
            )
            words = await get_all_words(session, user_id)
            due_words = await get_words_to_review(session, user_id)
            total = max(1, len(words))
            missing_examples: list[dict[str, Any]] = []
            missing_defs: list[dict[str, Any]] = []
            untagged: list[dict[str, Any]] = []

            for index, word in enumerate(words, start=1):
                if not (word.get("example") or "").strip():
                    missing_examples.append({"id": word["id"], "word": word.get("word") or ""})
                if not (word.get("english_def") or "").strip():
                    missing_defs.append({"id": word["id"], "word": word.get("word") or ""})
                if not (word.get("tag") or "").strip() or word.get("tag") == "미지정":
                    untagged.append({"id": word["id"], "word": word.get("word") or ""})
                if index == total or index % 25 == 0:
                    await update_agent_job(
                        session,
                        user_id,
                        job_id,
                        progress_current=index,
                        progress_total=total,
                        message=f"단어장 {index}/{total}개 점검 중입니다.",
                    )

            result = {
                "word_count": len(words),
                "due_review_count": len(due_words),
                "missing_example_count": len(missing_examples),
                "missing_definition_count": len(missing_defs),
                "untagged_count": len(untagged),
                "missing_examples": missing_examples[:50],
                "missing_definitions": missing_defs[:50],
                "untagged_words": untagged[:50],
            }
            await update_agent_job(
                session,
                user_id,
                job_id,
                status="completed",
                progress_current=total,
                progress_total=total,
                message="단어장 점검이 완료되었습니다.",
                result=result,
            )
        except AGENT_JOB_ERRORS:
            await session.rollback()
            log_exception(logger, "Wordbook audit job failed job_id=%s user_id=%s", job_id, user_id)
            await update_agent_job(
                session,
                user_id,
                job_id,
                status="failed",
                message="단어장 점검에 실패했습니다.",
                error="단어장 점검 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
            )

