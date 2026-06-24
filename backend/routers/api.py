"""React 프론트엔드가 사용하는 REST API.

기존 Gradio(app.py)가 이벤트 핸들러로 인라인 처리하던 기능
(검색 / 단어장 / 퀴즈 / 롤플레잉 / 슬랭 / TTS)을 HTTP 엔드포인트로 노출한다.

비회원도 가능: 단어 검색(/search), 발음(/tts), 로그인 상태 확인(/me).
회원 전용: 단어장/태그/퀴즈/롤플레잉/슬랭 (require_user 의존성으로 보호).
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.auth.users import get_current_user_from_cookie
from backend.database import (
    add_label,
    count_words_by_tag,
    delete_label,
    get_all_words,
    get_labels,
    get_words_to_review,
    is_word_saved,
    rename_label,
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


async def require_user(request: Request) -> dict:
    """로그인(쿠키) 안 돼 있으면 401. 회원 전용 엔드포인트 보호용."""
    user = await get_current_user_from_cookie(request)
    if not user:
        raise HTTPException(status_code=401, detail="회원 전용 기능입니다.")
    return user


# ── 스키마 ─────────────────────────────────────────────────
class SaveWordIn(BaseModel):
    word: str
    korean: str = ""
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""  # 선택한 태그(카테고리)
    slang_def: str = ""


class LabelIn(BaseModel):
    name: str


class RenameLabelIn(BaseModel):
    old_name: str
    new_name: str


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


# ── 검색 (비회원 허용) ──────────────────────────────────────
@router.get("/search/english")
def search_english(word: str = ""):
    return search_from_english(word)


@router.get("/search/korean")
def search_korean(word: str = ""):
    return search_from_korean(word)


# ── TTS (비회원 허용) ───────────────────────────────────────
@router.get("/tts")
def tts(word: str = "", lang: str = "en"):
    audio_b64 = synthesize_tts(word, lang)
    return {"audio": audio_b64}  # base64 mp3 또는 null


# ── 단어 저장여부 (검색 화면 배지용, 공개) ──────────────────
@router.get("/words/saved")
def word_saved(word: str = "", _user: dict = Depends(require_user)):
    return {"saved": is_word_saved(_user["id"], word)}


# ── 태그(카테고리) — 회원 전용 ─────────────────────────────
@router.get("/labels")
def list_labels(_user: dict = Depends(require_user)):
    return {"labels": get_labels(_user["id"])}


@router.post("/labels")
def create_label(payload: LabelIn, _user: dict = Depends(require_user)):
    labels, ok = add_label(_user["id"], payload.name)
    return {"labels": labels, "ok": ok, "max": 20}


@router.post("/labels/rename")
def rename_label_ep(payload: RenameLabelIn, _user: dict = Depends(require_user)):
    labels, ok, message = rename_label(_user["id"], payload.old_name, payload.new_name)
    return {"labels": labels, "ok": ok, "message": message}


@router.get("/labels/word-count")
def label_word_count(tag: str = "", _user: dict = Depends(require_user)):
    return {"count": count_words_by_tag(_user["id"], tag) if tag else 0}


@router.delete("/labels")
def delete_label_ep(name: str = "", _user: dict = Depends(require_user)):
    labels, ok, message, deleted = delete_label(_user["id"], name)
    return {"labels": labels, "ok": ok, "message": message, "deleted": deleted}


# ── 단어장 — 회원 전용 ─────────────────────────────────────
@router.get("/words")
def list_words(tag: str = "", _user: dict = Depends(require_user)):
    return {"words": get_all_words(_user["id"], tag or None)}


@router.post("/words")
def create_word(payload: SaveWordIn, _user: dict = Depends(require_user)):
    word = payload.word.strip()
    if not word:
        return {"ok": False, "message": "단어가 비어 있습니다."}
    final_def = payload.slang_def.strip() or payload.english_def
    tag = payload.tag.strip() or "미지정"  # 태그 미선택 시 기본값
    message = save_word(
        _user["id"], word.lower(), payload.korean, payload.korean_detail, final_def, payload.example, tag
    )
    return {"ok": True, "message": message, "saved": True}


# ── 슬랭 / 구어체 설명 — 회원 전용 (LLM 비용) ──────────────
@router.post("/slang")
def slang(payload: SlangIn, _user: dict = Depends(require_user)):
    word = payload.word.strip()
    if not word:
        return {"explanation": "단어를 먼저 검색해주세요."}
    return {"explanation": explain_slang(word, payload.korean.strip())}


# ── 퀴즈 — 회원 전용 ───────────────────────────────────────
@router.post("/quiz/generate")
def quiz_generate(_user: dict = Depends(require_user)):
    words = get_words_to_review(_user["id"])
    quiz_text = generate_quiz(words)
    return {"words": words, "quiz_text": quiz_text}


@router.post("/quiz/grade")
def quiz_grade(payload: QuizGradeIn, _user: dict = Depends(require_user)):
    feedback = grade_quiz(payload.words, payload.quiz_text, payload.user_answer)
    return {"feedback": feedback}


# ── 롤플레잉 — 회원 전용 ───────────────────────────────────
@router.post("/roleplay/start")
def roleplay_start(_user: dict = Depends(require_user)):
    words = get_words_to_review(_user["id"])
    history = start_roleplay(words)  # [("", response)]
    return {"history": [list(pair) for pair in history]}


@router.post("/roleplay/continue")
def roleplay_continue(payload: RoleplayContinueIn, _user: dict = Depends(require_user)):
    history = [list(pair) for pair in payload.history]
    new_history = continue_roleplay(history, payload.message)
    return {"history": [list(pair) for pair in new_history]}
