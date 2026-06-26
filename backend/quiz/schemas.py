from pydantic import BaseModel, Field


class QuizChoice(BaseModel):
    id: str = Field(description="Choice id, usually A, B, C, D")
    text: str


class QuizGenerateIn(BaseModel):
    mode: str = "random"
    tag: str = ""
    saved_from: str = ""
    saved_to: str = ""
    instruction: str = ""
    question_count: int = 10


class QuizQuestion(BaseModel):
    id: str
    word_id: int
    word: str = ""
    source_word_id: int | None = None
    source_word: str = ""
    target_word: str = ""
    question_type: str = "meaning_choice"
    difficulty: str = "easy"
    prompt: str
    passage: str = ""
    choices: list[QuizChoice] = Field(default_factory=list)
    answer_format: str = "choice"
    is_derived: bool = False
    is_related: bool = False
    relation_type: str = ""
    derived_from_word_id: int | None = None


class QuizGenerateResponse(BaseModel):
    ok: bool = True
    message: str = ""
    session_id: int | None = None
    questions: list[QuizQuestion] = Field(default_factory=list)
    answer_token: str = ""


class QuizAnswerIn(BaseModel):
    question_id: str
    choice_id: str = ""
    text_answer: str = ""


class QuizGradeIn(BaseModel):
    answer_token: str
    answers: list[QuizAnswerIn]


class QuizReviewScheduleItem(BaseModel):
    word_id: int
    word: str = ""
    result: str = "incorrect"
    proposed_next_review: str = ""
    interval_days: int = 1


class QuizReviewScheduleApplyIn(BaseModel):
    session_id: int
    incorrect_interval: str = "1d"


class QuizReviewScheduleApplyResponse(BaseModel):
    ok: bool = True
    session_id: int
    updated: int = 0
    already_applied: bool = False
    message: str = ""
    review_schedule_preview: list[QuizReviewScheduleItem] = Field(default_factory=list)


class QuizGradedQuestion(BaseModel):
    question_id: str
    word_id: int
    word: str
    source_word_id: int | None = None
    source_word: str = ""
    target_word: str = ""
    question_type: str = ""
    difficulty: str = ""
    prompt: str
    selected_choice_id: str = ""
    selected_text: str = ""
    text_answer: str = ""
    correct_choice_id: str = ""
    correct_text: str = ""
    acceptable_answers: list[str] = Field(default_factory=list)
    status: str = "incorrect"
    correct: bool = False
    score: float = 0.0
    confidence: float = 1.0
    explanation: str = ""
    answer_explanation: str = ""
    choice_explanations: dict[str, str] = Field(default_factory=dict)
    study_note: str = ""
    is_derived: bool = False
    is_related: bool = False
    relation_type: str = ""
    derived_from_word_id: int | None = None
    suggested_word: str = ""
    suggested_korean: str = ""
    suggested_english_def: str = ""
    suggested_example: str = ""
    suggested_tag: str = "미지정"
    can_add_to_wordbook: bool = False


class QuizGradeResponse(BaseModel):
    ok: bool = True
    session_id: int | None = None
    score: float = 0.0
    total: int = 0
    feedback: str = ""
    type_stats: dict[str, dict[str, float]] = Field(default_factory=dict)
    review_schedule_preview: list[QuizReviewScheduleItem] = Field(default_factory=list)
    review_schedule_applied: bool = False
    results: list[QuizGradedQuestion] = Field(default_factory=list)
