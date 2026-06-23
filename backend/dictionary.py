import requests
import os
from dotenv import load_dotenv

load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_TRANSLATE_API_KEY")

def search_word(word: str) -> dict:
    try:
        res = requests.get(
            f"https://api.dictionaryapi.dev/api/v2/entries/en/{word.strip()}",
            timeout=5
        ).json()

        if isinstance(res, dict) and res.get("title") == "No Definitions Found":
            return {
                "meanings":    [],
                "english_def": "정의를 찾을 수 없어요",
                "example":     "",
                "phonetic":    "",
                "audio_url":   "",
            }

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
        return {
            "meanings":    meanings_list,
            "english_def": first.get("definition", "뜻을 찾을 수 없어요"),
            "example":     first.get("example", ""),
            "phonetic":    phonetic,
            "audio_url":   audio_url,
        }
    except Exception as e:
        print(f"Dictionary API 오류: {e}")
        return {"meanings": [], "english_def": "", "example": "", "phonetic": "", "audio_url": ""}


def _translate(text: str, source: str, target: str) -> str:
    """Google Cloud Translation API 공통 함수"""
    try:
        res = requests.post(
            "https://translation.googleapis.com/language/translate/v2",
            params={"key": GOOGLE_API_KEY},
            json={"q": text, "source": source, "target": target, "format": "text"},
            timeout=5
        ).json()
        if "error" in res:
            print(f"Google API 오류: {res['error']['message']}")
            return "번역 실패"
        return res["data"]["translations"][0]["translatedText"]
    except Exception as e:
        print(f"번역 오류: {e}")
        return "번역 실패"


def translate_korean(word: str) -> str:
    """영어 → 한국어"""
    return _translate(word, source="en", target="ko")


def translate_english(word: str) -> str:
    """한국어 → 영어"""
    return _translate(word, source="ko", target="en")