from __future__ import annotations

import re
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


_MEMORY_COMMAND_SUFFIXES = (
    "기억해줘",
    "기억해 줘",
    "기억해",
    "저장해줘",
    "저장해 줘",
)


def _clean_text(value: str) -> str:
    return " ".join(str(value or "").split()).strip(" .,!?:;。")


def _strip_memory_command(value: str) -> str:
    clean = _clean_text(value)
    for suffix in _MEMORY_COMMAND_SUFFIXES:
        if clean.endswith(suffix):
            return _clean_text(clean[: -len(suffix)])
    return clean


def _dedupe_learning_terms(value: str) -> str:
    clean = value
    for term in ("학습", "공부", "연습", "회화"):
        clean = clean.replace(f"{term}{term}", term)
        clean = re.sub(rf"({re.escape(term)})(?:\s+\1)+", term, clean)
    return _clean_text(clean)


def normalize_learning_preference(note: str, fallback: str = "") -> str:
    clean = _strip_memory_command(note)
    replacements = (
        ("공부하고싶", "공부하고 싶"),
        ("연습하고싶", "연습하고 싶"),
        ("학습하고싶", "학습하고 싶"),
        ("쪽을", "중심으로"),
        ("쪽으로", "중심으로"),
        ("말고", "보다"),
        ("우선 공부", "우선 학습"),
    )
    for source, target in replacements:
        clean = clean.replace(source, target)

    clean = _dedupe_learning_terms(clean)
    clean = re.sub(r"\s*하고 싶(?:은데|어|다|습니다)?$", "", clean)
    clean = re.sub(r"\s*하고 싶은(?:데|)$", "", clean)
    clean = _dedupe_learning_terms(clean)

    if "보다" in clean:
        clean = _clean_text(clean.split("보다", 1)[1])

    clean = clean.replace("중심으로", "중심")
    clean = re.sub(r"(을|를)\s+(학습|공부|연습)$", r" \2", clean)
    clean = re.sub(r"\b우선\s+(학습|공부|연습)$", r"\1", clean)
    clean = re.sub(r"\s+우선\s+(학습|공부|연습)$", r" \1", clean)
    clean = re.sub(r"(을|를)\s+(학습|공부|연습)$", r" \2", clean)
    clean = re.sub(r"\s+", " ", clean)
    clean = _dedupe_learning_terms(clean)
    if not clean:
        return fallback
    if not any(token in clean for token in ("학습", "연습", "회화", "목표", "선호", "약점")):
        clean = f"{clean} 학습"
    return clean[:80]


def _memory_note(memory_notes: list[Any], memory_summaries: list[Any] | None = None) -> str:
    for item in memory_summaries or []:
        note = normalize_learning_preference(str(item or ""))
        if note:
            return note
    for item in memory_notes:
        note = normalize_learning_preference(str(item or ""))
        if note:
            return note
    return ""


def _memory_intro(memory_note: str) -> str:
    if not memory_note:
        return ""
    if any(token in memory_note for token in ("목표", "약점")):
        return f"저장된 학습 메모({memory_note})를 반영했어요."
    return f"{memory_note} 선호를 반영했어요."


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

    if due_count > 0:
        preview = ", ".join(item["word"] for item in due_words[:5] if item.get("word"))
        action = {
            "type": START_QUIZ_WITH_GOAL,
            "label": "복습 퀴즈 시작",
            "payload": {"scope_due": True, "question_count": min(10, due_count)},
            "requires_confirmation": True,
        }
        cards.append({
            "title": f"복습 예정 {due_count}개",
            "body": preview or "오늘까지 복습할 단어가 있습니다.",
            "kind": "review",
            "payload": {"action": action},
        })
        actions.append(action)

    if tag_counts:
        top_tag = max(tag_counts, key=lambda item: int(item.get("count") or 0))
        action = {
            "type": START_ROLEPLAY_WITH_SITUATION,
            "label": f"#{top_tag['name']} 롤플레잉",
            "payload": {
                "level": "intermediate",
                "scenario": "tag",
                "tag": top_tag["name"],
                "situation": "",
            },
            "requires_confirmation": True,
        }
        cards.append({
            "title": f"#{top_tag['name']} 회화 연습",
            "body": f"{top_tag['count']}개 단어를 회화 상황에서 써볼 수 있어요.",
            "kind": "roleplay",
            "payload": {"action": action},
        })
        actions.append(action)

    if weak_words:
        weak_preview = ", ".join(
            (item.get("word") or item.get("target_word") or "")
            for item in weak_words[:5]
            if item.get("word") or item.get("target_word")
        )
        cards.append({
            "title": "약점 단어",
            "body": weak_preview or "최근 퀴즈에서 반복해서 틀린 단어가 있습니다.",
            "kind": "weak_words",
        })
    elif recent_roleplays:
        latest = recent_roleplays[0]
        cards.append({
            "title": "최근 상황 다시 연습",
            "body": latest.get("title") or latest.get("summary") or "지난 롤플레잉 상황을 새 대화로 다시 연습할 수 있어요.",
            "kind": "memory",
        })

    message = "오늘 학습 상태를 확인했어요."
    prefix = _memory_intro(primary_memory_note)
    if primary_memory_note and due_count > 0:
        message = f"{prefix} 오늘은 복습 예정 단어 {due_count}개를 먼저 짧게 점검해 보세요."
    elif primary_memory_note and tag_counts:
        top_tag = max(tag_counts, key=lambda item: int(item.get("count") or 0))
        message = f"{prefix} 지금은 #{top_tag['name']} 태그로 회화 연습을 만들기 좋습니다."
    elif primary_memory_note:
        message = f"{prefix} 오늘 학습은 이 방향에 맞춰 추천할게요."
    elif due_count > 0:
        message = f"복습 예정 단어가 {due_count}개 있어요. 먼저 짧은 퀴즈로 점검해 보세요."
    elif tag_counts:
        message = "복습 예정 단어는 없지만, 단어장 태그로 회화 연습을 만들 수 있어요."

    return {"message": message, "cards": cards[:3], "actions": actions[:3]}
