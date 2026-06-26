"""React 프론트엔드가 사용하는 REST API.

기존 Gradio(app.py)가 이벤트 핸들러로 인라인 처리하던 기능
(검색 / 단어장 / 퀴즈 / 롤플레잉 / 슬랭 / TTS)을 HTTP 엔드포인트로 노출한다.

비회원도 가능: 단어 검색(/search), 발음(/tts), 로그인 상태 확인(/me).
회원 전용: 단어장/태그/퀴즈/롤플레잉/슬랭 (require_user 의존성으로 보호).
"""

import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from backend.auth.users import get_current_user_from_cookie
from backend.database import (
    add_label,
    bulk_delete_words,
    bulk_import_words,
    bulk_update_words,
    count_words_by_tag,
    delete_label,
    delete_word,
    existing_words_lower,
    get_all_words,
    get_quiz_stats,
    get_words_for_quiz,
    get_labels,
    get_words_to_review,
    insert_words,
    is_word_saved,
    rename_label,
    reorder_words,
    save_word,
    update_word,
)
from backend.llm import (
    continue_roleplay,
    explain_slang,
    start_roleplay,
)
from backend.quiz.schemas import QuizGenerateIn, QuizGradeIn, QuizReviewScheduleApplyIn
from backend.quiz.service import apply_review_schedule, generate_assignment, grade_assignment
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


class UpdateWordIn(BaseModel):
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""
    next_review: str = ""  # 'YYYY-MM-DD' (빈값이면 변경 안 함)


class BulkUpdateItem(BaseModel):
    id: int
    word: str = ""  # 빈값이면 영어단어 변경 안 함 (기존값 유지)
    korean: str = ""
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""
    next_review: str = ""


class BulkUpdateIn(BaseModel):
    items: list[BulkUpdateItem]


class IdsIn(BaseModel):
    ids: list[int]


class ImportItem(BaseModel):
    word: str
    korean: str = ""
    korean_detail: str = ""
    example: str = ""
    tag: str = ""


class ImportCommitIn(BaseModel):
    items: list[ImportItem]
    overwrite: bool = False  # True면 이미 있는 단어를 값 있는 칸만 덮어씀


class LabelIn(BaseModel):
    name: str


class RenameLabelIn(BaseModel):
    old_name: str
    new_name: str


class RoleplayStartIn(BaseModel):
    level: str = "intermediate"          # beginner | intermediate | advanced
    scenario: str = "daily"              # daily | opic | tag
    tag: str | None = None               # scenario == "tag" 일 때 사용


class RoleplayContinueIn(BaseModel):
    history: list  # [[user, bot], ...]
    message: str
    level: str = "intermediate"
    scenario: str = "daily"
    tag: str | None = None


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


@router.patch("/words/{word_id}")
def edit_word(word_id: int, payload: UpdateWordIn, _user: dict = Depends(require_user)):
    ok = update_word(
        _user["id"],
        word_id,
        payload.korean_detail,
        payload.english_def,
        payload.example,
        payload.tag.strip(),
        payload.next_review.strip(),
    )
    if not ok:
        return {"ok": False, "message": "수정할 단어를 찾을 수 없어요."}
    return {"ok": True, "message": "✏️ 수정했어요!"}


@router.delete("/words/{word_id}")
def remove_word(word_id: int, _user: dict = Depends(require_user)):
    ok = delete_word(_user["id"], word_id)
    if not ok:
        return {"ok": False, "message": "삭제할 단어를 찾을 수 없어요."}
    return {"ok": True, "message": "🗑️ 삭제했어요!"}


@router.post("/words/bulk-update")
def bulk_update(payload: BulkUpdateIn, _user: dict = Depends(require_user)):
    items = [it.model_dump() for it in payload.items]
    res = bulk_update_words(_user["id"], items)
    updated = res.get("updated", 0)
    conflicts = res.get("conflicts", [])
    if not res.get("ok", True):
        # swap 등으로 전체 실패
        return {
            "ok": False,
            "updated": 0,
            "skipped": res.get("skipped", 0),
            "conflicts": conflicts,
            "message": res.get("message", "중복으로 저장하지 못했어요."),
        }
    message = f"💾 {updated}개 저장했어요!"
    if conflicts:
        message += (
            f" ({len(conflicts)}개는 이미 있는 단어와 겹쳐 건너뜀: "
            + ", ".join(conflicts) + ")"
        )
    return {
        "ok": True,
        "updated": updated,
        "skipped": res.get("skipped", 0),
        "conflicts": conflicts,
        "message": message,
    }


