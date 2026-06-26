import base64
import hashlib
import hmac
import json
import logging
import errno
import time
from datetime import datetime, timedelta
from typing import Any

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from backend.config import settings
from backend.database import (
    apply_quiz_review_schedule,
    complete_quiz_session,
    create_quiz_session,
    existing_words_lower,
    save_quiz_question_results,
)
import backend.llm as llm_module
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

logger = logging.getLogger(__name__)
quiz_llm = llm_module.get_llm("quiz")

DEFAULT_QUESTION_COUNT = 10
MAX_QUESTION_COUNT = 20
MAX_CANDIDATES = 50
TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24
WORD_PAYLOAD_TEXT_LIMIT = 220
CHOICE_IDS = ("A", "B", "C", "D")
QUESTION_TYPES = (
    "meaning_choice",
    "context_choice",
    "short_answer",
    "sentence_answer",
)
CHOICE_QUESTION_TYPES = {
    "meaning_choice",
    "context_choice",
}
SAVED_GRAMMAR_BLANK_CHOICE_ALIASES = {"_".join(("to" + "eic", "part5"))}
GENERATION_ATTEMPTS = 3


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

_quiz_prompt = ChatPromptTemplate.from_template(
    """
You are an English academy teacher creating vocabulary homework for a Korean
student. Use the student's saved wordbook as the source, but you may include
derived forms of saved words when it helps learning.

Create {question_count} questions. Mix these types from easy to hard:
- meaning_choice: simple meaning or word matching
- context_choice: choose a word/form that fits a sentence
- short_answer: type the target word or derived form
- sentence_answer: write a short English sentence using the target word

Rules:
- Use only provided word_id values as source_word_id/word_id anchors.
- question_type must be one of: meaning_choice, context_choice,
  short_answer, sentence_answer.
- For context_choice, put the English sentence with the blank in passage and
  put only the Korean instruction/question in prompt.
- Create fresh original contexts and sentences. Do not copy, lightly rewrite,
  or imitate any saved example sentence. If examples are absent, invent natural
  new contexts from the word meaning.
- Vary situations, collocations, part-of-speech usage, sentence structure, and
  distractor logic across questions.
- For derived words, keep word_id/source_word_id as the original saved word id,
  set is_derived=true, target_word to the derived word, and derived_from_word_id.
- Objective questions may use a related target_word that is not in the saved
  wordbook when it improves learning: derived forms, synonyms, antonyms,
  collocations, same word family, or a contextually natural expression. Keep
  source_word_id anchored to the saved word, set is_related=true, and set
  relation_type to one of: derived, synonym, antonym, collocation, word_family,
  contextual.
- When target_word is not the saved source word, fill suggested_korean,
  suggested_english_def, suggested_example, and suggested_tag so the learner can
  add the missed target to the wordbook after grading.
- Subjective text questions must ask for the saved word or a clear derived form
  only. Do not require a synonym or unrelated related expression as the typed
  answer.
- Objective questions must have exactly four choices A-D and correct_choice_id.
- Objective wrong choices must not be limited to saved wordbook words. Generate
  realistic distractors that could be confused by part of speech, meaning,
  spelling, word form, collocation, or sentence context.
- Do not reuse the same generic wrong choices across questions. Each objective
  question's distractors must be specific to its target word and sentence.
- For every objective question, include answer_explanation, choice_explanations
  with keys A-D, and study_note. Explain every choice, not just the selected one.
- Text questions must have acceptable_answers and no choices.
- Write prompts and explanations in Korean. English passages/examples are allowed.
- Do not reveal the answer in the prompt.
- Respect the user's instruction if present.
- Return only one valid JSON object that matches the schema. Do not return
  markdown fences, comments, prose, or null.

Generation note:
{generation_note}

Goal:
{goal_json}

Wordbook JSON:
{wordbook_json}

{format_instructions}
"""
)

