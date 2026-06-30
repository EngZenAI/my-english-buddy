"""Utilities for turning article text into stable study chunks."""

from __future__ import annotations

import re


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def split_article_text(text: str, max_chars: int = 1200) -> list[str]:
    """Split article text into paragraph-preserving chunks.

    The output is deterministic and ordered. It prefers original paragraph
    boundaries, then falls back to sentence boundaries for unusually long
    paragraphs.
    """
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [normalize_whitespace(p) for p in re.split(r"\n{2,}", raw)]
    paragraphs = [p for p in paragraphs if len(p) >= 40]
    if not paragraphs:
        compact = normalize_whitespace(raw)
        paragraphs = [compact] if compact else []

    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            for sentence in re.split(r"(?<=[.!?])\s+", paragraph):
                sentence = normalize_whitespace(sentence)
                if not sentence:
                    continue
                # Force split oversized sentences
                if len(sentence) > max_chars:
                    if current:
                        chunks.append(current)
                        current = ""
                    chunks.append(sentence[:max_chars])
                    continue
                if current and len(current) + len(sentence) + 1 > max_chars:
                    chunks.append(current)
                    current = sentence
                else:
                    current = f"{current} {sentence}".strip()
            continue
        if current and len(current) + len(paragraph) + 2 > max_chars:
            chunks.append(current)
            current = paragraph
        else:
            current = f"{current}\n\n{paragraph}".strip()
    if current:
        chunks.append(current)
    return chunks[:12]


def estimate_tokens(text: str) -> int:
    # Good enough for budgeting and display; actual provider tokenization varies.
    return max(1, len(normalize_whitespace(text)) // 4)

