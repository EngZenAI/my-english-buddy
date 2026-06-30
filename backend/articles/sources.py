"""Supported article sources for the curated learning catalog."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class ArticleSource:
    key: str
    name: str
    domains: tuple[str, ...]
    default_topic: str
    fallback_image_url: str


TOPIC_FALLBACK_IMAGES = {
    "world": "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
    "business": "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
    "technology": "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
    "science": "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?auto=format&fit=crop&w=1200&q=80",
    "health": "https://images.unsplash.com/photo-1505751172876-fa1923c5c528?auto=format&fit=crop&w=1200&q=80",
    "culture": "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
}


SUPPORTED_SOURCES = (
    ArticleSource(
        key="nasa",
        name="NASA",
        domains=("nasa.gov", "www.nasa.gov", "science.nasa.gov"),
        default_topic="science",
        fallback_image_url=TOPIC_FALLBACK_IMAGES["science"],
    ),
    ArticleSource(
        key="un_news",
        name="UN News",
        domains=("news.un.org",),
        default_topic="world",
        fallback_image_url=TOPIC_FALLBACK_IMAGES["world"],
    ),
    ArticleSource(
        key="world_bank",
        name="World Bank Blogs",
        domains=("blogs.worldbank.org", "www.worldbank.org"),
        default_topic="business",
        fallback_image_url=TOPIC_FALLBACK_IMAGES["business"],
    ),
    ArticleSource(
        key="voa_learning",
        name="VOA Learning English",
        domains=("learningenglish.voanews.com",),
        default_topic="culture",
        fallback_image_url=TOPIC_FALLBACK_IMAGES["culture"],
    ),
    ArticleSource(
        key="nih",
        name="NIH",
        domains=("nih.gov", "www.nih.gov"),
        default_topic="health",
        fallback_image_url=TOPIC_FALLBACK_IMAGES["health"],
    ),
    ArticleSource(
        key="cdc",
        name="CDC",
        domains=("cdc.gov", "www.cdc.gov"),
        default_topic="health",
        fallback_image_url=TOPIC_FALLBACK_IMAGES["health"],
    ),
)


def source_payloads() -> list[dict]:
    return [
        {
            "key": source.key,
            "name": source.name,
            "domains": list(source.domains),
            "default_topic": source.default_topic,
            "fallback_image_url": source.fallback_image_url,
        }
        for source in SUPPORTED_SOURCES
    ]


def match_supported_source(url: str) -> ArticleSource | None:
    host = (urlparse(url or "").hostname or "").lower()
    if not host:
        return None
    for source in SUPPORTED_SOURCES:
        for domain in source.domains:
            domain = domain.lower()
            if host == domain or host.endswith(f".{domain}"):
                return source
    return None


def fallback_image_for(topic: str) -> str:
    return TOPIC_FALLBACK_IMAGES.get((topic or "").strip().lower()) or TOPIC_FALLBACK_IMAGES["world"]

