from __future__ import annotations

from collections import Counter
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.action_types import START_QUIZ_WITH_GOAL, START_ROLEPLAY_WITH_SITUATION
from backend.db.repositories import (
    get_agent_memories,
    get_all_words,
    get_labels,
    get_mypage_learning,
    get_words_to_review,
)


def _word_brief(word: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": word.get("id"),
        "word": word.get("word") or "",
        "korean": word.get("korean") or "",
        "tag": word.get("tag") or "미지정",
        "example": word.get("example") or "",
        "next_review": word.get("next_review"),
    }


async def build_agent_context(
    session: AsyncSession,
    user_id: str,
    current_tab: str = "search",
) -> dict[str, Any]:
    learning = await get_mypage_learning(session, user_id)
    labels = await get_labels(session, user_id)
    due_words = await get_words_to_review(session, user_id)
    memories = await get_agent_memories(session, user_id)

    # 단어장 전체를 LLM에 넣지는 않고, 화면 추천과 태그 통계용으로만 압축한다.
    words = await get_all_words(session, user_id)
    tag_counts = Counter((item.get("tag") or "미지정") for item in words)
    recent_words = sorted(
        words,
        key=lambda item: str(item.get("created_at") or ""),
        reverse=True,
    )[:15]

    return {
        "current_tab": current_tab or "search",
        "learning": learning,
        "labels": labels,
        "tag_counts": [
            {"name": name, "count": tag_counts.get(name, 0)}
            for name in labels
        ],
        "due_words": [_word_brief(item) for item in due_words[:20]],
        "recent_words": [_word_brief(item) for item in recent_words],
        "memories": memories,
    }


def build_rule_based_suggestions(context: dict[str, Any]) -> dict[str, Any]:
    due_words = context.get("due_words") or []
    learning = context.get("learning") or {}
    raw_due_count = learning.get("due_review_count")
    try:
        due_count = int(raw_due_count) if raw_due_count is not None else len(due_words)
    except (TypeError, ValueError):
        due_count = len(due_words)
    tag_counts = [
        item for item in (context.get("tag_counts") or [])
        if item.get("name") != "미지정" and int(item.get("count") or 0) > 0
    ]
    weak_words = learning.get("weak_words") or []
    recent_roleplays = learning.get("recent_roleplay_sessions") or []

    cards: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []

    if due_count > 0:
        preview = ", ".join(item["word"] for item in due_words[:5] if item.get("word"))
        cards.append({
            "title": f"복습 예정 단어 {due_count}개",
            "body": preview or "오늘까지 복습할 단어가 있습니다.",
            "kind": "review",
        })
        actions.append({
            "type": START_QUIZ_WITH_GOAL,
            "label": "복습 퀴즈 시작",
            "payload": {"scope_due": True, "question_count": min(10, due_count)},
            "requires_confirmation": True,
        })

    if tag_counts:
        top_tag = max(tag_counts, key=lambda item: int(item.get("count") or 0))
        cards.append({
            "title": f"#{top_tag['name']} 태그 연습",
            "body": f"{top_tag['count']}개 단어를 회화 상황에서 써볼 수 있어요.",
            "kind": "roleplay",
        })
        actions.append({
            "type": START_ROLEPLAY_WITH_SITUATION,
            "label": f"#{top_tag['name']} 롤플레잉",
            "payload": {
                "level": "intermediate",
                "scenario": "tag",
                "tag": top_tag["name"],
                "situation": "",
            },
            "requires_confirmation": True,
        })

    if weak_words:
        cards.append({
            "title": "퀴즈 약점 단어",
            "body": ", ".join((item.get("word") or item.get("target_word") or "") for item in weak_words[:5]),
            "kind": "weak_words",
        })

    if recent_roleplays:
        latest = recent_roleplays[0]
        cards.append({
            "title": "최근 롤플레잉 이어가기",
            "body": latest.get("title") or latest.get("summary") or "지난 대화 표현을 다시 써볼 수 있어요.",
            "kind": "memory",
        })

    message = "오늘 학습 상태를 확인했어요."
    if due_count > 0:
        message = f"복습할 단어가 {due_count}개 있어요. 먼저 짧은 퀴즈로 시작하는 걸 추천합니다."
    elif tag_counts:
        message = "복습 예정 단어는 없지만, 단어장 태그로 회화 연습을 만들 수 있어요."

    return {"message": message, "cards": cards[:4], "actions": actions[:3]}
