import base64
import errno
import hashlib
import hmac
import json
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any

from langchain_core.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

import backend.llm as llm_module
from backend.config import settings
from backend.db.repositories import (
    apply_quiz_review_schedule,
    create_quiz_session,
    existing_words_lower,
    save_results_and_complete_session,
)
from backend.exceptions import DATA_COERCION_ERRORS, QUIZ_LLM_ERRORS
from backend.prompts.quiz import build_quiz_generation_prompt, build_subjective_grade_prompt
from backend.quiz.schemas import (
    QuizChoice,
    QuizGenerateIn,
    QuizGenerateResponse,
    QuizGradedQuestion,
    QuizGradeResponse,
    QuizQuestion,
    QuizReviewScheduleApplyResponse,
    QuizReviewScheduleItem,
)
from backend.usage.tracking import extract_token_usage, track_llm_usage

logger = logging.getLogger(__name__)
quiz_llm = llm_module.get_llm("quiz_generate")

DEFAULT_QUESTION_COUNT = 10
MAX_QUESTION_COUNT = 10
MAX_CANDIDATES = 50
TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24
WORD_PAYLOAD_TEXT_LIMIT = 220
CHOICE_IDS = ("A", "B", "C", "D")
QUESTION_TYPES = (
    "meaning_choice",
    "context_choice",
    "collocation_choice",
    "usage_choice",
    "short_answer",
    "sentence_answer",
)
CHOICE_QUESTION_TYPES = {
    "meaning_choice",
    "context_choice",
    "collocation_choice",
    "usage_choice",
}
SAVED_GRAMMAR_BLANK_CHOICE_ALIASES = {"_".join(("to" + "eic", "part5"))}
GENERATION_ATTEMPTS = 3
GENERATION_BATCH_SIZE = 5
GENERATION_SPLIT_THRESHOLD = 6
WORD_CANDIDATES_PER_QUESTION = 1

class _GeneratedChoice(BaseModel):
    id: str = Field(description="A, B, C, or D")
    text: str


class _GeneratedQuestion(BaseModel):
    word_id: int
    source_word_id: int | None = None
    source_word: str = ""
    target_word: str
    question_type: str
    difficulty: str
    prompt: str
    passage: str = ""
    choices: list[_GeneratedChoice] = Field(default_factory=list)
    correct_choice_id: str = ""
    acceptable_answers: list[str] = Field(default_factory=list)
    explanation: str = ""
    answer_explanation: str = ""
    choice_explanations: dict[str, str] = Field(default_factory=dict)
    study_note: str = ""
    is_derived: bool = False
    is_related: bool = False
    relation_type: str = ""
    derived_from_word_id: int | None = None
    suggested_korean: str = ""
    suggested_english_def: str = ""
    suggested_example: str = ""
    suggested_tag: str = ""


class _GeneratedQuiz(BaseModel):
    questions: list[_GeneratedQuestion]


class _SubjectiveGrade(BaseModel):
    status: str = Field(description="correct, partial, or incorrect")
    score: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    feedback: str


_quiz_parser = PydanticOutputParser(pydantic_object=_GeneratedQuiz)
_subjective_parser = PydanticOutputParser(pydantic_object=_SubjectiveGrade)

def _clamp_question_count(value: int | None) -> int:
    try:
        count = int(value or DEFAULT_QUESTION_COUNT)
    except DATA_COERCION_ERRORS:
        count = DEFAULT_QUESTION_COUNT
    return max(1, min(count, MAX_QUESTION_COUNT))


def _requested_question_count(goal: QuizGenerateIn) -> int:
    type_total = sum(
        max(0, int(value or 0))
        for key, value in (goal.question_type_counts or {}).items()
        if key in QUESTION_TYPES
    )
    return _clamp_question_count(type_total or goal.question_count)


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode())


def _sign(payload_b64: str) -> str:
    digest = hmac.new(
        settings.auth_secret.encode(),
        payload_b64.encode(),
        hashlib.sha256,
    ).digest()
    return _b64_encode(digest)


def _make_answer_token(user_id: str, session_id: int, questions: list[dict[str, Any]]) -> str:
    payload = {
        "uid": str(user_id),
        "sid": int(session_id),
        "iat": int(time.time()),
        "questions": questions,
    }
    payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    payload_b64 = _b64_encode(payload_json.encode())
    return f"{payload_b64}.{_sign(payload_b64)}"


def _read_answer_token(user_id: str, token: str) -> dict[str, Any]:
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError as exc:
        raise ValueError("잘못된 퀴즈 토큰입니다.") from exc

    if not hmac.compare_digest(_sign(payload_b64), signature):
        raise ValueError("퀴즈 토큰 검증에 실패했습니다.")

    payload = json.loads(_b64_decode(payload_b64).decode())
    if str(payload.get("uid")) != str(user_id):
        raise ValueError("다른 사용자의 퀴즈입니다.")
    if int(time.time()) - int(payload.get("iat", 0)) > TOKEN_MAX_AGE_SECONDS:
        raise ValueError("퀴즈가 만료되었습니다. 다시 생성해주세요.")
    return payload


