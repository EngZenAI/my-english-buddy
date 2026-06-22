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
                "english_def": "정의를 찾을 수 없어요",
                "example": "",
                "phonetic": "",
                "audio_url": ""     # 추가
            }

        # 오디오 URL 추출 (여러 개 중 첫 번째 유효한 것)
        audio_url = ""
        for phonetic in res[0].get("phonetics", []):
            if phonetic.get("audio"):
                audio_url = phonetic["audio"]
                break

        meanings  = res[0].get("meanings", [])
        phonetic  = res[0].get("phonetic", "")
        first_def = meanings[0]["definitions"][0] if meanings else {}

        return {
            "english_def": first_def.get("definition", "뜻을 찾을 수 없어요"),
            "example":     first_def.get("example", ""),
            "phonetic":    phonetic,
            "audio_url":   audio_url   # 추가
        }
    except Exception as e:
        print(f"Dictionary API 오류: {e}")
        return {"english_def": "", "example": "", "phonetic": "", "audio_url": ""}


def translate_korean(word: str) -> str:
    """Google Cloud Translation API로 한국어 번역"""
    try:
        res = requests.post(
            "https://translation.googleapis.com/language/translate/v2",
            params={"key": GOOGLE_API_KEY},
            json={
                "q": word,
                "source": "en",
                "target": "ko",
                "format": "text"
            },
            timeout=5
        ).json()

        if "error" in res:
            print(f"Google API 오류: {res['error']['message']}")
            return "번역 실패"

        return res["data"]["translations"][0]["translatedText"]

    except Exception as e:
        print(f"번역 오류: {e}")
        return "번역 실패"