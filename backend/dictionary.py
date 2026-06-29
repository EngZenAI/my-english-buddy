import os
import threading
from collections import OrderedDict

import requests
from dotenv import load_dotenv

from backend.api_usage import track_external_usage

load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_TRANSLATE_API_KEY")


# ── 메모리 상한이 있는 LRU 캐시 ─────────────────────────────
# 사전/번역 결과는 모든 사용자에게 동일하므로(개인정보 아님) 공유 캐시로 안전하다.
# 다만 캐시가 무한정 커지면 메모리 누수가 되므로 최대 크기를 두고
# 가장 오래 안 쓰인 항목부터 제거(LRU)한다. 스레드 안전을 위해 lock 사용.
class LRUCache:
    def __init__(self, maxsize: int = 2000):
        self.maxsize = maxsize
        self._store: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)  # 최근 사용으로 갱신
                return self._store[key]
            return None

    def set(self, key, value):
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            if len(self._store) > self.maxsize:
                self._store.popitem(last=False)  # 가장 오래된 항목 제거


_DICT_CACHE = LRUCache(maxsize=2000)
_TR_CACHE = LRUCache(maxsize=5000)


def search_word(word: str) -> dict:
    key = word.strip().lower()
    if not key:
        return {"meanings": [], "english_def": "", "example": "", "phonetic": "", "audio_url": ""}

    cached = _DICT_CACHE.get(key)
    if cached is not None:
        return cached

    try:
        res = requests.get(
            f"https://api.dictionaryapi.dev/api/v2/entries/en/{key}",
            timeout=5,
        ).json()
        track_external_usage(
            feature="dictionary",
            operation="lookup",
            provider="free_dictionary_api",
            input_value=key,
            output_value=res,
        )

        if isinstance(res, dict) and res.get("title") == "No Definitions Found":
            result = {
                "meanings":    [],
                "english_def": "정의를 찾을 수 없어요",
                "example":     "",
                "phonetic":    "",
                "audio_url":   "",
            }
            _DICT_CACHE.set(key, result)  # 결정적 결과 → 캐시
            return result

        # 오디오 URL 추출
        audio_url = ""
        for ph in res[0].get("phonetics", []):
            if ph.get("audio"):
                audio_url = ph["audio"]
                break

        phonetic = res[0].get("phonetic", "")

        # 품사별 뜻 수집 (최대 품사 3개 × 뜻 2개)
        meanings_list = []
        for meaning in res[0].get("meanings", [])[:3]:
            pos = meaning.get("partOfSpeech", "")
            for defn in meaning.get("definitions", [])[:2]:
                meanings_list.append({
                    "partOfSpeech": pos,
                    "definition":   defn.get("definition", ""),
                    "example":      defn.get("example", ""),
                })

        first = meanings_list[0] if meanings_list else {}
        result = {
            "meanings":    meanings_list,
            "english_def": first.get("definition", "뜻을 찾을 수 없어요"),
            "example":     first.get("example", ""),
            "phonetic":    phonetic,
            "audio_url":   audio_url,
        }
        _DICT_CACHE.set(key, result)
        return result
    except Exception as e:
        # 네트워크 오류 등 일시적 실패는 캐시하지 않음
        track_external_usage(
            feature="dictionary",
            operation="lookup",
            provider="free_dictionary_api",
            input_value=key,
            success=False,
        )
        print(f"Dictionary API 오류: {e}")
        return {"meanings": [], "english_def": "", "example": "", "phonetic": "", "audio_url": ""}


def _translate(text: str, source: str, target: str) -> str:
    """Google Cloud Translation API 공통 함수 (성공 결과만 캐시)"""
    key = (text.strip(), source, target)
    if not key[0]:
        return ""
    cached = _TR_CACHE.get(key)
    if cached is not None:
        return cached

    try:
        res = requests.post(
            "https://translation.googleapis.com/language/translate/v2",
            params={"key": GOOGLE_API_KEY},
            json={"q": text, "source": source, "target": target, "format": "text"},
            timeout=5,
        ).json()
        if "error" in res:
            track_external_usage(
                feature="translate",
                operation=f"{source}_to_{target}",
                provider="google_translate",
                input_value=text,
                output_value=res,
                success=False,
            )
            print(f"Google API 오류: {res['error']['message']}")
            return "번역 실패"
        translated = res["data"]["translations"][0]["translatedText"]
        track_external_usage(
            feature="translate",
            operation=f"{source}_to_{target}",
            provider="google_translate",
            input_value=text,
            output_value=translated,
        )
        _TR_CACHE.set(key, translated)
        return translated
    except Exception as e:
        track_external_usage(
            feature="translate",
            operation=f"{source}_to_{target}",
            provider="google_translate",
            input_value=text,
            success=False,
        )
        print(f"번역 오류: {e}")
        return "번역 실패"


def translate_korean(word: str) -> str:
    """영어 → 한국어"""
    return _translate(word, source="en", target="ko")


def translate_english(word: str) -> str:
    """한국어 → 영어"""
    return _translate(word, source="ko", target="en")
