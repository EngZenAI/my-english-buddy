from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Boolean, Date, DateTime, Index, Integer, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.base import Base


class Word(Base):
    __tablename__ = "words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    word: Mapped[str] = mapped_column(Text, nullable=False)
    korean: Mapped[str | None] = mapped_column(Text)
    korean_detail: Mapped[str | None] = mapped_column(Text)
    english_def: Mapped[str | None] = mapped_column(Text)
    example: Mapped[str | None] = mapped_column(Text)
    tag: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
    next_review: Mapped[datetime | None] = mapped_column(
        DateTime,
        server_default=text("NOW() + INTERVAL '7 days'"),
    )


Index("ux_words_user_word", Word.user_id, func.lower(Word.word), unique=True)


class QuizHistory(Base):
    __tablename__ = "quiz_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID | None] = mapped_column()
    word_id: Mapped[int | None] = mapped_column(Integer)
    result: Mapped[bool | None] = mapped_column(Boolean)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


class QuizSession(Base):
    __tablename__ = "quiz_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    mode: Mapped[str] = mapped_column(Text, nullable=False)
    tag: Mapped[str | None] = mapped_column(Text)
    saved_from: Mapped[date | None] = mapped_column(Date)
    saved_to: Mapped[date | None] = mapped_column(Date)
    instruction: Mapped[str | None] = mapped_column(Text)
    question_count: Mapped[int | None] = mapped_column(Integer, server_default=text("10"))
    total_questions: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    score: Mapped[float | None] = mapped_column(Numeric, server_default=text("0"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    review_applied_at: Mapped[datetime | None] = mapped_column(DateTime)
    questions_json: Mapped[list | None] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))


class QuizQuestionResult(Base):
    __tablename__ = "quiz_question_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    word_id: Mapped[int | None] = mapped_column(Integer)
    source_word_id: Mapped[int | None] = mapped_column(Integer)
    source_word: Mapped[str | None] = mapped_column(Text)
    question_id: Mapped[str | None] = mapped_column(Text)
    target_word: Mapped[str | None] = mapped_column(Text)
    question_type: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[str | None] = mapped_column(Text)
    prompt: Mapped[str | None] = mapped_column(Text)
    user_answer: Mapped[str | None] = mapped_column(Text)
    correct_answer: Mapped[str | None] = mapped_column(Text)
    selected_choice_id: Mapped[str | None] = mapped_column(Text)
    correct_choice_id: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    correct: Mapped[bool | None] = mapped_column(Boolean)
    score: Mapped[float | None] = mapped_column(Numeric, server_default=text("0"))
    confidence: Mapped[float | None] = mapped_column(Numeric, server_default=text("1"))
    feedback: Mapped[str | None] = mapped_column(Text)
    is_derived: Mapped[bool | None] = mapped_column(Boolean, server_default=text("FALSE"))
    derived_from_word_id: Mapped[int | None] = mapped_column(Integer)
    suggested_word: Mapped[str | None] = mapped_column(Text)
    suggested_korean: Mapped[str | None] = mapped_column(Text)
    suggested_english_def: Mapped[str | None] = mapped_column(Text)
    suggested_example: Mapped[str | None] = mapped_column(Text)
    suggested_tag: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index(
    "ix_quiz_question_results_user_created",
    QuizQuestionResult.user_id,
    QuizQuestionResult.created_at.desc(),
)
Index("ix_quiz_question_results_session", QuizQuestionResult.session_id)


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ux_labels_user_name", Label.user_id, Label.name, unique=True)
