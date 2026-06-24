"""React 프론트엔드가 사용하는 REST API.

기존 Gradio(app.py)가 이벤트 핸들러로 인라인 처리하던 기능
(검색 / 단어장 / 퀴즈 / 롤플레잉 / 슬랭 / TTS)을 HTTP 엔드포인트로 노출한다.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from backend.auth.users import get_current_user_from_cookie
from backend.database import (
    get_all_words,
    get_words_to_review,
    is_word_saved,
    save_word,
)
from backend.llm import (
    continue_roleplay,
    explain_slang,
    generate_quiz,
    grade_quiz,
    start_roleplay,
)
from backend.services import (
    search_from_english,
    search_from_korean,
    synthesize_tts,
)

router = APIRouter(prefix="/api", tags=["api"])


# ── 스키마 ─────────────────────────────────────────────────
class SaveWordIn(BaseModel):
    word: str
    korean: str = ""
    english_def: str = ""
    example: str = ""
    context: str = ""
    slang_def: str = ""


class QuizGradeIn(BaseModel):
    words: list
    quiz_text: str
    user_answer: str


class RoleplayContinueIn(BaseModel):
    history: list  # [[user, bot], ...]
    message: str


class SlangIn(BaseModel):
    word: str
    korean: str = ""


# ── 현재 사용자 ─────────────────────────────────────────────
@router.get("/me")
async def me(request: Request):
    user = await get_current_user_from_cookie(request)
    return {"user": user}


# ── 검색 ───────────────────────────────────────────────────
@router.get("/search/english")
def search_english(word: str = ""):
    result = search_from_english(word)
    result["saved"] = is_word_saved(result["english_word"]) if result["english_word"] else False
    return result


@router.get("/search/korean")
def search_korean(word: str = ""):
    result = search_from_korean(word)
    result["saved"] = is_word_saved(result["english_word"]) if result["english_word"] else False
    return result


# ── TTS ────────────────────────────────────────────────────
@router.get("/tts")
def tts(word: str = "", lang: str = "en"):
    audio_b64 = synthesize_tts(word, lang)
    return {"audio": audio_b64}  # base64 mp3 또는 null


# ── 단어장 ─────────────────────────────────────────────────
@router.get("/words")
def list_words():
    return {"words": get_all_words()}


@router.get("/words/saved")
def word_saved(word: str = ""):
    return {"saved": is_word_saved(word)}


@router.post("/words")
def create_word(payload: SaveWordIn):
    word = payload.word.strip()
    if not word:
        return {"ok": False, "message": "단어가 비어 있습니다."}
    final_def = payload.slang_def.strip() or payload.english_def
    message = save_word(
        word.lower(), payload.korean, final_def, payload.example, "", payload.context
    )
    return {"ok": True, "message": message, "saved": True}


# ── 슬랭 / 구어체 설명 ─────────────────────────────────────
@router.post("/slang")
def slang(payload: SlangIn):
    word = payload.word.strip()
    if not word:
        return {"explanation": "단어를 먼저 검색해주세요."}
    return {"explanation": explain_slang(word, payload.korean.strip())}


# ── 퀴즈 ───────────────────────────────────────────────────
@router.post("/quiz/generate")
def quiz_generate():
    words = get_words_to_review()
    quiz_text = generate_quiz(words)
    return {"words": words, "quiz_text": quiz_text}


@router.post("/quiz/grade")
def quiz_grade(payload: QuizGradeIn):
    feedback = grade_quiz(payload.words, payload.quiz_text, payload.user_answer)
    return {"feedback": feedback}


# ── 롤플레잉 ───────────────────────────────────────────────
@router.post("/roleplay/start")
def roleplay_start():
    words = get_words_to_review()
    history = start_roleplay(words)  # [("", response)]
    return {"history": [list(pair) for pair in history]}


@router.post("/roleplay/continue")
def roleplay_continue(payload: RoleplayContinueIn):
    history = [list(pair) for pair in payload.history]
    new_history = continue_roleplay(history, payload.message)
    return {"history": [list(pair) for pair in new_history]}