def _word_payload(words: list[dict[str, Any]], candidate_limit: int = MAX_CANDIDATES) -> list[dict[str, Any]]:
    def compact(value: Any, limit: int = WORD_PAYLOAD_TEXT_LIMIT) -> str:
        text = " ".join(str(value or "").split())
        if len(text) <= limit:
            return text
        return f"{text[:limit].rstrip()}..."

    return [
        {
            "id": int(w["id"]),
            "word": compact(w.get("word"), 80),
            "korean": compact(w.get("korean"), 120),
            "english_def": compact(w.get("english_def"), 220),
            "example": compact(w.get("example"), 220),
            "tag": w.get("tag") or "미지정",
        }
        for w in words[: max(1, min(candidate_limit, MAX_CANDIDATES))]
    ]


def _goal_payload(goal: QuizGenerateIn) -> dict[str, Any]:
    type_counts = {}
    remaining = MAX_QUESTION_COUNT
    for key in QUESTION_TYPES:
        value = max(0, int((goal.question_type_counts or {}).get(key) or 0))
        if value <= 0 or remaining <= 0:
            continue
        type_counts[key] = min(value, remaining)
        remaining -= type_counts[key]
    return {
        "mode": goal.mode or "random",
        "tag": goal.tag or "",
        "saved_from": goal.saved_from or "",
        "saved_to": goal.saved_to or "",
        "instruction": goal.instruction or "",
        "question_count": _requested_question_count(goal),
        "question_type_counts": type_counts,
    }


def _choice_text(choice: dict[str, str]) -> str:
    return (choice.get("text") or "").strip()


def _normalize_question_type(qtype: str | None) -> str:
    raw = (qtype or "").strip()
    if raw in SAVED_GRAMMAR_BLANK_CHOICE_ALIASES:
        return "context_choice"
    if raw == "grammar_blank_choice":
        return "context_choice"
    if raw in {"collocation_blank_choice", "phrase_choice"}:
        return "collocation_choice"
    if raw in {"usage_judgement", "usage_judgment", "usage_sentence_choice"}:
        return "usage_choice"
    if raw in QUESTION_TYPES:
        return raw
    return "meaning_choice"


def _default_choice_explanations(
    choices: list[dict[str, str]],
    correct_choice_id: str,
    target: str,
) -> dict[str, str]:
    explanations = {}
    for choice in choices:
        choice_id = choice["id"]
        text = choice["text"]
        if choice_id == correct_choice_id:
            explanations[choice_id] = f"{text}는 문맥과 의미에 맞는 정답입니다."
        else:
            explanations[choice_id] = f"{text}는 형태나 의미가 비슷할 수 있지만 이 문맥의 핵심 답인 {target}와는 맞지 않습니다."
    return explanations


def _objective_explanations(question: dict[str, Any]) -> tuple[str, dict[str, str], str]:
    choices = question.get("choices", [])
    correct_choice_id = question.get("correct_choice_id") or ""
    target = question.get("target_word") or question.get("source_word") or ""
    correct_text = next(
        (
            _choice_text(choice)
            for choice in choices
            if choice.get("id") == correct_choice_id
        ),
        target,
    )
    answer_explanation = (
        question.get("answer_explanation")
        or question.get("explanation")
        or f"{correct_text}가 문항의 의미와 문맥에 가장 잘 맞습니다."
    )
    existing = question.get("choice_explanations") or {}
    choice_explanations = _default_choice_explanations(choices, correct_choice_id, target)
    for choice_id, text in existing.items():
        normalized_id = (choice_id or "").strip().upper()
        if normalized_id in CHOICE_IDS and text:
            choice_explanations[normalized_id] = str(text).strip()
    study_note = (
        question.get("study_note")
        or f"{target}: 뜻, 품사, 문장 안 역할을 함께 확인하면 비슷한 선택지를 더 잘 구분할 수 있습니다."
    )
    return answer_explanation, choice_explanations, study_note


