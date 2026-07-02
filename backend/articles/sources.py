"""Supported article sources for the curated learning catalog."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ArticleFeed:
    url: str
    topic: str = ""
    scan_limit: int = 5


@dataclass(frozen=True)
class ArticleSource:
    key: str
    name: str
    domains: tuple[str, ...]
    default_topic: str
    fallback_image_url: str
    feed_url: str = ""
    feeds: tuple[ArticleFeed, ...] = ()
    site_url: str = ""
    license_status: str = "pending"
    is_active: bool = True


SUPPORTED_SOURCES = (
    ArticleSource(
        key="korea_times",
        name="The Korea Times",
        domains=("koreatimes.co.kr", "www.koreatimes.co.kr"),
        default_topic="world",
        fallback_image_url="",
        feed_url="https://feed.koreatimes.co.kr/k/world.xml",
        feeds=(
            ArticleFeed("https://feed.koreatimes.co.kr/k/world.xml", topic="world", scan_limit=3),
            ArticleFeed("https://feed.koreatimes.co.kr/k/foreignaffairs.xml", topic="world", scan_limit=3),
            ArticleFeed("https://feed.koreatimes.co.kr/k/southkorea.xml", topic="world", scan_limit=3),
            ArticleFeed("https://feed.koreatimes.co.kr/k/economy.xml", topic="business", scan_limit=3),
            ArticleFeed("https://feed.koreatimes.co.kr/k/business.xml", topic="business", scan_limit=3),
            ArticleFeed("https://feed.koreatimes.co.kr/k/entertainment.xml", topic="entertainment", scan_limit=3),
            ArticleFeed("https://feed.koreatimes.co.kr/k/lifestyle.xml", topic="lifestyle", scan_limit=3),
            ArticleFeed("https://feed.koreatimes.co.kr/k/sports.xml", topic="sports", scan_limit=3),
        ),
        site_url="https://www.koreatimes.co.kr/",
        license_status="approved",
    ),
    ArticleSource(
        key="bbc_world",
        name="BBC World",
        domains=("bbc.com", "www.bbc.com", "bbc.co.uk", "www.bbc.co.uk"),
        default_topic="world",
        fallback_image_url="",
        feed_url="https://feeds.bbci.co.uk/news/world/rss.xml",
        feeds=(
            ArticleFeed("https://feeds.bbci.co.uk/news/world/rss.xml", topic="world", scan_limit=3),
            ArticleFeed("https://feeds.bbci.co.uk/news/business/rss.xml", topic="business", scan_limit=3),
            ArticleFeed(
                "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
                topic="entertainment",
                scan_limit=3,
            ),
            ArticleFeed("https://feeds.bbci.co.uk/news/health/rss.xml", topic="health", scan_limit=3),
            ArticleFeed("https://feeds.bbci.co.uk/news/education/rss.xml", topic="education", scan_limit=3),
            ArticleFeed("https://feeds.bbci.co.uk/news/politics/rss.xml", topic="world", scan_limit=3),
            ArticleFeed("https://feeds.bbci.co.uk/news/technology/rss.xml", topic="technology", scan_limit=3),
        ),
        site_url="https://www.bbc.com/news/world",
        license_status="approved",
    ),
    ArticleSource(
        key="guardian_world",
        name="The Guardian",
        domains=("theguardian.com", "www.theguardian.com"),
        default_topic="world",
        fallback_image_url="",
        feed_url="https://www.theguardian.com/world/rss",
        feeds=(
            ArticleFeed("https://www.theguardian.com/world/rss", topic="world", scan_limit=3),
        ),
        site_url="https://www.theguardian.com/world",
        license_status="approved",
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
            "feed_url": source.feed_url,
            "site_url": source.site_url,
            "license_status": source.license_status,
            "is_active": source.is_active,
        }
        for source in SUPPORTED_SOURCES
    ]
