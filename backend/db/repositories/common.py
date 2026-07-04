from typing import Any
from uuid import UUID

DEFAULT_LABELS = ["미지정", "여행", "비즈니스", "일상", "IT·코딩", "학업"]
MAX_LABELS = 20

FEATURE_LABELS = {
    "dictionary": "사전 검색",
    "translate": "번역",
    "tts": "발음 듣기",
    "slang": "슬랭 설명",
    "quiz": "AI 퀴즈",
    "roleplay": "롤플레잉",
    "article": "뉴스 리딩",
}

OPERATION_LABELS = {
    ("dictionary", "lookup"): "사전 검색",
    ("translate", "en_to_ko"): "영한 번역",
    ("translate", "ko_to_en"): "한영 번역",
    ("tts", "synthesize"): "발음 듣기",
    ("slang", "explain"): "슬랭 설명",
    ("quiz", "generate_quiz"): "AI 퀴즈 생성",
    ("quiz", "grade_subjective"): "주관식 채점",
    ("roleplay", "start"): "롤플레잉 시작",
    ("roleplay", "continue"): "롤플레잉 대화",
    ("roleplay", "summary"): "롤플레잉 정리",
    ("article", "study"): "뉴스 리딩",
    ("article", "ask"): "뉴스 리딩 질문",
    ("article", "complete"): "뉴스 리딩 정리",
}


def _rows(result) -> list[dict[str, Any]]:
    return [dict(row) for row in result.mappings().all()]


def _uuid(value: str) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def _feature_label(feature: str) -> str:
    return FEATURE_LABELS.get(feature or "", feature or "기타")


def _operation_label(feature: str, operation: str) -> str:
    return OPERATION_LABELS.get(
        (feature or "", operation or ""),
        _feature_label(feature),
    )
