"""Best-effort article body extraction from public URLs."""

from __future__ import annotations

import logging
import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlparse

import requests

from backend.articles.sources import match_supported_source

logger = logging.getLogger(__name__)


class _ParagraphParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._in_paragraph = False
        self._current: list[str] = []
        self.paragraphs: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg", "form", "nav", "footer", "header"}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "p":
            self._in_paragraph = True
            self._current = []

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._skip_depth:
            if tag in {"script", "style", "noscript", "svg", "form", "nav", "footer", "header"}:
                self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag == "p" and self._in_paragraph:
            text = _clean_text(" ".join(self._current))
            if len(text) >= 40:
                self.paragraphs.append(text)
            self._in_paragraph = False
            self._current = []

    def handle_data(self, data):
        if self._skip_depth or not self._in_paragraph:
            return
        if data and data.strip():
            self._current.append(data.strip())


class _MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self._in_title = False
        self.meta: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attr = {str(k).lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
            return
        if tag != "meta":
            return
        key = (attr.get("property") or attr.get("name") or "").strip().lower()
        content = (attr.get("content") or "").strip()
        if key and content:
            self.meta[key] = content

    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and data.strip():
            self.title_parts.append(data.strip())

    def metadata(self) -> dict:
        title = (
            self.meta.get("og:title")
            or self.meta.get("twitter:title")
            or " ".join(self.title_parts)
        )
        description = (
            self.meta.get("og:description")
            or self.meta.get("twitter:description")
            or self.meta.get("description")
        )
        return {
            "title": _clean_text(title),
            "description": _clean_text(description),
            "image_url": self.meta.get("og:image") or self.meta.get("twitter:image") or "",
            "published_at": (
                self.meta.get("article:published_time")
                or self.meta.get("date")
                or self.meta.get("dc.date")
                or ""
            ),
        }


def _clean_text(text: str) -> str:
    text = unescape(text or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _valid_url(url: str) -> bool:
    parsed = urlparse(url or "")
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def extract_article_text(url: str, timeout: int = 8) -> dict:
    """Return {text, status, error}; never raises for normal extraction failures."""
    if not _valid_url(url):
        return {"text": "", "status": "invalid_url", "error": "Invalid article URL"}
    if not match_supported_source(url):
        return {"text": "", "status": "invalid_url", "error": "URL not from a supported source"}
    try:
        response = requests.get(
            url,
            timeout=timeout,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; EnglishBuddy/1.0; "
                    "+https://example.com/english-buddy)"
                )
            },
        )
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "html" not in content_type.lower():
            return {"text": "", "status": "unsupported_content", "error": content_type}
        metadata_parser = _MetadataParser()
        metadata_parser.feed(response.text)
        parser = _ParagraphParser()
        parser.feed(response.text)
        paragraphs = _dedupe_paragraphs(parser.paragraphs)
        text = "\n\n".join(paragraphs)
        if len(text) < 300:
            return {
                "text": text,
                "metadata": metadata_parser.metadata(),
                "status": "too_short",
                "error": "Not enough article text",
            }
        return {"text": text, "metadata": metadata_parser.metadata(), "status": "extracted", "error": ""}
    except Exception as exc:
        logger.info("article_extraction_failed url=%s error=%s", url, exc)
        return {"text": "", "status": "failed", "error": str(exc)}


def _dedupe_paragraphs(paragraphs: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for paragraph in paragraphs:
        key = paragraph.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(paragraph)
    return out[:80]
