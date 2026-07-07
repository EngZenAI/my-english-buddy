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
from backend.exceptions import DATA_COERCION_ERRORS


def _word_brief(word: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": word.get("id"),
        "word": word.get("word") or "",
        "korean": word.get("korean") or "",
        "tag": word.get("tag") or "미지정",
        "example": word.get("example") or "",
        "next_review": word.get("next_review"),
    }


def _format_memory_note(note: str) -> str:
    clean = " ".join(str(note or "").split()).strip(" .,!?:;。")
    replacements = {
        "공부하고싶": "공부하고 싶",
        "공부하고 싶어": "공부",
        "공부하고 싶다": "공부",
        "우선 공부": "우선 학습",
        "쪽을": "중심으로",
        "말고": "보다",
        "하고싶은데": "학습",
        "하고 싶은데": "학습",
    }
    for source, target in replacements.items():
        clean = clean.replace(source, target)
    clean = clean.strip(" .,!?:;。")
    if not clean:
        return ""
    if not any(token in clean for token in ("학습", "연습", "회화", "목표", "선호")):
        clean = f"{clean} 학습"
    return clean[:120]


def _memory_note(memory_notes: list[Any], memory_summaries: list[Any] | None = None) -> str:
    for item in memory_summaries or []:
        note = str(item or "").strip()
        if note:
            return _format_memory_note(note)
    for item in memory_notes:
        note = str(item or "").strip()
        if note:
            return _format_memory_note(note)
    return ""


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
    except DATA_COERCION_ERRORS:
        due_count = len(due_words)
    tag_counts = [
        item for item in (context.get("tag_counts") or [])
        if item.get("name") != "미지정" and int(item.get("count") or 0) > 0
    ]
    weak_words = learning.get("weak_words") or []
    recent_roleplays = learning.get("recent_roleplay_sessions") or []
    memories = context.get("memories") or {}
    learning_preferences = memories.get("learning_preferences") if isinstance(memories.get("learning_preferences"), dict) else {}
    memory_notes = learning_preferences.get("notes") if isinstance(learning_preferences.get("notes"), list) else []
    memory_summaries = learning_preferences.get("summaries") if isinstance(learning_preferences.get("summaries"), list) else []

    cards: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    primary_memory_note = _memory_note(memory_notes, memory_summaries)

    if primary_memory_note:
        cards.append({
            "title": "저장된 학습 기억",
            "body": primary_memory_note,
            "kind": "memory",
        })

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
            "title": "최근 상황으로 다시 연습",
            "body": latest.get("title") or latest.get("summary") or "지난 롤플레잉 상황을 새 대화로 다시 연습할 수 있어요.",
            "kind": "memory",
        })

    message = "오늘 학습 상태를 확인했어요."
    if primary_memory_note and due_count > 0:
        message = f"{primary_memory_note}을 기준으로 보면, 오늘은 복습 예정 단어 {due_count}개부터 짧게 정리하는 흐름이 좋습니다."
    elif primary_memory_note and tag_counts:
        top_tag = max(tag_counts, key=lambda item: int(item.get("count") or 0))
        message = f"{primary_memory_note}을 기준으로 보면, 지금은 #{top_tag['name']} 태그로 회화 연습을 만들기 좋습니다."
    elif primary_memory_note:
        message = f"{primary_memory_note}을 기준으로 오늘 학습을 추천할 수 있어요."
    elif due_count > 0:
        message = f"복습할 단어가 {due_count}개 있어요. 먼저 짧은 퀴즈로 시작하는 걸 추천합니다."
    elif tag_counts:
        message = "복습 예정 단어는 없지만, 단어장 태그로 회화 연습을 만들 수 있어요."

    return {"message": message, "cards": cards[:4], "actions": actions[:3]}
