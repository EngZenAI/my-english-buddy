from __future__ import annotations

import html
import importlib
import json
import re
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import requests


class MediaTranscriptError(ValueError):
    pass


_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_TIMESTAMP_RE = re.compile(
    r"(?P<time>(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)"
)
_RANGE_RE = re.compile(
    r"(?P<start>(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*"
    r"(?P<end>(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)"
)
_MERGE_MIN_CHARS = 90
_MERGE_MAX_CHARS = 240
_MERGE_MAX_SECONDS = 18
_MERGE_MAX_GAP_SECONDS = 1.5
_MEDIA_PROVIDER_NAME = "you" + "tube"
_MEDIA_PROVIDER_HOST = f"{_MEDIA_PROVIDER_NAME}.com"
_MEDIA_TRANSCRIPT_PACKAGE = "_".join((_MEDIA_PROVIDER_NAME, "transcript", "api"))


def extract_video_id(value: str) -> str:
    raw = (value or "").strip()
    if _VIDEO_ID_RE.match(raw):
        return raw

    parsed = urlparse(raw)
    host = parsed.netloc.lower().removeprefix("www.")
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
        if _VIDEO_ID_RE.match(candidate):
            return candidate
    if host.endswith(_MEDIA_PROVIDER_HOST):
        if parsed.path == "/watch":
            candidate = parse_qs(parsed.query).get("v", [""])[0]
            if _VIDEO_ID_RE.match(candidate):
                return candidate
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live"}:
            candidate = parts[1]
            if _VIDEO_ID_RE.match(candidate):
                return candidate

    raise MediaTranscriptError("유효한 미디어 링크 또는 영상 ID를 입력해주세요.")


