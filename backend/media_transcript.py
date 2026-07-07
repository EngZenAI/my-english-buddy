from __future__ import annotations

import html
import importlib
import json
import re
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import requests

from backend.exceptions import HTTP_JSON_ERRORS


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
_DIRECT_TRACK_LIMIT = 6
_MEDIA_PROVIDER_NAME = "you" + "tube"
_MEDIA_PROVIDER_HOST = f"{_MEDIA_PROVIDER_NAME}.com"
_MEDIA_TRANSCRIPT_PACKAGE = "_".join((_MEDIA_PROVIDER_NAME, "transcript", "api"))
_INNERTUBE_API_KEY_RE = re.compile(r'"INNERTUBE_API_KEY":\s*"([A-Za-z0-9_-]+)"')
_INNERTUBE_API_URL = f"https://www.{_MEDIA_PROVIDER_HOST}/youtubei/v1/player?key={{api_key}}"
_INNERTUBE_CONTEXT = {"client": {"clientName": "ANDROID", "clientVersion": "20.10.38"}}


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


def _local_tag_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _parse_json3(raw: str) -> list[dict]:
    raw = raw.lstrip()
    if not raw.startswith("{"):
        json_start = raw.find("{")
        if json_start < 0:
            return []
        raw = raw[json_start:]
    if not raw.startswith("{"):
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
    if "<text" not in raw and "<p" not in raw and ":text" not in raw and ":p" not in raw:
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    out = []
    for node in root.iter():
        if _local_tag_name(node.tag) not in {"text", "p"}:
            continue
        try:
            start = _xml_time_seconds(
                node.attrib.get("start") or node.attrib.get("t") or node.attrib.get("begin") or "0",
                is_milliseconds=bool(node.attrib.get("t")),
            )
            if node.attrib.get("end"):
                end = _xml_time_seconds(node.attrib["end"])
            else:
                duration = _xml_time_seconds(
                    node.attrib.get("dur") or node.attrib.get("d") or "0",
                    is_milliseconds=bool(node.attrib.get("d")),
                )
                end = start + max(duration, 1)
        except ValueError:
            continue
        text_value = _clean_caption_text("".join(node.itertext()))
        if text_value:
            out.append({"start": start, "end": max(end, start + 1), "text": text_value})
    return out


def _xml_time_seconds(value: str, *, is_milliseconds: bool = False) -> float:
    raw = (value or "0").strip()
    if not raw:
        return 0
    if ":" in raw:
        return _seconds(raw)
    raw = raw.removesuffix("s")
    seconds = float(raw)
    return seconds / 1000 if is_milliseconds else seconds


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


def _innertube_caption_tracks(video_id: str, page_html: str, headers: dict) -> list[dict]:
    match = _INNERTUBE_API_KEY_RE.search(page_html)
    if not match:
        return []
    try:
        response = requests.post(
            _INNERTUBE_API_URL.format(api_key=match.group(1)),
            headers=headers,
            json={"context": _INNERTUBE_CONTEXT, "videoId": video_id},
            timeout=12,
        )
        response.raise_for_status()
        data = response.json()
    except HTTP_JSON_ERRORS:
        return []
    return (
        data.get("captions", {})
        .get("playerCaptionsTracklistRenderer", {})
        .get("captionTracks", [])
        or []
    )


def _select_track(tracks: list[dict], language: str) -> dict:
    return _ordered_tracks(tracks, language)[0]


def _ordered_tracks(tracks: list[dict], language: str) -> list[dict]:
    language = (language or "en").lower()
    exact = [track for track in tracks if (track.get("languageCode") or "").lower() == language]
    prefix = [track for track in tracks if (track.get("languageCode") or "").lower().startswith(language.split("-")[0])]
    candidates = exact or prefix or tracks
    manual = [track for track in candidates if track.get("kind") != "asr"]
    first = manual or candidates
    seen: set[int] = set()
    ordered = []
    for track in [*first, *tracks]:
        marker = id(track)
        if marker not in seen:
            ordered.append(track)
            seen.add(marker)
    return ordered


def _track_language(track: dict, fallback: str) -> str:
    return (track.get("languageCode") or fallback or "en").strip()


def _track_name(track: dict) -> str:
    name = track.get("name") or {}
    simple = name.get("simpleText")
    if simple:
        return simple
    runs = name.get("runs") or []
    return "".join(run.get("text", "") for run in runs).strip()