@router.post("/words/bulk-delete")
def bulk_delete(payload: IdsIn, _user: dict = Depends(require_user)):
    deleted = bulk_delete_words(_user["id"], payload.ids)
    return {"ok": True, "deleted": deleted, "message": f"🗑️ {deleted}개 삭제했어요!"}


@router.post("/words/reorder")
def reorder(payload: IdsIn, _user: dict = Depends(require_user)):
    updated = reorder_words(_user["id"], payload.ids)
    return {"ok": True, "updated": updated}


# ── CSV/XLSX 일괄 가져오기 — 회원 전용 ──────────────────────
def _decode_bytes(content: bytes) -> str:
    """구글 내보내기는 UTF-8, Excel 재저장본은 CP949일 수 있어 차례로 시도."""
    for enc in ("utf-8-sig", "cp949", "utf-8"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


_LANG_EN = {"영어", "english", "en", "eng"}
_LANG_KO = {"한국어", "korean", "ko", "kor"}
_ALL_LANG = _LANG_EN | _LANG_KO


def _looks_like_header(a: str, b: str) -> bool:
    s = (a + " " + b).lower()
    keys = ("영어", "한국어", "english", "word", "korean", "뜻", "translation", "단어")
    return any(k in s for k in keys)


def _row_to_pair(cells) -> tuple[str, str] | None:
    """한 행을 (영어단어, 한국어뜻)으로 변환.
    구글 번역 내보내기는 4열 [소스언어, 타깃언어, 소스텍스트, 타깃텍스트]이고
    행마다 영→한/한→영 방향이 다르므로 언어 라벨을 보고 영어 쪽을 단어로 잡는다.
    그 외에는 단순 2열 [영어, 한국어]로 처리."""
    cells = [("" if c is None else str(c)).strip() for c in cells]
    if (
        len(cells) >= 4
        and cells[0].lower() in _ALL_LANG
        and cells[1].lower() in _ALL_LANG
    ):
        src_lang, tgt_lang, src_txt, tgt_txt = (
            cells[0].lower(), cells[1].lower(), cells[2], cells[3],
        )
        if src_lang in _LANG_EN:
            return src_txt, tgt_txt
        if tgt_lang in _LANG_EN:
            return tgt_txt, src_txt
        return src_txt, tgt_txt
    if len(cells) >= 2:
        return cells[0], cells[1]
    return None


def _rows_from_records(records) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for i, r in enumerate(records):
        pair = _row_to_pair(r)
        if not pair:
            continue
        word, korean = pair
        if not word:
            continue
        # 단순 2열 파일의 헤더 줄만 건너뜀 (구글 4열은 매 행이 데이터)
        if i == 0 and len(list(r)) < 3 and _looks_like_header(word, korean):
            continue
        rows.append((word, korean))
    return rows


def _parse_rows_csv(content: bytes) -> list[tuple[str, str]]:
    text = _decode_bytes(content)
    return _rows_from_records(csv.reader(io.StringIO(text)))


def _parse_rows_xlsx(content: bytes) -> list[tuple[str, str]]:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    return _rows_from_records(ws.iter_rows(values_only=True))


def _parse_upload(file: UploadFile, content: bytes) -> list[tuple[str, str]]:
    name = (file.filename or "").lower()
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        return _parse_rows_xlsx(content)
    return _parse_rows_csv(content)


@router.post("/words/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    _user: dict = Depends(require_user),
):
    """파일을 파싱만 해서 미리보기 행을 돌려준다(저장하지 않음).
    각 행에 이미 보유 중인 단어인지(dup) 표시한다."""
    content = await file.read()
    try:
        rows = _parse_upload(file, content)
    except Exception:
        return {"ok": False, "message": "파일을 읽지 못했어요. CSV 또는 XLSX인지, 첫 두 열이 영어/한국어인지 확인해주세요."}

    if not rows:
        return {"ok": False, "message": "가져올 단어가 없어요. 첫 두 열이 '영어 | 한국어' 형식인지 확인해주세요."}

    existing = existing_words_lower(_user["id"])
    out = [
        {"word": w, "korean": k, "dup": w.lower() in existing}
        for w, k in rows
    ]
    return {"ok": True, "rows": out, "count": len(out)}


@router.post("/words/import/commit")
def import_commit(payload: ImportCommitIn, _user: dict = Depends(require_user)):
    """미리보기에서 검토·편집한 행들을 실제로 저장한다."""
    items = [it.model_dump() for it in payload.items]
    if not items:
        return {"ok": False, "message": "적용할 단어가 없어요."}
    result = insert_words(_user["id"], items, overwrite=payload.overwrite)
    parts = [f"📥 {result['added']}개 추가"]
    if result.get("updated"):
        parts.append(f"{result['updated']}개 덮어씀")
    if result.get("skipped"):
        parts.append(f"{result['skipped']}개는 이미 있어 건너뜀")
    return {
        "ok": True,
        "message": ", ".join(parts),
        **result,
    }


# ── 슬랭 / 구어체 설명 — 회원 전용 (LLM 비용) ──────────────
@router.post("/slang")
def slang(payload: SlangIn, _user: dict = Depends(require_user)):
    word = payload.word.strip()
    if not word:
        return {"explanation": "단어를 먼저 검색해주세요."}
    return {"explanation": explain_slang(word, payload.korean.strip())}


# ── 퀴즈 — 회원 전용 ───────────────────────────────────────
@router.post("/quiz/generate")
def quiz_generate(payload: QuizGenerateIn, _user: dict = Depends(require_user)):
    # TODO: 복습 스케줄 기반 출제로 되돌릴 때 get_words_for_quiz에 next_review 조건을 추가한다.
    words = get_words_for_quiz(
        _user["id"],
        mode=payload.mode,
        tag=payload.tag.strip(),
        saved_from=payload.saved_from.strip(),
        saved_to=payload.saved_to.strip(),
        limit=max(payload.question_count * 3, payload.question_count),
    )
    return generate_assignment(_user["id"], words, payload)


@router.post("/quiz/grade")
def quiz_grade(payload: QuizGradeIn, _user: dict = Depends(require_user)):
    try:
        return grade_assignment(
            _user["id"],
            payload.answer_token,
            [answer.model_dump() for answer in payload.answers],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/quiz/review-schedule/apply")
def quiz_review_schedule_apply(
    payload: QuizReviewScheduleApplyIn,
    _user: dict = Depends(require_user),
):
    result = apply_review_schedule(
        _user["id"],
        payload.session_id,
        payload.incorrect_interval,
    )
    if not result.ok:
        raise HTTPException(status_code=404, detail=result.message)
    return result


@router.get("/quiz/stats")
def quiz_stats(_user: dict = Depends(require_user)):
    return get_quiz_stats(_user["id"])


# ── 롤플레잉 — 회원 전용 ───────────────────────────────────
def _roleplay_words(user_id: str, scenario: str, tag: str | None):
    """시나리오에 맞는 단어 목록을 고른다.

    태그 시나리오는 해당 태그의 단어로 맥락을 구성하고, 그 외에는 복습 예정 단어를
    사용한다. 단어가 없어도(신규 사용자 등) start_roleplay가 동작한다.
    """
    if (scenario or "").lower() == "tag" and tag:
        return get_all_words(user_id, tag)
    return get_words_to_review(user_id)


@router.post("/roleplay/start")
def roleplay_start(payload: RoleplayStartIn, _user: dict = Depends(require_user)):
    words = _roleplay_words(_user["id"], payload.scenario, payload.tag)
    history = start_roleplay(
        words, level=payload.level, scenario=payload.scenario, tag=payload.tag
    )  # [("", response)]
    return {"history": [list(pair) for pair in history]}


@router.post("/roleplay/continue")
def roleplay_continue(payload: RoleplayContinueIn, _user: dict = Depends(require_user)):
    history = [list(pair) for pair in payload.history]
    words = _roleplay_words(_user["id"], payload.scenario, payload.tag)
    new_history = continue_roleplay(
        history,
        payload.message,
        level=payload.level,
        scenario=payload.scenario,
        tag=payload.tag,
        words=words,
    )
    return {"history": [list(pair) for pair in new_history]}
