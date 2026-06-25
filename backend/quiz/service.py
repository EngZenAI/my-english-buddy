import base64
import hashlib
import hmac
import json
import logging
import random
import time
from typing import Any

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from backend.config import settings
from backend.database import update_review
from backend.llm import llm
from backend.quiz.schemas import (
    QuizChoice,
    QuizGenerateResponse,
    QuizGradedQuestion,
    QuizGradeResponse,
    QuizQuestion,
)

logger = logging.getLogger(__name__)

MAX_QUESTIONS = 5
TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24
CHOICE_IDS = ("A", "B", "C", "D")
FALLBACK_DISTRACTORS = [
    "improve",
    "consider",
    "describe",
    "prefer",
    "suggest",
    "notice",
    "borrow",
    "achieve",
]


class _GeneratedChoice(BaseModel):
    id: str = Field(description="A, B, C, or D")
    text: str


class _GeneratedQuestion(BaseModel):
    word_id: int
    type: str = Field(description="meaning, context, or usage")
    prompt: str
    choices: list[_GeneratedChoice]
    correct_choice_id: str
    explanation: str = ""


class _GeneratedQuiz(BaseModel):
    questions: list[_GeneratedQuestion]


_quiz_parser = PydanticOutputParser(pydantic_object=_GeneratedQuiz)

_quiz_prompt = ChatPromptTemplate.from_template(
    """
You are an English academy teacher assigning vocabulary homework to a Korean
student. Create multiple-choice quiz questions from the student's wordbook.

Rules:
- Create up to {max_questions} questions.
- Use only the provided word_id values.
- Each question must test one target word.
- Use exactly four choices with ids A, B, C, D.
- Make the prompt useful for learning, not just a dictionary lookup.
- Write prompts and explanations in Korean. English examples are allowed.
- Do not reveal the answer in the prompt.

Wordbook JSON:
{wordbook_json}

{format_instructions}
"""
)

_quiz_chain = _quiz_prompt | llm | _quiz_parser


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


