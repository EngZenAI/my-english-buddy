"""Add table comments.

Revision ID: 20260707_0001
Revises: 20260704_0002
Create Date: 2026-07-07 15:30:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260707_0001"
down_revision: Union[str, None] = "20260704_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE_COMMENTS = {
    "users": "사용자 계정 기본 정보. 이메일 로그인과 Google OAuth 계정의 기준 사용자 테이블.",
    "access_tokens": "FastAPI-Users 쿠키 인증용 액세스 토큰 저장 테이블.",
    "oauth_accounts": "사용자와 외부 OAuth 제공자 계정의 연결 정보.",
    "password_reset_codes": "이메일 비밀번호 재설정 인증 코드와 만료/사용 상태.",
    "words": "사용자별 단어장. 단어, 뜻, 예문, 태그, 정렬 순서, 다음 복습일을 저장.",
    "labels": "사용자별 단어장 태그 목록.",
    "quiz_history": "단어별 복습 이벤트 로그. 정답/오답 결과를 word_id 단위로 기록.",
    "quiz_sessions": "퀴즈 응시 1회 단위. 출제 조건, 문제 수, 점수, 완료 상태를 저장.",
    "quiz_question_results": "퀴즈 세션 안의 문제별 채점 결과와 피드백.",
    "roleplay_sessions": "롤플레잉 대화 정리와 학습노트 저장 테이블.",
    "roleplay_tts_cache": "롤플레잉 TTS 서버 캐시용 테이블. 현재 음성 캐시는 주로 브라우저 IndexedDB를 사용.",
    "agent_memories": "AI 학습 에이전트가 사용자별로 보관하는 장기 메모리.",
    "agent_jobs": "AI 학습 에이전트의 백그라운드 작업 상태와 결과.",
    "api_usage_events": "LLM, 번역, TTS 등 외부/AI 기능 사용량과 비용 추정용 이벤트 로그.",
    "article_sources": "뉴스 리딩 기사 수집 출처. RSS, 사이트, 라이선스, 활성 상태를 관리.",
    "articles": "뉴스 리딩 학습용 기사 메타데이터와 추출 본문.",
    "article_chunks": "기사를 학습 화면에서 읽기 좋은 단위로 나눈 문단.",
    "article_sessions": "사용자별 뉴스 리딩 학습 진행 기록.",
    "article_refresh_jobs": "관리자 기사 피드 새로고침 작업 상태와 수집 결과.",
}


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def upgrade() -> None:
    for table_name, comment in TABLE_COMMENTS.items():
        op.execute(
            f"COMMENT ON TABLE {_quote_identifier(table_name)} IS {_quote_literal(comment)}"
        )


def downgrade() -> None:
    for table_name in TABLE_COMMENTS:
        op.execute(f"COMMENT ON TABLE {_quote_identifier(table_name)} IS NULL")
