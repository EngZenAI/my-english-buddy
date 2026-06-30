"""Small article-scoped retrieval helpers."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

STOPWORDS = {
    "the", "and", "for", "that", "with", "this", "from", "are", "was", "were",
    "have", "has", "had", "not", "but", "you", "your", "about", "into", "over",
    "what", "when", "where", "which", "will", "would", "could", "should",
}


def _terms(text: str) -> list[str]:
    return [
        t.lower()
        for t in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", text or "")
        if t.lower() not in STOPWORDS
    ]


def select_relevant_chunks(chunks: list[dict[str, Any]], question: str, limit: int = 4) -> list[dict[str, Any]]:
    query_terms = Counter(_terms(question))
    if not query_terms:
        return chunks[:limit]
    scored = []
    for chunk in chunks:
        text = chunk.get("text") or ""
        terms = Counter(_terms(text))
        score = sum(min(count, terms.get(term, 0)) for term, count in query_terms.items())
        # Keep nearby order useful for tie-breaking.
        scored.append((score, -(chunk.get("chunk_index") or 0), chunk))
    picked = [item for score, _order, item in sorted(scored, reverse=True) if score > 0]
    if not picked:
        picked = chunks[:limit]
    return sorted(picked[:limit], key=lambda c: c.get("chunk_index") or 0)