def _is_low_quality_objective_prompt(qtype: str, prompt: str, passage: str, target: str) -> bool:
    prompt_text = " ".join((prompt or "").split())
    passage_text = " ".join((passage or "").split())
    prompt_lower = prompt_text.lower()
    passage_lower = passage_text.lower()
    target_lower = (target or "").strip().lower()
    direct_patterns = (
        "뜻으로 가장 알맞",
        "뜻으로 알맞",
        "의 뜻은",
        "의 의미는",
        "meaning of",
        "the word means",
    )
    if any(pattern in prompt_lower or pattern in passage_lower for pattern in direct_patterns):
        return True
    if passage_lower.startswith("the word means") or passage_lower.startswith("the word is"):
        return True
    if qtype == "meaning_choice":
        if len(passage_text) < 25:
            return True
        if _contains_hangul(passage_text):
            return True
        if "___" in prompt_text or "____" in prompt_text or "___" in passage_text or "____" in passage_text:
            return True
        if not _choice_text_appears_in_text(target, passage_text):
            return True
        if target_lower and target_lower in prompt_lower and ("뜻" in prompt_text or "의미" in prompt_text):
            return True
    if qtype in {"context_choice", "collocation_choice"}:
        if len(passage_text) < 35:
            return True
        if "____" not in passage_text and "___" not in passage_text and "blank" not in prompt_lower:
            return True
        if _contains_hangul(passage_text):
            return True
    if qtype == "usage_choice":
        if len(prompt_text) < 15:
            return True
        if passage_text:
            return True
    return False


def _contains_hangul(value: Any) -> bool:
    return bool(re.search(r"[가-힣]", str(value or "")))


def _is_low_quality_text_prompt(qtype: str, prompt: str, passage: str, target: str) -> bool:
    prompt_text = " ".join((prompt or "").split())
    passage_text = " ".join((passage or "").split())
    prompt_lower = prompt_text.lower()
    target_key = _choice_word_key(target)
    if qtype == "sentence_answer":
        if not target_key:
            return True
        return target_key not in _choice_word_key(prompt_text)
    if qtype == "short_answer":
        bad_patterns = (
            "에 해당하는 영어 단어",
            "에 해당하는 영어 표현",
            "한국어 '",
            "한국어 ‘",
            "한국어 \"",
        )
        if any(pattern in prompt_text for pattern in bad_patterns):
            return True
        if _contains_hangul(passage_text):
            return True
        has_english_clue = len(re.findall(r"[A-Za-z]{3,}", prompt_text + " " + passage_text)) >= 3
        has_blank = "___" in prompt_text or "____" in prompt_text or "___" in passage_text or "____" in passage_text
        if has_blank and _contains_hangul(prompt_text) and not has_english_clue:
            return True
        return not (has_english_clue or has_blank or "definition" in prompt_lower)
    return False


def _choice_word_key(value: Any) -> str:
    text = " ".join(str(value or "").lower().split())
    return re.sub(r"^[^\w]+|[^\w]+$", "", text)


def _word_tokens(value: Any) -> list[str]:
    return re.findall(r"[a-z0-9]+", str(value or "").lower())


def _choice_text_appears_in_text(choice: Any, text: Any) -> bool:
    choice_tokens = _word_tokens(choice)
    text_tokens = _word_tokens(text)
    if not choice_tokens or not text_tokens:
        return False
    if len(choice_tokens) == 1:
        return choice_tokens[0] in text_tokens
    return " ".join(choice_tokens) in " ".join(text_tokens)


def _is_bad_objective_choices(
    qtype: str,
    choices: list[dict[str, str]],
    correct_choice_id: str,
    prompt: str,
    passage: str,
    target: str,
    source_word: str,
) -> bool:
    correct_text = next(
        (choice.get("text") or "" for choice in choices if choice.get("id") == correct_choice_id),
        "",
    )
    target_key = _choice_word_key(target)
    source_key = _choice_word_key(source_word)
    if qtype == "meaning_choice":
        if any(not _contains_hangul(choice.get("text")) for choice in choices):
            return True
        return any(
            _choice_word_key(choice.get("text")) in {target_key, source_key}
            or _choice_text_appears_in_text(target, choice.get("text"))
            or _choice_text_appears_in_text(source_word, choice.get("text"))
            for choice in choices
        )
    if qtype in {"context_choice", "collocation_choice"}:
        return _choice_text_appears_in_text(correct_text, prompt) or _choice_text_appears_in_text(correct_text, passage)
    if qtype == "usage_choice":
        if any(_contains_hangul(choice.get("text")) for choice in choices):
            return True
        return any(not _choice_text_appears_in_text(target, choice.get("text")) for choice in choices)
    return False


def _wordbook_distractor_count(
    choices: list[dict[str, str]],
    correct_choice_id: str,
    word_map: dict[int, dict[str, Any]],
    target: str,
) -> int:
    wordbook_words = {
        _choice_word_key(word.get("word"))
        for word in word_map.values()
        if _choice_word_key(word.get("word"))
    }
    target_key = _choice_word_key(target)
    count = 0
    for choice in choices:
        if choice.get("id") == correct_choice_id:
            continue
        choice_key = _choice_word_key(choice.get("text"))
        if choice_key and choice_key != target_key and choice_key in wordbook_words:
            count += 1
    return count


