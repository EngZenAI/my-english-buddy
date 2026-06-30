"""LLM prompts for article learning."""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.prompts import ChatPromptTemplate

from backend.llm import _invoke_tracked_llm


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
    except Exception:
        return fallback


_STUDY_PROMPT = ChatPromptTemplate.from_template(
    """
You are an English reading tutor for Korean learners.
Create short study material from the article title and lead excerpt.

Rules:
- Do not add facts that are not in the provided title/excerpt.
- Keep explanations in Korean, but keep useful English expressions in English.
- Extract practical vocabulary/expressions suitable for saving to a wordbook.
- Return only JSON.

Article title: {title}
Source: {source}
Excerpt chunks JSON:
{chunks_json}

JSON shape:
{{
  "level": "easy|medium|hard",
  "estimated_minutes": 5,
  "headline_ko": "Korean title translation",
  "paragraphs": [
    {{
      "chunk_id": 1,
      "chunk_index": 0,
      "explanation_ko": "리드문 핵심 해설",
      "key_expressions": [
        {{
          "word": "expression",
          "korean": "짧은 한국어 뜻",
          "english_def": "plain English meaning",
          "example": "exact or lightly trimmed sentence from the chunk"
        }}
      ],
      "check_question": "한국어 확인 질문",
      "answer_ko": "짧은 모범 답안"
    }}
  ]
}}
"""
)


_COMPLETE_PROMPT = ChatPromptTemplate.from_template(
    """
You are finishing an English article lesson for a Korean learner.
Use only the article title and lead excerpt below.
Return concise JSON.

Title: {title}
Chunks JSON:
{chunks_json}

JSON shape:
{{
  "summary_ko": "전체 요약 3-5문장",
  "main_claim_ko": "기사의 핵심 주장 또는 핵심 사건",
  "vocab": [
    {{
      "word": "useful word or phrase",
      "korean": "한국어 뜻",
      "english_def": "plain English meaning",
      "example": "article sentence"
    }}
  ],
  "quiz": [
    {{
      "type": "main_idea|detail|vocab|inference",
      "question": "Korean question",
      "answer": "Korean answer",
      "evidence_chunk_id": 1
    }}
  ]
}}
"""
)


_ASK_PROMPT = ChatPromptTemplate.from_template(
    """
You answer questions about one English article for a Korean learner.
Use only the title and lead excerpt. If the answer is not supported, say so.
Return only JSON.

Question: {question}
Evidence chunks JSON:
{chunks_json}

JSON shape:
{{
  "answer_ko": "한국어 답변",
  "answer_en": "short English answer",
  "evidence_chunk_ids": [1, 2],
  "unsupported": false
}}
"""
)


def generate_article_study(title: str, source: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    compact_chunks = [
        {
            "chunk_id": c["id"],
            "chunk_index": c["chunk_index"],
            "text": c["text"][:1400],
        }
        for c in chunks[:10]
    ]
    prompt = _STUDY_PROMPT.invoke(
        {
            "title": title or "",
            "source": source or "",
            "chunks_json": json.dumps(compact_chunks, ensure_ascii=False),
        }
    )
    raw = _invoke_tracked_llm("article", "study", prompt)
    data = _json_from_text(raw, {"level": "medium", "estimated_minutes": 5, "paragraphs": []})
    if not isinstance(data, dict):
        return {"level": "medium", "estimated_minutes": 5, "paragraphs": []}
    data.setdefault("paragraphs", [])
    return data


def complete_article(title: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    compact_chunks = [
        {"chunk_id": c["id"], "chunk_index": c["chunk_index"], "text": c["text"][:1400]}
        for c in chunks[:12]
    ]
    prompt = _COMPLETE_PROMPT.invoke(
        {
            "title": title or "",
            "chunks_json": json.dumps(compact_chunks, ensure_ascii=False),
        }
    )
    raw = _invoke_tracked_llm("article", "complete", prompt)
    data = _json_from_text(raw, {"summary_ko": "", "main_claim_ko": "", "vocab": [], "quiz": []})
    if not isinstance(data, dict):
        return {"summary_ko": "", "main_claim_ko": "", "vocab": [], "quiz": []}
    data.setdefault("vocab", [])
    data.setdefault("quiz", [])
    return data


def answer_article_question(question: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    compact_chunks = [
        {"chunk_id": c["id"], "chunk_index": c["chunk_index"], "text": c["text"][:1400]}
        for c in chunks
    ]
    prompt = _ASK_PROMPT.invoke(
        {
            "question": question,
            "chunks_json": json.dumps(compact_chunks, ensure_ascii=False),
        }
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