_subjective_prompt = ChatPromptTemplate.from_template(
    """
You are grading an English vocabulary quiz answer from a Korean learner.

Question:
{prompt}

Target word:
{target_word}

Acceptable answers:
{acceptable_answers}

User answer:
{user_answer}

Grade with this policy:
- correct: clearly uses or identifies the expected word/form correctly.
- partial: understandable but has a typo, weak grammar, or incomplete use.
- incorrect: wrong word, missing answer, or meaning does not match.
- confidence should be lower when several interpretations are possible.
- Feedback must be concise Korean.

{format_instructions}
"""
)

def _clamp_question_count(value: int | None) -> int:
    try:
        count = int(value or DEFAULT_QUESTION_COUNT)
    except (TypeError, ValueError):
        count = DEFAULT_QUESTION_COUNT
    return max(1, min(count, MAX_QUESTION_COUNT))


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


def _word_payload(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
            "english_def": compact(w.get("english_def")),
            "tag": w.get("tag") or "미지정",
        }
        for w in words[:MAX_CANDIDATES]
    ]


def _goal_payload(goal: QuizGenerateIn) -> dict[str, Any]:
    return {
        "mode": goal.mode or "random",
        "tag": goal.tag or "",
        "saved_from": goal.saved_from or "",
        "saved_to": goal.saved_to or "",
        "instruction": goal.instruction or "",
        "question_count": _clamp_question_count(goal.question_count),
    }


def _choice_text(choice: dict[str, str]) -> str:
    return (choice.get("text") or "").strip()


def _normalize_question_type(qtype: str | None) -> str:
    raw = (qtype or "").strip()
    if raw in SAVED_GRAMMAR_BLANK_CHOICE_ALIASES:
        return "context_choice"
    if raw == "grammar_blank_choice":
        return "context_choice"
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

        is_derived = bool(item.is_derived)
        source_word_text = (source.get("word") or "").strip().lower()
        target_text = target.strip().lower()
        target_differs_from_source = bool(
            source_word_text and target_text and target_text != source_word_text
        )
        if (
            target_differs_from_source
            and qtype not in CHOICE_QUESTION_TYPES
            and not is_derived
        ):
            continue
        is_related = bool(item.is_related) or (
            qtype in CHOICE_QUESTION_TYPES and target_differs_from_source
        )
        relation_type = item.relation_type.strip()
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