def _normalize_generated(generated: _GeneratedQuiz, words: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    word_map = {int(w["id"]): w for w in words}
    normalized: list[dict[str, Any]] = []

    for item in generated.questions:
        source_word_id = int(item.source_word_id or item.word_id)
        word_id = int(item.word_id or source_word_id)
        if source_word_id not in word_map:
            continue
        source = word_map[source_word_id]
        qtype = _normalize_question_type(item.question_type)

        choices = []
        correct_choice_id = ""
        if qtype in CHOICE_QUESTION_TYPES:
            raw_choices = [
                {"id": CHOICE_IDS[i], "text": choice.text.strip()}
                for i, choice in enumerate(item.choices[:4])
                if choice.text and choice.text.strip()
            ]
            if len(raw_choices) != 4:
                continue
            choice_keys = [choice["text"].lower() for choice in raw_choices]
            if len(set(choice_keys)) != 4:
                continue
            original_correct = (item.correct_choice_id or "").strip().upper()
            if original_correct not in CHOICE_IDS[: len(item.choices)]:
                continue
            choices = raw_choices
            correct_choice_id = CHOICE_IDS[CHOICE_IDS.index(original_correct)]

        acceptable = [a.strip() for a in item.acceptable_answers if a and a.strip()]
        target = item.target_word.strip() or source.get("word") or ""
        if not acceptable:
            acceptable = [target]
        if not target or not item.prompt.strip():
            continue
        if qtype in CHOICE_QUESTION_TYPES and _is_low_quality_objective_prompt(
            qtype,
            item.prompt,
            item.passage,
            target,
        ):
            continue
        if qtype in CHOICE_QUESTION_TYPES and _is_bad_objective_choices(
            qtype,
            choices,
            correct_choice_id,
            item.prompt,
            item.passage,
            target,
            source.get("word") or "",
        ):
            continue
        if qtype not in CHOICE_QUESTION_TYPES and _is_low_quality_text_prompt(
            qtype,
            item.prompt,
            item.passage,
            target,
        ):
            continue
        if (
            qtype in CHOICE_QUESTION_TYPES
            and _wordbook_distractor_count(choices, correct_choice_id, word_map, target) >= 2
        ):
            continue

        is_derived = bool(item.is_derived)
        relation_type = item.relation_type.strip()
        source_word_text = (source.get("word") or "").strip().lower()
        target_text = target.strip().lower()
        target_differs_from_source = bool(
            source_word_text and target_text and target_text != source_word_text
        )
        if (
            target_differs_from_source
            and qtype not in CHOICE_QUESTION_TYPES
            and not is_derived
            and not bool(item.is_related)
            and relation_type not in {"derived", "synonym", "antonym", "collocation", "word_family", "contextual"}
        ):
            continue
        is_related = bool(item.is_related) or bool(relation_type) or (
            qtype in CHOICE_QUESTION_TYPES and target_differs_from_source
        )
        suggested_korean = item.suggested_korean.strip()
        suggested_english_def = item.suggested_english_def.strip()
        suggested_example = item.suggested_example.strip()
        suggested_tag = item.suggested_tag.strip()
        if not target_differs_from_source:
            suggested_korean = suggested_korean or source.get("korean") or ""
            suggested_english_def = suggested_english_def or source.get("english_def") or ""
            suggested_example = suggested_example or source.get("example") or ""
            suggested_tag = suggested_tag or source.get("tag") or "미지정"
        normalized.append(
            {
                "id": f"q{len(normalized) + 1}",
                "word_id": word_id,
                "source_word_id": source_word_id,
                "source_word": item.source_word.strip() or source.get("word") or "",
                "target_word": target,
                "question_type": qtype,
                "difficulty": item.difficulty.strip() or "medium",
                "prompt": item.prompt.strip(),
                "passage": item.passage.strip(),
                "choices": choices,
                "correct_choice_id": correct_choice_id,
                "acceptable_answers": acceptable,
                "explanation": item.explanation.strip(),
                "answer_explanation": item.answer_explanation.strip(),
                "choice_explanations": {
                    key.upper(): value.strip()
                    for key, value in item.choice_explanations.items()
                    if key.upper() in CHOICE_IDS and value and value.strip()
                },
                "study_note": item.study_note.strip(),
                "is_derived": is_derived,
                "is_related": is_related,
                "relation_type": relation_type,
                "derived_from_word_id": int(item.derived_from_word_id or source_word_id) if is_derived else None,
                "suggested_korean": suggested_korean,
                "suggested_english_def": suggested_english_def,
                "suggested_example": suggested_example,
                "suggested_tag": suggested_tag or "미지정",
            }
        )
        if len(normalized) >= count:
            break

    return normalized


def _question_signature(question: dict[str, Any]) -> tuple[Any, ...]:
    return (
        question.get("source_word_id") or question.get("word_id"),
        question.get("target_word", "").strip().lower(),
        question.get("question_type", ""),
        question.get("prompt", "").strip().lower(),
        question.get("passage", "").strip().lower(),
    )


def _question_type_totals(questions: list[dict[str, Any]]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for question in questions:
        qtype = _normalize_question_type(question.get("question_type"))
        totals[qtype] = totals.get(qtype, 0) + 1
    return totals


def _generation_batch_sizes(count: int) -> list[int]:
    if count <= GENERATION_SPLIT_THRESHOLD:
        return [count]
    sizes = []
    remaining = count
    while remaining > 0:
        batch_size = min(GENERATION_BATCH_SIZE, remaining)
        sizes.append(batch_size)
        remaining -= batch_size
    return sizes


def _batch_type_counts(
    requested_type_counts: dict[str, int],
    produced_counts: dict[str, int],
    batch_size: int,
) -> dict[str, int]:
    if not requested_type_counts:
        return {}

    allocated: dict[str, int] = {}
    remaining_slots = batch_size
    for qtype in QUESTION_TYPES:
        remaining_for_type = max(
            0,
            int(requested_type_counts.get(qtype, 0) or 0) - produced_counts.get(qtype, 0),
        )
        if remaining_for_type <= 0:
            continue
        count = min(remaining_for_type, remaining_slots)
        if count:
            allocated[qtype] = count
            remaining_slots -= count
        if remaining_slots <= 0:
            break
    return allocated


def _batch_candidate_words(
    quiz_words: list[dict[str, Any]],
    batch_index: int,
    batch_size: int,
) -> list[dict[str, Any]]:
    if not quiz_words:
        return []

    window_size = min(
        len(quiz_words),
        max(batch_size, batch_size * WORD_CANDIDATES_PER_QUESTION),
    )
    start = (batch_index * window_size) % len(quiz_words)
    return [quiz_words[(start + offset) % len(quiz_words)] for offset in range(window_size)]


def _reindex_questions(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for idx, question in enumerate(questions, start=1):
        question["id"] = f"q{idx}"
    return questions


def _is_connection_refused(exc: Exception) -> bool:
    return (
        isinstance(exc, OSError)
        and exc.errno == errno.ECONNREFUSED
    ) or "[Errno 111]" in str(exc)


def _quiz_feature_for_operation(operation: str) -> str:
    return "quiz_grade" if operation == "grade_subjective" else "quiz_generate"


def _active_model_name(operation: str = "generate_quiz") -> str:
    get_active_model_name = getattr(llm_module, "get_active_model_name", None)
    if get_active_model_name:
        return get_active_model_name(_quiz_feature_for_operation(operation))
    return getattr(llm_module, "ACTIVE_MODEL", "unknown")


def _quiz_llm(operation: str):
    get_llm = getattr(llm_module, "get_llm", None)
    return get_llm(_quiz_feature_for_operation(operation)) if get_llm else quiz_llm


def _invoke_quiz_llm(operation: str, prompt_value: Any) -> Any:
    started = time.perf_counter()
    model_name = _active_model_name(operation)
    try:
        response = _quiz_llm(operation).invoke(prompt_value)
    except QUIZ_LLM_ERRORS:
        track_llm_usage(
            feature="quiz",
            operation=operation,
            model_name=model_name,
            input_value=prompt_value,
            success=False,
        )
        raise
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    usage = extract_token_usage(response)
    track_llm_usage(
        feature="quiz",
        operation=operation,
        model_name=model_name,
        input_value=prompt_value,
        response=response,
    )
    logger.info(
        "llm_request_completed feature=quiz operation=%s model=%s "
        "input_tokens=%s output_tokens=%s total_tokens=%s duration_ms=%s",
        operation,
        model_name,
        usage["input_tokens"],
        usage["output_tokens"],
        usage["total_tokens"],
        elapsed_ms,
    )
    return response


def _raw_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    content = getattr(value, "content", None)
    if isinstance(content, str):
        return content
    return "" if value is None else str(value)


def _json_object_text(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        raise ValueError("LLM returned an empty response.")
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    if text.startswith("{") and text.endswith("}"):
        return text

    start = text.find("{")
    if start < 0:
        raise ValueError(f"LLM response did not contain a JSON object: {text[:300]!r}")

    depth = 0
    in_string = False
    escaped = False
    for idx in range(start, len(text)):
        char = text[idx]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:idx + 1]

    raise ValueError(f"LLM response contained an incomplete JSON object: {text[:300]!r}")


def _parse_generated_quiz(raw: Any) -> _GeneratedQuiz:
    text = _raw_text(raw)
    json_text = _json_object_text(text)
    return _quiz_parser.parse(json_text)


def _generate_llm_questions(
    quiz_words: list[dict[str, Any]],
    goal: QuizGenerateIn,
    count: int,
) -> list[dict[str, Any]]:
    generated_questions: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    goal_payload = _goal_payload(goal)
    requested_type_counts = goal_payload.get("question_type_counts") or {}
    batch_sizes = _generation_batch_sizes(count)

    for batch_index, batch_size in enumerate(batch_sizes):
        if len(generated_questions) >= count:
            break

        batch_target = min(batch_size, count - len(generated_questions))
        batch_questions: list[dict[str, Any]] = []
        batch_words = _batch_candidate_words(quiz_words, batch_index, batch_target)

        for attempt in range(GENERATION_ATTEMPTS):
            remaining = batch_target - len(batch_questions)
            if remaining <= 0:
                break

            produced = _question_type_totals(generated_questions + batch_questions)
            batch_type_counts = _batch_type_counts(requested_type_counts, produced, remaining)
            attempt_goal_payload = dict(goal_payload)
            if requested_type_counts:
                attempt_goal_payload["question_type_counts"] = batch_type_counts
                attempt_goal_payload["question_count"] = sum(batch_type_counts.values()) or remaining
            else:
                attempt_goal_payload["question_count"] = remaining
            generation_note = (
                f"Batch {batch_index + 1} of {len(batch_sizes)}. "
                "Create original questions and sentences with the LLM."
                if attempt == 0
                else (
                    f"Retry batch {batch_index + 1}. This batch produced only "
                    f"{len(batch_questions)} valid distinct questions. Generate {remaining} "
                    "additional valid questions. Do not repeat any prior prompt, passage, "
                    "choice set, or target/question_type combination."
                )
            )

            raw_generated = ""
            try:
                prompt_value = build_quiz_generation_prompt(
                    question_count=remaining,
                    goal_json=json.dumps(attempt_goal_payload, ensure_ascii=False),
                    wordbook_json=json.dumps(batch_words, ensure_ascii=False),
                    generation_note=generation_note,
                    format_instructions=_quiz_parser.get_format_instructions(),
                )
                raw_generated = _invoke_quiz_llm("generate_quiz", prompt_value)
                generated = _parse_generated_quiz(raw_generated)
            except QUIZ_LLM_ERRORS as exc:
                raw_preview = _raw_text(raw_generated).strip()[:500]
                logger.warning(
                    "LLM quiz generation batch %s/%s attempt %s failed on model %s: %s; raw_preview=%r",
                    batch_index + 1,
                    len(batch_sizes),
                    attempt + 1,
                    _active_model_name("generate_quiz"),
                    exc,
                    raw_preview,
                )
                if _is_connection_refused(exc):
                    break
                continue

            normalized = _normalize_generated(generated, batch_words, remaining)
            produced = _question_type_totals(generated_questions + batch_questions)
            for question in normalized:
                qtype = _normalize_question_type(question.get("question_type"))
                if requested_type_counts:
                    target_type_count = int(requested_type_counts.get(qtype, 0) or 0)
                    if target_type_count <= 0 or produced.get(qtype, 0) >= target_type_count:
                        continue
                signature = _question_signature(question)
                if signature in seen:
                    continue
                seen.add(signature)
                batch_questions.append(question)
                produced[qtype] = produced.get(qtype, 0) + 1
                if len(batch_questions) >= batch_target:
                    break

        generated_questions.extend(batch_questions)

    return _reindex_questions(generated_questions[:count])


def _public_question(question: dict[str, Any]) -> QuizQuestion:
    qtype = _normalize_question_type(question.get("question_type"))
    return QuizQuestion(
        id=question["id"],
        word_id=question["word_id"],
        word=question.get("source_word") or question.get("target_word") or "",
        source_word_id=question.get("source_word_id"),
        source_word=question.get("source_word") or "",
        target_word=question.get("target_word") or "",
        question_type=qtype,
        difficulty=question.get("difficulty") or "easy",
        prompt=question["prompt"],
        passage=question.get("passage") or "",
        choices=[QuizChoice(**choice) for choice in question.get("choices", [])],
        answer_format="text" if qtype in {"short_answer", "sentence_answer"} else "choice",
        is_derived=bool(question.get("is_derived")),
        is_related=bool(question.get("is_related")),
        relation_type=question.get("relation_type") or "",
        derived_from_word_id=question.get("derived_from_word_id"),
    )


async def generate_assignment(
    session: AsyncSession,
    user_id: str,
    words: list[dict[str, Any]],
    goal: QuizGenerateIn,
) -> QuizGenerateResponse:
    count = _requested_question_count(goal)
    candidate_limit = min(MAX_CANDIDATES, max(count + 4, count * 2, 12))
    quiz_words = _word_payload(words, candidate_limit=candidate_limit)
    if not quiz_words:
        return QuizGenerateResponse(
            ok=False,
            message="퀴즈를 만들 단어가 없습니다. 단어장이나 목표 조건을 확인해주세요.",
        )

    target_count = min(count, len(quiz_words))
    logger.info(
        "quiz_generation_payload requested_count=%s target_count=%s candidate_count=%s",
        count,
        target_count,
        len(quiz_words),
    )
    generated_questions = _generate_llm_questions(quiz_words, goal, target_count)
    if not generated_questions:
        return QuizGenerateResponse(
            ok=False,
            message=(
                "AI 응답이 불안정해 퀴즈를 만들지 못했습니다. "
                "잠시 후 다시 시도해주세요."
            ),
        )

    message = f"{len(generated_questions)}문제를 생성했습니다."
    if len(generated_questions) < target_count:
        message = (
            f"요청한 {target_count}문항 중 {len(generated_questions)}문항을 생성했습니다. "
            "단어 수나 출제 조건을 넓히면 더 많이 만들 수 있습니다."
        )

    session_id = await create_quiz_session(
        session,
        user_id,
        _goal_payload(goal),
        count,
        generated_questions,
    )
    return QuizGenerateResponse(
        ok=True,
        message=message,
        session_id=session_id,
        questions=[_public_question(q) for q in generated_questions],
        answer_token=_make_answer_token(user_id, session_id, generated_questions),
    )


def _grade_subjective(question: dict[str, Any], user_answer: str) -> _SubjectiveGrade:
    if not user_answer.strip():
        return _SubjectiveGrade(
            status="incorrect",
            score=0,
            confidence=1,
            feedback="답변이 비어 있습니다.",
        )
    try:
        prompt_value = build_subjective_grade_prompt(
            prompt=question["prompt"],
            target_word=question.get("target_word") or question.get("source_word") or "",
            acceptable_answers=", ".join(question.get("acceptable_answers", [])),
            user_answer=user_answer,
            format_instructions=_subjective_parser.get_format_instructions(),
        )
        response = _invoke_quiz_llm("grade_subjective", prompt_value)
        return _subjective_parser.parse(_raw_text(response))
    except QUIZ_LLM_ERRORS as exc:
        logger.warning("LLM subjective grading failed; using fallback grade: %s", exc)
        expected = [a.lower() for a in question.get("acceptable_answers", [])]
        answer = user_answer.lower()
        matched = any(item and item in answer for item in expected)
        return _SubjectiveGrade(
            status="correct" if matched else "incorrect",
            score=1 if matched else 0,
            confidence=0.55,
            feedback="AI 채점에 실패해 정답 키워드 포함 여부로 임시 채점했습니다.",
        )


def _review_schedule_preview(records: list[dict[str, Any]]) -> list[QuizReviewScheduleItem]:
    buckets: dict[int, dict[str, Any]] = {}
    for record in records:
        try:
            word_id = int(record.get("source_word_id") or record.get("word_id"))
        except DATA_COERCION_ERRORS:
            continue
        bucket = buckets.setdefault(
            word_id,
            {"word_id": word_id, "word": "", "score": 0.0, "total": 0},
        )
        if not bucket["word"]:
            bucket["word"] = record.get("source_word") or record.get("target_word") or ""
        bucket["score"] += float(record.get("score") or 0)
        bucket["total"] += 1

    now = datetime.now()
    preview = []
    for bucket in buckets.values():
        average = bucket["score"] / bucket["total"] if bucket["total"] else 0
        if average >= 0.8:
            continue
        days = 1
        preview.append(
            QuizReviewScheduleItem(
                word_id=bucket["word_id"],
                word=bucket["word"],
                result="incorrect",
                proposed_next_review=(now + timedelta(days=days)).date().isoformat(),
                interval_days=days,
            )
        )
    return preview


async def grade_assignment(
    session: AsyncSession,
    user_id: str,
    answer_token: str,
    answers: list[dict[str, str]],
) -> QuizGradeResponse:
    payload = _read_answer_token(user_id, answer_token)
    session_id = int(payload.get("sid") or 0)
    selected = {
        (answer.get("question_id") or ""): {
            "choice_id": (answer.get("choice_id") or "").strip().upper(),
            "text_answer": (answer.get("text_answer") or "").strip(),
        }
        for answer in answers
    }

    results: list[QuizGradedQuestion] = []
    records: list[dict[str, Any]] = []
    score = 0.0
    type_stats: dict[str, dict[str, float]] = {}
    saved_words = await existing_words_lower(session, user_id)

    for question in payload["questions"]:
        question_id = question["id"]
        answer = selected.get(question_id, {"choice_id": "", "text_answer": ""})
        qtype = _normalize_question_type(question.get("question_type"))
        choices = {choice["id"]: _choice_text(choice) for choice in question.get("choices", [])}
        correct_choice_id = question.get("correct_choice_id") or ""
        selected_choice_id = answer["choice_id"]
        text_answer = answer["text_answer"]
        explanation = question.get("explanation") or ""
        status = "incorrect"
        confidence = 1.0
        item_score = 0.0
        selected_text = choices.get(selected_choice_id, "")
        correct_text = choices.get(correct_choice_id, "")
        answer_explanation = ""
        choice_explanations: dict[str, str] = {}
        study_note = ""

        if qtype in CHOICE_QUESTION_TYPES:
            is_correct = bool(selected_choice_id) and selected_choice_id == correct_choice_id
            status = "correct" if is_correct else "incorrect"
            item_score = 1.0 if is_correct else 0.0
            answer_explanation, choice_explanations, study_note = _objective_explanations(question)
            explanation = answer_explanation
        else:
            grade = _grade_subjective(question, text_answer)
            status = grade.status if grade.status in {"correct", "partial", "incorrect"} else "incorrect"
            item_score = max(0.0, min(float(grade.score), 1.0))
            confidence = max(0.0, min(float(grade.confidence), 1.0))
            explanation = grade.feedback

        is_correct = status == "correct"
        score += item_score
        source_word_id = int(question.get("source_word_id") or question.get("word_id"))
        target_word = (question.get("target_word") or "").strip()
        can_add_to_wordbook = (
            status != "correct"
            and bool(target_word)
            and target_word.lower() not in saved_words
        )

        type_stat = type_stats.setdefault(qtype, {"correct": 0, "total": 0, "score": 0})
        type_stat["total"] += 1
        type_stat["score"] += item_score
        if is_correct:
            type_stat["correct"] += 1

        feedback_parts = [explanation]
        if choice_explanations:
            feedback_parts.extend(
                f"{choice_id}: {text}" for choice_id, text in sorted(choice_explanations.items())
            )
        if study_note:
            feedback_parts.append(f"학습 노트: {study_note}")
        feedback = "\n".join(part for part in feedback_parts if part)

        result = QuizGradedQuestion(
            question_id=question_id,
            word_id=int(question["word_id"]),
            word=question.get("source_word") or "",
            source_word_id=source_word_id,
            source_word=question.get("source_word") or "",
            target_word=question.get("target_word") or "",
            question_type=qtype,
            difficulty=question.get("difficulty") or "",
            prompt=question["prompt"],
            selected_choice_id=selected_choice_id,
            selected_text=selected_text,
            text_answer=text_answer,
            correct_choice_id=correct_choice_id,
            correct_text=correct_text,
            acceptable_answers=question.get("acceptable_answers", []),
            status=status,
            correct=is_correct,
            score=item_score,
            confidence=confidence,
            explanation=explanation,
            answer_explanation=answer_explanation,
            choice_explanations=choice_explanations,
            study_note=study_note,
            is_derived=bool(question.get("is_derived")),
            is_related=bool(question.get("is_related")),
            relation_type=question.get("relation_type") or "",
            derived_from_word_id=question.get("derived_from_word_id"),
            suggested_word=target_word if can_add_to_wordbook else "",
            suggested_korean=question.get("suggested_korean") or "",
            suggested_english_def=question.get("suggested_english_def") or "",
            suggested_example=question.get("suggested_example") or "",
            suggested_tag=question.get("suggested_tag") or "미지정",
            can_add_to_wordbook=can_add_to_wordbook,
        )
        results.append(result)
        records.append(
            {
                "question_id": result.question_id,
                "word_id": result.word_id,
                "source_word_id": result.source_word_id,
                "source_word": result.source_word,
                "target_word": result.target_word,
                "question_type": result.question_type,
                "difficulty": result.difficulty,
                "prompt": result.prompt,
                "user_answer": result.text_answer or result.selected_text,
                "correct_answer": result.correct_text or ", ".join(result.acceptable_answers),
                "selected_choice_id": result.selected_choice_id,
                "correct_choice_id": result.correct_choice_id,
                "status": result.status,
                "correct": result.correct,
                "score": result.score,
                "confidence": result.confidence,
                "feedback": feedback,
                "is_derived": result.is_derived,
                "is_related": result.is_related,
                "relation_type": result.relation_type,
                "derived_from_word_id": result.derived_from_word_id,
                "suggested_word": result.suggested_word,
                "suggested_korean": result.suggested_korean,
                "suggested_english_def": result.suggested_english_def,
                "suggested_example": result.suggested_example,
                "suggested_tag": result.suggested_tag,
            }
        )

    total = len(results)
    await save_results_and_complete_session(
        session,
        user_id,
        session_id,
        records,
        score,
        total,
    )
    review_schedule_preview = _review_schedule_preview(records)

    normalized_stats = {
        key: {
            "correct": value["correct"],
            "total": value["total"],
            "accuracy": round(value["score"] / value["total"], 3) if value["total"] else 0,
        }
        for key, value in type_stats.items()
    }
    feedback = (
        f"{total}문제 중 {score:.1f}점을 획득했습니다. "
    )
    return QuizGradeResponse(
        ok=True,
        session_id=session_id,
        score=score,
        total=total,
        feedback=feedback,
        type_stats=normalized_stats,
        review_schedule_preview=review_schedule_preview,
        review_schedule_applied=False,
        results=results,
    )


async def apply_review_schedule(
    session: AsyncSession,
    user_id: str,
    session_id: int,
    incorrect_interval: str = "1d",
) -> QuizReviewScheduleApplyResponse:
    return QuizReviewScheduleApplyResponse(
        **await apply_quiz_review_schedule(session, user_id, session_id, incorrect_interval)
    )