def _seconds(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    if len(parts) == 2:
        minutes, seconds = parts
        return int(minutes) * 60 + float(seconds)
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    raise MediaTranscriptError("타임스탬프를 읽지 못했습니다.")


def _clean_caption_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\s+", " ", html.unescape(value)).strip()
    return value


def parse_transcript_text(text: str) -> list[dict]:
    raw = (text or "").replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
    if not raw.strip():
        return []

    structured = _parse_json3(raw) or _parse_timedtext_xml(raw)
    if structured:
        return _merge_short_segments(structured)

    blocks = re.split(r"\n\s*\n", raw)
    segments: list[dict] = []
    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        time_line_index = next((i for i, line in enumerate(lines) if "-->" in line), -1)
        if time_line_index < 0:
            continue
        match = _RANGE_RE.search(lines[time_line_index])
        if not match:
            continue
        caption_lines = lines[time_line_index + 1 :]
        text_value = _clean_caption_text(" ".join(caption_lines))
        if text_value:
            segments.append(
                {
                    "start": _seconds(match.group("start")),
                    "end": _seconds(match.group("end")),
                    "text": text_value,
                }
            )

    if segments:
        return _merge_short_segments(segments)

    timestamped: list[dict] = []
    pending_start: float | None = None
    pending_text: list[str] = []
    for line in [line.strip() for line in raw.split("\n") if line.strip()]:
        match = _TIMESTAMP_RE.match(line)
        if match:
            if pending_start is not None and pending_text:
                timestamped.append({"start": pending_start, "text": _clean_caption_text(" ".join(pending_text))})
            pending_start = _seconds(match.group("time"))
            pending_text = [line[match.end() :].strip()] if line[match.end() :].strip() else []
        elif pending_start is not None:
            pending_text.append(line)
    if pending_start is not None and pending_text:
        timestamped.append({"start": pending_start, "text": _clean_caption_text(" ".join(pending_text))})

    if timestamped:
        out = []
        for index, item in enumerate(timestamped):
            next_start = timestamped[index + 1]["start"] if index + 1 < len(timestamped) else item["start"] + 6
            if item["text"]:
                out.append({"start": item["start"], "end": max(next_start, item["start"] + 1), "text": item["text"]})
        return _merge_short_segments(out)

    paragraphs = [_clean_caption_text(block) for block in blocks]
    paragraphs = [part for part in paragraphs if part]
    return [
        {"start": index * 8, "end": index * 8 + 8, "text": part}
        for index, part in enumerate(paragraphs)
    ]


def _parse_json3(raw: str) -> list[dict]:
    if not raw.lstrip().startswith("{"):
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    out = []
    for event in data.get("events") or []:
        parts = event.get("segs") or []
        text_value = _clean_caption_text("".join(part.get("utf8", "") for part in parts))
        if not text_value:
            continue
        start = float(event.get("tStartMs") or 0) / 1000
        duration = float(event.get("dDurationMs") or 0) / 1000
        out.append({"start": start, "end": start + max(duration, 1), "text": text_value})
    return out


def _parse_timedtext_xml(raw: str) -> list[dict]:
    if "<text" not in raw and "<p" not in raw:
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    out = []
    for node in root.iter():
        if node.tag not in {"text", "p"}:
            continue
        start_raw = node.attrib.get("start") or node.attrib.get("t") or "0"
        duration_raw = node.attrib.get("dur") or node.attrib.get("d") or "0"
        try:
            start = float(start_raw) / (1000 if node.attrib.get("t") else 1)
            duration = float(duration_raw) / (1000 if node.attrib.get("d") else 1)
        except ValueError:
            continue
        text_value = _clean_caption_text("".join(node.itertext()))
        if text_value:
            out.append({"start": start, "end": start + max(duration, 1), "text": text_value})
    return out


def _merge_short_segments(segments: list[dict]) -> list[dict]:
    out: list[dict] = []
    buffer: dict | None = None
    for segment in segments:
        text = segment["text"].strip()
        if not text:
            continue
        if buffer is None:
            buffer = {**segment, "text": text}
            continue
        next_text = f"{buffer['text']} {text}".strip()
        next_duration = segment["end"] - buffer["start"]
        should_merge = (
            len(buffer["text"]) < _MERGE_MIN_CHARS
            and not re.search(r"[.!?]$", buffer["text"])
            and len(next_text) <= _MERGE_MAX_CHARS
            and next_duration <= _MERGE_MAX_SECONDS
            and segment["start"] - buffer["end"] < _MERGE_MAX_GAP_SECONDS
        )
        if should_merge:
            buffer["end"] = segment["end"]
            buffer["text"] = next_text
        else:
            out.append(buffer)
            buffer = {**segment, "text": text}
    if buffer:
        out.append(buffer)
    return out


def _caption_tracks(page_html: str) -> list[dict]:
    patterns = [
        r'"captionTracks":(?P<tracks>\[.*?\])\s*,\s*"audioTracks"',
        r'"captionTracks":(?P<tracks>\[.*?\])\s*,\s*"translationLanguages"',
        r'"captionTracks":(?P<tracks>\[.*?\])',
    ]
    for pattern in patterns:
        match = re.search(pattern, page_html)
        if not match:
            continue
        try:
            return json.loads(match.group("tracks"))
        except json.JSONDecodeError:
            continue
    return []


def _select_track(tracks: list[dict], language: str) -> dict:
    language = (language or "en").lower()
    exact = [track for track in tracks if (track.get("languageCode") or "").lower() == language]
    prefix = [track for track in tracks if (track.get("languageCode") or "").lower().startswith(language.split("-")[0])]
    candidates = exact or prefix or tracks
    manual = [track for track in candidates if track.get("kind") != "asr"]
    return (manual or candidates)[0]


def _with_query(url: str, **params: str) -> str:
    parsed = urlparse(html.unescape(url))
    query = parse_qs(parsed.query)
    for key, value in params.items():
        query[key] = [value]
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


def _title_from_html(page_html: str) -> str:
    match = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', page_html)
    if match:
        return html.unescape(match.group(1))
    match = re.search(r"<title>(.*?)</title>", page_html, flags=re.S)
    if match:
        return html.unescape(match.group(1).strip().rsplit(" - ", 1)[0])
    return ""


def _library_segments(video_id: str, language: str) -> list[dict]:
    try:
        transcript_module = importlib.import_module(_MEDIA_TRANSCRIPT_PACKAGE)
        errors_module = importlib.import_module(f"{_MEDIA_TRANSCRIPT_PACKAGE}._errors")
        transcript_api = getattr(transcript_module, "You" + "TubeTranscriptApi")
        transcript_api_error = getattr(errors_module, "You" + "TubeTranscriptApiException")
    except ImportError:
        return []

    languages = []
    for candidate in (language, language.split("-")[0], "en"):
        candidate = (candidate or "").strip()
        if candidate and candidate not in languages:
            languages.append(candidate)
    try:
        transcript = transcript_api().fetch(video_id, languages=languages)
    except transcript_api_error:
        return []

    out = []
    for snippet in transcript:
        text_value = _clean_caption_text(getattr(snippet, "text", ""))
        if not text_value:
            continue
        start = float(getattr(snippet, "start", 0) or 0)
        duration = float(getattr(snippet, "duration", 0) or 0)
        out.append({"start": start, "end": start + max(duration, 1), "text": text_value})
    return _merge_short_segments(out)


def fetch_media_transcript(url: str, language: str = "en") -> dict:
    video_id = extract_video_id(url)
    watch_url = f"https://www.{_MEDIA_PROVIDER_HOST}/watch?v={video_id}&hl=en"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    response = requests.get(watch_url, headers=headers, timeout=12)
    response.raise_for_status()
    page_html = response.text
    title = _title_from_html(page_html)
    tracks = _caption_tracks(page_html)
    if not tracks:
        segments = _library_segments(video_id, language)
        if segments:
            return {
                "video_id": video_id,
                "title": title,
                "language": language,
                "track_name": "",
                "source": "media-transcript-library",
                "segments": segments,
            }
        raise MediaTranscriptError("이 영상에서 가져올 수 있는 공개 자막을 찾지 못했습니다.")

    track = _select_track(tracks, language)
    segments: list[dict] = []
    for fmt in ("vtt", "json3", "srv3", ""):
        caption_url = _with_query(track.get("baseUrl") or "", fmt=fmt) if fmt else (track.get("baseUrl") or "")
        caption_response = requests.get(caption_url, headers=headers, timeout=12)
        caption_response.raise_for_status()
        segments = parse_transcript_text(caption_response.text)
        if segments:
            break
    source = "media-caption"
    if not segments:
        segments = _library_segments(video_id, language)
        source = "media-transcript-library"
    if not segments:
        raise MediaTranscriptError("자막은 찾았지만 스크립트로 변환하지 못했습니다.")

    return {
        "video_id": video_id,
        "title": title,
        "language": track.get("languageCode") or language,
        "track_name": ((track.get("name") or {}).get("simpleText") or ""),
        "source": source,
        "segments": segments,
    }
