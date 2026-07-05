"""LLM prompts for article learning."""

from __future__ import annotations

import json
import re
from typing import Any

from backend.exceptions import JSON_PARSE_ERRORS
from backend.llm import _invoke_tracked_llm
from backend.prompts.articles import (
    build_article_ask_prompt,
    build_article_complete_prompt,
    build_article_study_prompt,
)


def _json_from_text(raw: str, fallback: Any):
    text = raw or ""
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.S | re.I)
    if fence:
        text = fence.group(1)
    else:
        start = min([i for i in [text.find("{"), text.find("[")] if i >= 0], default=-1)
        if start >= 0:
            text = text[start:]
    try:
        return json.loads(text)
    except JSON_PARSE_ERRORS:
        return fallback


def _lead_chunks(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not chunks:
        return []
    chunk = chunks[0] or {}
    text = ""
    for candidate in (
        chunk.get("lead"),
        chunk.get("lead_text"),
        chunk.get("description"),
        chunk.get("content_snippet"),
        chunk.get("text"),
    ):
        candidate_text = str(candidate or "").strip()
        if candidate_text:
            text = candidate_text
            break
    if not text:
        return []
    return [
        {
            "chunk_id": chunk.get("id") or 1,
            "chunk_index": chunk.get("chunk_index") or 0,
            "text": text[:1400],
        }
    ]


def _lead_chunks_json(chunks: list[dict[str, Any]]) -> str:
    return json.dumps(_lead_chunks(chunks), ensure_ascii=False)


def generate_article_study(title: str, source: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    prompt = build_article_study_prompt(
        title=title or "",
        source=source or "",
        chunks_json=_lead_chunks_json(chunks),
    )
    raw = _invoke_tracked_llm("article", "study", prompt)
    data = _json_from_text(raw, {"level": "medium", "paragraphs": []})
    if not isinstance(data, dict):
        return {"level": "medium", "paragraphs": []}
    data.setdefault("paragraphs", [])
    return data


def complete_article(title: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    prompt = build_article_complete_prompt(
        title=title or "",
        chunks_json=_lead_chunks_json(chunks),
    )
    raw = _invoke_tracked_llm("article", "complete", prompt)
    data = _json_from_text(raw, {"summary_ko": "", "main_claim_ko": "", "vocab": [], "quiz": []})
    if not isinstance(data, dict):
        return {"summary_ko": "", "main_claim_ko": "", "vocab": [], "quiz": []}
    data.setdefault("vocab", [])
    data.setdefault("quiz", [])
    return data


def answer_article_question(question: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    prompt = build_article_ask_prompt(
        question=question,
        chunks_json=_lead_chunks_json(chunks),
    )
    raw = _invoke_tracked_llm("article", "ask", prompt)
    data = _json_from_text(
        raw,
        {
            "answer_ko": "기사에서 확인되는 근거를 찾지 못했어요.",
            "answer_en": "",
            "evidence_chunk_ids": [],
            "unsupported": True,
        },
    )
    if not isinstance(data, dict):
        return {
            "answer_ko": "기사에서 확인되는 근거를 찾지 못했어요.",
            "answer_en": "",
            "evidence_chunk_ids": [],
            "unsupported": True,
        }
    return data

