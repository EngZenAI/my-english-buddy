"""RSS feed collection for outbound-link article learning."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from xml.etree import ElementTree

import requests

from backend.articles.chunking import normalize_whitespace
from backend.articles.sources import ArticleFeed, ArticleSource

logger = logging.getLogger(__name__)

MEDIA_NS = "{http://search.yahoo.com/mrss/}"
ATOM_NS = "{http://www.w3.org/2005/Atom}"
CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}"
DC_NS = "{http://purl.org/dc/elements/1.1/}"

ALLOWED_TOPICS = {
    "world",
    "business",
    "entertainment",
    "health",
    "education",
    "technology",
    "opinion",
    "lifestyle",
    "sports",
}

TOPIC_KEYWORDS = (
    ("business", ("business", "economy", "finance", "market", "stock", "trade", "industry")),
    ("entertainment", ("entertainment", "arts", "k-pop", "music", "film", "celebrity")),
    ("health", ("health", "medical", "medicine", "disease")),
    ("education", ("education", "school", "university")),
    ("technology", ("technology", "tech", "ai", "digital", "internet")),
    ("opinion", ("opinion", "editorial", "column")),
    ("lifestyle", ("lifestyle", "life", "travel", "culture")),
    ("sports", ("sports", "football", "baseball", "soccer")),
    ("world", ("world", "international", "foreign", "foreign affairs", "global", "south korea", "politics")),
)


@dataclass(frozen=True)
class FeedRefreshResult:
    source_key: str
    ok: bool
    fetched: int = 0
    saved: int = 0
    skipped: int = 0
    error: str = ""


class _HTMLTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if self._skip_depth and tag.lower() in {"script", "style", "noscript", "svg"}:
            self._skip_depth -= 1

    def handle_data(self, data):
        if not self._skip_depth and data and data.strip():
            self.parts.append(data.strip())


class _MetaImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.image_url = ""

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "meta" or self.image_url:
            return
        attr = {str(k).lower(): (v or "") for k, v in attrs}
        key = (attr.get("property") or attr.get("name") or "").strip().lower()
        if key in {"og:image", "twitter:image", "twitter:image:src"}:
            self.image_url = attr.get("content", "").strip()


def _strip_html(value: str) -> str:
    parser = _HTMLTextParser()
    try:
        parser.feed(value or "")
    except Exception:
        return normalize_whitespace(re.sub(r"<[^>]+>", " ", unescape(value or "")))
    return normalize_whitespace(" ".join(parser.parts))


def _lead_sentences(text: str, limit: int = 2, max_chars: int = 520) -> str:
    clean = _strip_html(text)
    if not clean:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", clean)
    lead = " ".join([sentence for sentence in sentences if sentence][:limit])
    lead = normalize_whitespace(lead or clean)
    if len(lead) <= max_chars:
        return lead
    clipped = lead[:max_chars].rsplit(" ", 1)[0].strip()
    return f"{clipped}..." if clipped else lead[:max_chars]


def lead_text(text: str, limit: int = 2, max_chars: int = 520) -> str:
    return _lead_sentences(text, limit=limit, max_chars=max_chars)


def _estimate_reading_meta(title: str, lead: str, topic: str) -> dict[str, int | str]:
    text = normalize_whitespace(f"{title} {lead}")
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
    word_count = len(words)
    if not word_count:
        return {"level": "medium", "estimated_minutes": 1}

    sentences = [part for part in re.split(r"(?<=[.!?])\s+", lead) if part.strip()]
    avg_sentence_words = word_count / max(1, len(sentences))
    complex_words = [word for word in words if len(word.strip("-'")) >= 10]
    complex_ratio = len(complex_words) / max(1, word_count)

    score = 0
    if word_count >= 55:
        score += 1
    if word_count >= 90:
        score += 1
    if avg_sentence_words >= 24:
        score += 1
    if avg_sentence_words >= 34:
        score += 1
    if complex_ratio >= 0.18:
        score += 1
    if complex_ratio >= 0.28:
        score += 1
    if topic in {"business", "opinion", "technology"}:
        score += 1

    if score >= 4:
        level = "hard"
    elif score >= 2:
        level = "medium"
    else:
        level = "easy"

    estimated_minutes = max(1, min(4, (word_count + 89) // 90))
    return {"level": level, "estimated_minutes": estimated_minutes}


def _parse_date(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        parsed = parsedate_to_datetime(raw)
        return parsed.isoformat()
    except Exception:
        pass
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).isoformat()
    except Exception:
        return ""


def _child_text(node: ElementTree.Element, *names: str) -> str:
    for name in names:
        child = node.find(name)
        if child is not None and child.text:
            return normalize_whitespace(child.text)
    return ""


def _topic_from_category(category: str, default_topic: str) -> str:
    raw = (category or "").strip().lower()
    if not raw:
        return default_topic if default_topic in ALLOWED_TOPICS else ""
    for topic, keywords in TOPIC_KEYWORDS:
        if any(keyword in raw for keyword in keywords):
            return topic
    return default_topic if default_topic in ALLOWED_TOPICS else ""


def _safe_link(value: str, source: ArticleSource) -> str:
    link = normalize_whitespace(value)
    parsed = urlparse(link)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    if parsed.path.rstrip("/").lower().endswith("/null"):
        return ""
    host = (parsed.hostname or "").lower()
    domains = [domain.lower() for domain in source.domains]
    if not any(host == domain or host.endswith(f".{domain}") for domain in domains):
        return ""
    return link


def _image_candidate_size(node: ElementTree.Element, url: str) -> int:
    for key in ("width", "height"):
        raw = (node.attrib.get(key) or "").strip()
        if raw.isdigit():
            return int(raw)
    match = re.search(r"/(?:standard|width)/(\d{2,4})(?:/|$)", url)
    if match:
        return int(match.group(1))
    match = re.search(r"[?&](?:width|w)=(\d{2,4})", url)
    if match:
        return int(match.group(1))
    return 0


def _item_image(item: ElementTree.Element) -> str:
    candidates: list[tuple[int, str]] = []
    for tag in (f"{MEDIA_NS}thumbnail", f"{MEDIA_NS}content", "enclosure"):
        for child in item.findall(tag):
            url = child.attrib.get("url", "").strip()
            medium = child.attrib.get("medium", "").strip().lower()
            content_type = child.attrib.get("type", "").strip().lower()
            if url and (medium == "image" or content_type.startswith("image/") or tag != "enclosure"):
                candidates.append((_image_candidate_size(child, url), url))
    if not candidates:
        return ""
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _upgrade_image_url(value: str) -> str:
    url = normalize_whitespace(value)
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host.endswith("ichef.bbci.co.uk"):
        path = re.sub(r"/standard/\d{2,4}/", "/standard/976/", parsed.path)
        return urlunparse(parsed._replace(path=path))
    if host.endswith("i.guim.co.uk"):
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        if "width" in query:
            query["width"] = "1000"
        if "quality" in query:
            query["quality"] = "85"
        return urlunparse(parsed._replace(query=urlencode(query)))
    return url


def _valid_image_url(value: str) -> str:
    url = _upgrade_image_url(value)
    parsed = urlparse(url)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        lowered = url.lower()
        if "/logo" in lowered or "logo_" in lowered:
            return ""
        return url
    return ""


def _fetch_page_image(url: str, timeout: int = 5) -> str:
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
            return ""
        parser = _MetaImageParser()
        parser.feed(response.text[:120000])
        return _valid_image_url(parser.image_url)
    except Exception as exc:
        logger.info("article_image_metadata_failed url=%s error=%s", url, exc)
        return ""


def _dedupe_repeated_images(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    for entry in entries:
        image_url = (entry.get("image_url") or "").strip()
        if not image_url:
            continue
        if image_url in seen:
            entry["image_url"] = ""
            continue
        seen.add(image_url)
    return entries


def parse_feed_entries(
    xml_text: str,
    source: ArticleSource,
    max_items: int = 5,
    forced_topic: str = "",
) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as exc:
        raise ValueError(f"Invalid RSS XML: {exc}") from exc

    if root.tag.endswith("feed"):
        items = root.findall(f"{ATOM_NS}entry")
    else:
        channel = root.find("channel")
        items = channel.findall("item") if channel is not None else root.findall(".//item")

    entries: list[dict[str, Any]] = []
    for item in items[:max_items]:
        if item.tag.endswith("entry"):
            title = _child_text(item, f"{ATOM_NS}title", "title")
            link_node = item.find(f"{ATOM_NS}link")
            link = link_node.attrib.get("href", "") if link_node is not None else ""
            summary = _child_text(item, f"{ATOM_NS}summary", f"{ATOM_NS}content", "summary", "content")
            published = _child_text(item, f"{ATOM_NS}published", f"{ATOM_NS}updated", "published", "updated")
            guid = _child_text(item, f"{ATOM_NS}id", "id") or link
            category_node = item.find(f"{ATOM_NS}category")
            category = category_node.attrib.get("term", "") if category_node is not None else ""
        else:
            title = _child_text(item, "title")
            link = _child_text(item, "link")
            summary = _child_text(item, "description", f"{CONTENT_NS}encoded")
            published = _child_text(item, "pubDate", f"{DC_NS}date")
            guid = _child_text(item, "guid") or link
            category = _child_text(item, "category")

        safe_link = _safe_link(link, source)
        lead = _lead_sentences(summary)
        if not title or not safe_link or not lead:
            continue
        topic = forced_topic or _topic_from_category(category, source.default_topic)
        if topic not in ALLOWED_TOPICS:
            continue
        reading_meta = _estimate_reading_meta(title, lead, topic)

        entries.append(
            {
                "source_key": source.key,
                "source": source.name,
                "title": _strip_html(title),
                "url": safe_link,
                "feed_entry_id": normalize_whitespace(guid)[:500],
                "image_url": _valid_image_url(_item_image(item)),
                "published_at": _parse_date(published),
                "topic": topic,
                "level": reading_meta["level"],
                "estimated_minutes": reading_meta["estimated_minutes"],
                "description": lead,
                "content_snippet": lead,
                "license_status": source.license_status,
                "collection_method": "rss",
            }
        )
    return entries


def _source_feeds(source: ArticleSource) -> tuple[ArticleFeed, ...]:
    if source.feeds:
        return source.feeds
    if source.feed_url:
        return (ArticleFeed(source.feed_url, scan_limit=5),)
    return ()


def _limit_by_topic(entries: list[dict[str, Any]], per_topic_limit: int) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    limited: list[dict[str, Any]] = []
    for entry in sorted(
        entries,
        key=lambda item: ((item.get("published_at") or ""), item.get("title") or ""),
        reverse=True,
    ):
        topic = entry.get("topic") or ""
        if topic not in ALLOWED_TOPICS:
            continue
        if counts.get(topic, 0) >= per_topic_limit:
            continue
        counts[topic] = counts.get(topic, 0) + 1
        limited.append(entry)
    return limited


def fetch_feed_entries(source: ArticleSource, timeout: int = 8, max_items: int = 1) -> list[dict[str, Any]]:
    feeds = _source_feeds(source)
    if source.license_status != "approved" or not source.is_active or not feeds:
        return []
    entries: list[dict[str, Any]] = []
    for feed in feeds:
        try:
            response = requests.get(
                feed.url,
                timeout=timeout,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (compatible; EnglishBuddy/1.0; "
                        "+https://example.com/english-buddy)"
                    )
                },
            )
            response.raise_for_status()
            entries.extend(
                parse_feed_entries(
                    response.text,
                    source,
                    max_items=feed.scan_limit,
                    forced_topic=feed.topic,
                )
            )
        except Exception as exc:
            logger.warning(
                "article_feed_fetch_failed source=%s feed_url=%s error=%s",
                source.key,
                feed.url,
                exc,
            )
            continue
    entries = _limit_by_topic(entries, per_topic_limit=max(1, max_items))
    for entry in entries:
        if not entry.get("image_url"):
            entry["image_url"] = _fetch_page_image(entry["url"], timeout=min(timeout, 5))
    return _dedupe_repeated_images(entries)