def _make_answer_token(user_id: str, questions: list[dict[str, Any]]) -> str:
    payload = {
        "uid": str(user_id),
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
    selected = words[:MAX_QUESTIONS]
    return [
        {
            "id": int(w["id"]),
            "word": w.get("word") or "",
            "korean": w.get("korean") or "",
            "korean_detail": w.get("korean_detail") or "",
            "english_def": w.get("english_def") or "",
            "example": w.get("example") or "",
            "tag": w.get("tag") or "",
        }
        for w in selected
    ]


def _choice_text(choice: dict[str, str]) -> str:
    return (choice.get("text") or "").strip()


def _fallback_questions(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source_words = [w.get("word", "") for w in words if w.get("word")]
    questions = []
    for idx, word in enumerate(words[:MAX_QUESTIONS], start=1):
        correct = word.get("word") or ""
        distractors = [
            w for w in source_words
            if w.lower() != correct.lower()
        ]
        for item in FALLBACK_DISTRACTORS:
            if item.lower() != correct.lower() and item not in distractors:
                distractors.append(item)
            if len(distractors) >= 3:
                break

        choices = [correct, *distractors[:3]]
        random.Random(int(word["id"])).shuffle(choices)
        quiz_choices = [
            {"id": choice_id, "text": text}
            for choice_id, text in zip(CHOICE_IDS, choices)
        ]
        correct_choice_id = next(c["id"] for c in quiz_choices if c["text"] == correct)
        meaning = word.get("korean") or word.get("korean_detail") or word.get("english_def") or "제시된 뜻"
        questions.append(
            {
                "id": f"q{idx}",
                "word_id": int(word["id"]),
                "word": correct,
                "type": "meaning",
                "prompt": f"다음 뜻에 가장 알맞은 영어 단어를 고르세요: {meaning}",
                "choices": quiz_choices,
                "correct_choice_id": correct_choice_id,
                "explanation": f"정답은 '{correct}'입니다.",
            }
        )
    return questions


def _normalize_generated(
    generated: _GeneratedQuiz,
    words: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    word_map = {int(w["id"]): w for w in words}
    normalized: list[dict[str, Any]] = []
    used_word_ids: set[int] = set()

    for idx, item in enumerate(generated.questions, start=1):
        word_id = int(item.word_id)
        if word_id not in word_map or word_id in used_word_ids:
            continue

        raw_choices = [
            {"id": CHOICE_IDS[i], "text": choice.text.strip()}
            for i, choice in enumerate(item.choices[:4])
            if choice.text and choice.text.strip()
        ]
        if len(raw_choices) != 4:
            continue

        original_correct = (item.correct_choice_id or "").strip().upper()
        if original_correct not in CHOICE_IDS[: len(item.choices)]:
            continue
        correct_idx = CHOICE_IDS.index(original_correct)
        correct_choice_id = raw_choices[correct_idx]["id"]

        used_word_ids.add(word_id)
        normalized.append(
            {
                "id": f"q{len(normalized) + 1}",
                "word_id": word_id,
                "word": word_map[word_id].get("word") or "",
                "type": item.type.strip() or "meaning",
                "prompt": item.prompt.strip(),
                "choices": raw_choices,
                "correct_choice_id": correct_choice_id,
                "explanation": item.explanation.strip(),
            }
        )
        if len(normalized) >= MAX_QUESTIONS:
            break

    return normalized


def _public_question(question: dict[str, Any]) -> QuizQuestion:
    return QuizQuestion(
        id=question["id"],
        word_id=question["word_id"],
        type=question["type"],
        prompt=question["prompt"],
        choices=[QuizChoice(**choice) for choice in question["choices"]],
    )


def generate_assignment(user_id: str, words: list[dict[str, Any]]) -> QuizGenerateResponse:
    quiz_words = _word_payload(words)
    if not quiz_words:
        return QuizGenerateResponse(
            ok=False,
            message="복습할 단어가 없습니다. 단어를 저장하거나 다음 복습일을 확인해주세요.",
        )

    generated_questions: list[dict[str, Any]] = []
    try:
        generated = _quiz_chain.invoke(
            {
                "max_questions": min(MAX_QUESTIONS, len(quiz_words)),
                "wordbook_json": json.dumps(quiz_words, ensure_ascii=False),
                "format_instructions": _quiz_parser.get_format_instructions(),
            }
        )
        generated_questions = _normalize_generated(generated, quiz_words)
    except Exception as exc:
        logger.warning("LLM quiz generation failed; using fallback quiz: %s", exc)

    if len(generated_questions) < min(MAX_QUESTIONS, len(quiz_words)):
        fallback = _fallback_questions(quiz_words)
        existing_ids = {q["word_id"] for q in generated_questions}
        generated_questions.extend(q for q in fallback if q["word_id"] not in existing_ids)
        generated_questions = generated_questions[: min(MAX_QUESTIONS, len(quiz_words))]

    return QuizGenerateResponse(
        ok=True,
        message=f"{len(generated_questions)}문제를 생성했습니다.",
        questions=[_public_question(q) for q in generated_questions],
        answer_token=_make_answer_token(user_id, generated_questions),
    )


def grade_assignment(
    user_id: str,
    answer_token: str,
    answers: list[dict[str, str]],
) -> QuizGradeResponse:
    payload = _read_answer_token(user_id, answer_token)
    selected = {
        (answer.get("question_id") or ""): (answer.get("choice_id") or "").strip().upper()
        for answer in answers
    }

    results: list[QuizGradedQuestion] = []
    score = 0
    for question in payload["questions"]:
        question_id = question["id"]
        selected_choice_id = selected.get(question_id, "")
        correct_choice_id = question["correct_choice_id"]
        choices = {choice["id"]: _choice_text(choice) for choice in question["choices"]}
        correct = bool(selected_choice_id) and selected_choice_id == correct_choice_id
        if correct:
            score += 1

        update_review(user_id, int(question["word_id"]), correct)

        results.append(
            QuizGradedQuestion(
                question_id=question_id,
                word_id=int(question["word_id"]),
                word=question.get("word") or "",
                prompt=question["prompt"],
                selected_choice_id=selected_choice_id,
                selected_text=choices.get(selected_choice_id, ""),
                correct_choice_id=correct_choice_id,
                correct_text=choices.get(correct_choice_id, ""),
                correct=correct,
                explanation=question.get("explanation") or "",
            )
        )

    total = len(results)
    feedback = (
        f"{total}문제 중 {score}문제를 맞혔습니다. "
        "맞힌 단어는 30일 뒤, 틀린 단어는 1일 뒤 다시 복습하도록 조정했습니다."
    )
    return QuizGradeResponse(
        ok=True,
        score=score,
        total=total,
        feedback=feedback,
        results=results,
    )