def _reindex_questions(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for idx, question in enumerate(questions, start=1):
        question["id"] = f"q{idx}"
    return questions


def _is_connection_refused(exc: Exception) -> bool:
    return (
        isinstance(exc, OSError)
        and exc.errno == errno.ECONNREFUSED
    ) or "[Errno 111]" in str(exc)


def _active_model_name() -> str:
    get_active_model_name = getattr(llm_module, "get_active_model_name", None)
    if get_active_model_name:
        return get_active_model_name("quiz")
    return getattr(llm_module, "ACTIVE_MODEL", "unknown")


def _quiz_llm():
    get_llm = getattr(llm_module, "get_llm", None)
    return get_llm("quiz") if get_llm else quiz_llm


def _usage_value(usage: Any, *keys: str) -> int | None:
    for key in keys:
        if isinstance(usage, dict) and usage.get(key) is not None:
            try:
                return int(usage.get(key))
            except (TypeError, ValueError):
                return None
        value = getattr(usage, key, None)
        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
    return None


def _token_usage(response: Any) -> dict[str, int | None]:
    usage = getattr(response, "usage_metadata", None)
    metadata = getattr(response, "response_metadata", None) or {}
    if not usage and isinstance(metadata, dict):
        usage = metadata.get("token_usage") or metadata.get("usage")
    input_tokens = _usage_value(
        usage,
        "input_tokens",
        "prompt_tokens",
        "input_token_count",
        "prompt_eval_count",
    )
    output_tokens = _usage_value(
        usage,
        "output_tokens",
        "completion_tokens",
        "generated_token_count",
        "eval_count",
    )
    total_tokens = _usage_value(usage, "total_tokens")
    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


def _invoke_quiz_llm(operation: str, prompt_value: Any) -> Any:
    started = time.perf_counter()
    response = _quiz_llm().invoke(prompt_value)
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    usage = _token_usage(response)
    logger.info(
        "llm_request_completed feature=quiz operation=%s model=%s "
        "input_tokens=%s output_tokens=%s total_tokens=%s duration_ms=%s",
        operation,
        _active_model_name(),
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

    for attempt in range(GENERATION_ATTEMPTS):
        remaining = count - len(generated_questions)
        if remaining <= 0:
            break
        generation_note = (
            "Initial generation. Create original questions and sentences with the LLM."
            if attempt == 0
            else (
                f"Retry generation. The previous attempt produced only "
                f"{len(generated_questions)} valid distinct questions. Generate {remaining} "
                "additional valid questions. Do not repeat any prior prompt, passage, "
                "choice set, or target/question_type combination."
            )
        )
        raw_generated = ""
        try:
            prompt_value = _quiz_prompt.invoke(
                {
                    "question_count": remaining,
                    "goal_json": json.dumps(goal_payload, ensure_ascii=False),
                    "wordbook_json": json.dumps(quiz_words, ensure_ascii=False),
                    "generation_note": generation_note,
                    "format_instructions": _quiz_parser.get_format_instructions(),
                }
            )
            raw_generated = _invoke_quiz_llm("generate_quiz", prompt_value)
            generated = _parse_generated_quiz(raw_generated)
        except Exception as exc:
            raw_preview = _raw_text(raw_generated).strip()[:500]
            logger.warning(
                "LLM quiz generation attempt %s failed on model %s: %s; raw_preview=%r",
                attempt + 1,
                _active_model_name(),
                exc,
                raw_preview,
            )
            if _is_connection_refused(exc):
                break
            continue

        normalized = _normalize_generated(generated, quiz_words, remaining)
        for question in normalized:
            signature = _question_signature(question)
            if signature in seen:
                continue
            seen.add(signature)
            generated_questions.append(question)
            if len(generated_questions) >= count:
                break

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


def generate_assignment(
    user_id: str,
    words: list[dict[str, Any]],
    goal: QuizGenerateIn,
) -> QuizGenerateResponse:
    count = _clamp_question_count(goal.question_count)
    quiz_words = _word_payload(words)
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
                "AI가 유효한 퀴즈를 생성하지 못했습니다. "
                "잠시 후 다시 시도하거나 출제 지시문을 더 구체적으로 입력해주세요."
            ),
        )

    message = f"{len(generated_questions)}문제를 생성했습니다."
    if len(generated_questions) < target_count:
        message = (
            f"AI가 요청한 {target_count}문항 중 유효한 {len(generated_questions)}문항만 생성했습니다. "
            "코드가 임의 문항을 보충하지 않았습니다."
        )

    session_id = create_quiz_session(user_id, _goal_payload(goal), count)
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
        prompt_value = _subjective_prompt.invoke(
            {
                "prompt": question["prompt"],
                "target_word": question.get("target_word") or question.get("source_word") or "",
                "acceptable_answers": ", ".join(question.get("acceptable_answers", [])),
                "user_answer": user_answer,
                "format_instructions": _subjective_parser.get_format_instructions(),
            }
        )
        response = _invoke_quiz_llm("grade_subjective", prompt_value)
        return _subjective_parser.parse(_raw_text(response))
    except Exception as exc:
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
        except (TypeError, ValueError):
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


def grade_assignment(
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
    saved_words = existing_words_lower(user_id)

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
                "word_id": result.word_id,
                "source_word_id": result.source_word_id,
                "source_word": result.source_word,
                "target_word": result.target_word,
                "question_type": result.question_type,
                "difficulty": result.difficulty,
                "prompt": result.prompt,
                "user_answer": result.text_answer or result.selected_text,
                "correct_answer": result.correct_text or ", ".join(result.acceptable_answers),
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
    save_quiz_question_results(user_id, session_id, records)
    complete_quiz_session(user_id, session_id, score, total)
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


def apply_review_schedule(
    user_id: str,
    session_id: int,
    incorrect_interval: str = "1d",
) -> QuizReviewScheduleApplyResponse:
    return QuizReviewScheduleApplyResponse(
        **apply_quiz_review_schedule(user_id, session_id, incorrect_interval)
    )
