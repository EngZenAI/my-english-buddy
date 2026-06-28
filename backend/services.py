"""UI 비의존 순수 비즈니스 로직.

검색/포맷 헬퍼를 REST API에서 재사용할 수 있도록 이 모듈로 분리했다.
여기에는 어떤 UI 의존성도 없어야 한다.

실시간 검색 속도를 위해 독립적인 외부 API 호출(사전 조회 + 번역)을 병렬로 실행한다.
"""

import base64
import io
import re
from concurrent.futures import ThreadPoolExecutor

from gtts import gTTS

from backend.dictionary import search_word, translate_korean, translate_english

# 외부 API(HTTP) 병렬 호출용 스레드풀
_executor = ThreadPoolExecutor(max_workers=8)


# ── 언어 감지 ──────────────────────────────────────────────
def is_korean(text: str) -> bool:
    return bool(re.search(r"[가-힣ㄱ-ㅎㅏ-ㅣ]", text))


# ── 여러 뜻 포맷 ───────────────────────────────────────────
def format_meanings(meanings_list: list) -> str:
    parts = []
    seen_pos: dict[str, list[str]] = {}
    for m in meanings_list:
        pos = m["partOfSpeech"]
        defn = m["definition"]
        seen_pos.setdefault(pos, []).append(defn)
    for pos, defs in seen_pos.items():
        parts.append(f"[{pos}]\n" + "\n".join(f"• {d}" for d in defs))
    return "\n\n".join(parts)


def korean_per_pos(word: str, meanings_list: list, simple_kor: str | None = None) -> str:
    """품사별 한국어 뜻. 품사가 하나면 simple_kor(이미 번역된 값)를 재사용해 중복 호출 방지.
    품사가 여러 개면 각 품사 대표 뜻을 병렬 번역한다."""
    seen_pos = list(dict.fromkeys(m["partOfSpeech"] for m in meanings_list))
    if len(seen_pos) <= 1:
        return simple_kor if simple_kor is not None else translate_korean(word)

    first_defs = []
    for pos in seen_pos:
        defs = [m["definition"] for m in meanings_list if m["partOfSpeech"] == pos]
        first_defs.append((pos, defs[0]))

    translations = list(_executor.map(lambda pd: translate_korean(pd[1]), first_defs))
    return "\n".join(
        f"[{pos}] {kor}" for (pos, _), kor in zip(first_defs, translations)
    )


def _empty_result() -> dict:
    return {
        "english_word": "",
        "korean_word": "",
        "english_def": "",
        "korean_detail": "",
        "example": "",
        "phonetic": "",
    }


# ── 영어 검색 ──────────────────────────────────────────────
def search_from_english(word: str) -> dict:
    """영어 단어 → 한국어 뜻 / 영어 뜻 / 품사별 한국어 / 예문."""
    word = word.strip()
    if not word:
        return _empty_result()

    # 사전 조회와 단순 번역은 서로 독립적 → 병렬 실행
    fut_data = _executor.submit(search_word, word.lower())
    fut_kor = _executor.submit(translate_korean, word)
    data = fut_data.result()
    simple_kor = fut_kor.result()

    detail_kor = korean_per_pos(word, data["meanings"], simple_kor)
    eng_def = format_meanings(data["meanings"])
    example = data["meanings"][0]["example"] if data["meanings"] else ""
    return {
        "english_word": word,
        "korean_word": simple_kor,
        "english_def": eng_def,
        "korean_detail": detail_kor,
        "example": example,
        "phonetic": data.get("phonetic", ""),
    }


# ── 한국어 검색 ─────────────────────────────────────────────
def search_from_korean(word: str) -> dict:
    """한국어 단어 → 영어 단어 / 영어 뜻 / 품사별 한국어 / 예문."""
    word = word.strip()
    if not word:
        return _empty_result()

    # 영어 단어를 먼저 얻어야 사전 조회 가능 (순차 의존)
    english = translate_english(word)
    data = search_word(english.lower())
    # 단일 품사면 사용자가 입력한 한국어(word)를 그대로 재사용 → 추가 번역 호출 제거
    detail_kor = korean_per_pos(english, data["meanings"], word)
    eng_def = format_meanings(data["meanings"])
    example = data["meanings"][0]["example"] if data["meanings"] else ""
    return {
        "english_word": english,
        "korean_word": word,
        "english_def": eng_def,
        "korean_detail": detail_kor,
        "example": example,
        "phonetic": data.get("phonetic", ""),
    }


# ── TTS (gTTS → base64 mp3) ────────────────────────────────
def synthesize_tts(word: str, lang: str = "en") -> str | None:
    """단어를 mp3로 합성해 base64 문자열을 반환. 실패 시 None."""
    word = (word or "").strip()
    if not word:
        return None
    try:
        tts = gTTS(text=word, lang=lang, tld="com")
        buf = io.BytesIO()
        tts.write_to_fp(buf)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode()
    except Exception:
        return None