def _track_languages(tracks: list[dict], *fallbacks: str) -> list[str]:
    languages = []
    for candidate in [*fallbacks, *(_track_language(track, "") for track in tracks)]:
        candidate = (candidate or "").strip()
        if candidate and candidate not in languages:
            languages.append(candidate)
        prefix = candidate.split("-")[0] if candidate else ""
        if prefix and prefix not in languages:
            languages.append(prefix)
    return languages or ["en"]


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


def _transcript_api_parts():
    try:
        transcript_module = importlib.import_module(_MEDIA_TRANSCRIPT_PACKAGE)
        errors_module = importlib.import_module(f"{_MEDIA_TRANSCRIPT_PACKAGE}._errors")
        transcript_api = getattr(transcript_module, "You" + "TubeTranscriptApi")
        transcript_api_error = getattr(errors_module, "You" + "TubeTranscriptApiException")
    except ImportError:
        return None, None
    return transcript_api, transcript_api_error


def _segments_from_snippets(snippets) -> list[dict]:
    out = []
    for snippet in snippets:
        text_value = _clean_caption_text(getattr(snippet, "text", ""))
        if not text_value:
            continue
        start = float(getattr(snippet, "start", 0) or 0)
        duration = float(getattr(snippet, "duration", 0) or 0)
        out.append({"start": start, "end": start + max(duration, 1), "text": text_value})
    return _merge_short_segments(out)


def _library_segments(video_id: str, language: str) -> list[dict]:
    transcript_api, transcript_api_error = _transcript_api_parts()
    if transcript_api is None or transcript_api_error is None:
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

    return _segments_from_snippets(transcript)


def _library_segments_any(video_id: str, languages: list[str]) -> tuple[list[dict], str]:
    transcript_api, transcript_api_error = _transcript_api_parts()
    if transcript_api is None or transcript_api_error is None:
        return [], ""

    api = transcript_api()
    try:
        transcript_list = api.list(video_id)
    except transcript_api_error:
        return [], ""

    language_rank = {language.lower(): index for index, language in enumerate(languages)}

    def transcript_rank(transcript) -> tuple[int, int, str]:
        code = (getattr(transcript, "language_code", "") or "").lower()
        exact_rank = language_rank.get(code)
        if exact_rank is not None:
            return exact_rank, int(getattr(transcript, "is_generated", True)), code
        prefix = code.split("-")[0]
        prefix_rank = language_rank.get(prefix, len(language_rank) + 1)
        return prefix_rank, int(getattr(transcript, "is_generated", True)), code

    for transcript in sorted(list(transcript_list), key=transcript_rank):
        try:
            segments = _segments_from_snippets(transcript.fetch())
        except transcript_api_error:
            continue
        if segments:
            return segments, getattr(transcript, "language_code", "") or ""
    return [], ""


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
    tracks = _innertube_caption_tracks(video_id, page_html, headers) or _caption_tracks(page_html)
    if not tracks:
        segments, library_language = _library_segments_any(video_id, _track_languages([], language))
        if segments:
            return {
                "video_id": video_id,
                "title": title,
                "language": library_language or language,
                "track_name": "",
                "source": "media-transcript-library",
                "segments": segments,
            }
        raise MediaTranscriptError("이 영상에서 가져올 수 있는 공개 자막을 찾지 못했습니다.")

    ordered_tracks = _ordered_tracks(tracks, language)
    track = ordered_tracks[0]
    segments: list[dict] = []
    source_track = track
    for candidate_track in ordered_tracks[:_DIRECT_TRACK_LIMIT]:
        for fmt in ("vtt", "json3", "srv3", ""):
            caption_url = (
                _with_query(candidate_track.get("baseUrl") or "", fmt=fmt)
                if fmt
                else (candidate_track.get("baseUrl") or "")
            )
            caption_response = requests.get(caption_url, headers=headers, timeout=12)
            caption_response.raise_for_status()
            segments = parse_transcript_text(caption_response.text)
            if segments:
                source_track = candidate_track
                break
        if segments:
            break
    source = "media-caption"
    if not segments:
        segments, library_language = _library_segments_any(
            video_id,
            _track_languages(ordered_tracks, _track_language(track, language), language),
        )
        if library_language:
            source_track = {"languageCode": library_language, "name": {"simpleText": ""}}
        source = "media-transcript-library"
    if not segments:
        raise MediaTranscriptError("자막은 찾았지만 스크립트로 변환하지 못했습니다.")

    return {
        "video_id": video_id,
        "title": title,
        "language": source_track.get("languageCode") or language,
        "track_name": _track_name(source_track),
        "source": source,
        "segments": segments,
    }
