from langchain_core.prompts import ChatPromptTemplate

from backend.prompts.common import render_prompt

STUDY_PROMPT = ChatPromptTemplate.from_template(
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
  "paragraphs": [
    {{
      "chunk_id": 1,
      "chunk_index": 0,
      "explanation_ko": "기사 핵심 해설",
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

COMPLETE_PROMPT = ChatPromptTemplate.from_template(
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

ASK_PROMPT = ChatPromptTemplate.from_template(
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


def build_article_study_prompt(*, title: str, source: str, chunks_json: str):
    return render_prompt(
        STUDY_PROMPT,
        {
            "title": title,
            "source": source,
            "chunks_json": chunks_json,
        },
    )


def build_article_complete_prompt(*, title: str, chunks_json: str):
    return render_prompt(
        COMPLETE_PROMPT,
        {
            "title": title,
            "chunks_json": chunks_json,
        },
    )


def build_article_ask_prompt(*, question: str, chunks_json: str):
    return render_prompt(
        ASK_PROMPT,
        {
            "question": question,
            "chunks_json": chunks_json,
        },
    )
