"""Gradio 비의존 순수 비즈니스 로직.

기존 app.py 안에 인라인으로 있던 검색/포맷 헬퍼를 REST API에서 재사용할 수 있도록
이 모듈로 분리했다. 여기에는 어떤 UI(gradio) 의존성도 없어야 한다.
"""

import base64
import io
import re

from gtts import gTTS

from backend.dictionary import search_word, translate_korean, translate_english


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


def korean_per_pos(word: str, meanings_list: list) -> str:
    seen_pos = list(dict.fromkeys(m["partOfSpeech"] for m in meanings_list))
    if len(seen_pos) <= 1:
        return translate_korean(word)
    lines = []
    for pos in seen_pos:
        defs = [m["definition"] for m in meanings_list if m["partOfSpeech"] == pos]
        kor = translate_korean(defs[0])
        lines.append(f"[{pos}] {kor}")
    return "\n".join(lines)


# ── 영어 검색 ──────────────────────────────────────────────
def search_from_english(word: str) -> dict:
    """영어 단어 → 한국어 뜻 / 영어 뜻 / 품사별 한국어 / 예문."""
    word = word.strip()
    if not word:
        return {
            "english_word": "",
            "korean_word": "",
            "english_def": "",
            "korean_detail": "",
            "example": "",
            "phonetic": "",
        }
    data = search_word(word.lower())
    simple_kor = translate_korean(word)
    detail_kor = korean_per_pos(word, data["meanings"])
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
        return {
            "english_word": "",
            "korean_word": "",
            "english_def": "",
            "korean_detail": "",
            "example": "",
            "phonetic": "",
        }
    english = translate_english(word)
    data = search_word(english.lower())
    detail_kor = korean_per_pos(english, data["meanings"])
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
    """단어를 mp3로 합성해 base64 data URI 본문(base64 문자열)을 반환. 실패 시 None."""
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
