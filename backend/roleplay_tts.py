import base64
import hashlib
import os
import re
import wave
from pathlib import Path

import requests
from dotenv import load_dotenv

from backend.api_usage import track_external_usage

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", encoding="utf-8-sig")

DEFAULT_TTS_MODEL = os.getenv(
    "GEMINI_TTS_MODEL",
    "gemini-2.5-flash-preview-tts",
)
DEFAULT_TTS_VOICE = os.getenv("GEMINI_TTS_VOICE", "Kore")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def normalize_tts_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def roleplay_tts_cache_key(
    text: str,
    model: str = DEFAULT_TTS_MODEL,
    voice: str = DEFAULT_TTS_VOICE,
    style: str = "natural-roleplay",
) -> str:
    normalized = normalize_tts_text(text)
    raw = "\n".join([model, voice, style, normalized])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _sample_rate_from_mime(mime_type: str) -> int:
    match = re.search(r"rate=(\d+)", mime_type or "")
    return int(match.group(1)) if match else 24000


def _wav_from_pcm(pcm: bytes, sample_rate: int) -> bytes:
    from io import BytesIO

    out = BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return out.getvalue()


def _audio_payload_to_wav(audio_b64: str, mime_type: str) -> bytes:
    raw = base64.b64decode(audio_b64)
    if "wav" in (mime_type or "").lower() or raw.startswith(b"RIFF"):
        return raw
    return _wav_from_pcm(raw, _sample_rate_from_mime(mime_type))


def synthesize_roleplay_tts(
    text: str,
    *,
    model: str = DEFAULT_TTS_MODEL,
    voice: str = DEFAULT_TTS_VOICE,
) -> tuple[bytes, str, str, str]:
    """Gemini TTS로 roleplay 답변을 WAV bytes로 합성한다."""
    normalized = normalize_tts_text(text)
    if not normalized:
        raise ValueError("TTS text is empty.")
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    prompt = (
        "Read this role-play line aloud in natural, friendly American English. "
        "Do not add extra words or sound effects.\n\n"
        f"{normalized}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice,
                    }
                }
            },
        },
    }

    response = requests.post(
        GEMINI_ENDPOINT.format(model=model),
        params={"key": GEMINI_API_KEY},
        json=payload,
        timeout=60,
    )
    try:
        response.raise_for_status()
        data = response.json()
        part = data["candidates"][0]["content"]["parts"][0]
        inline = part.get("inlineData") or part.get("inline_data") or {}
        audio_b64 = inline["data"]
        mime_type = inline.get("mimeType") or inline.get("mime_type") or "audio/L16;rate=24000"
        wav_bytes = _audio_payload_to_wav(audio_b64, mime_type)
    except Exception:
        track_external_usage(
            feature="roleplay",
            operation="tts",
            provider="gemini",
            model=model,
            input_value=normalized,
            success=False,
        )
        raise

    track_external_usage(
        feature="roleplay",
        operation="tts",
        provider="gemini",
        model=model,
        input_value=normalized,
        output_value=wav_bytes,
    )
    return wav_bytes, "audio/wav", model, voice
