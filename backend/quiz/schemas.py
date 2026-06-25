from pydantic import BaseModel, Field


class QuizChoice(BaseModel):
    id: str = Field(description="Choice id, one of A, B, C, D")
    text: str


class QuizQuestion(BaseModel):
    id: str
    word_id: int
    type: str
    prompt: str
    choices: list[QuizChoice]


class QuizGenerateResponse(BaseModel):
    ok: bool = True
    message: str = ""
    questions: list[QuizQuestion] = Field(default_factory=list)
    answer_token: str = ""


class QuizAnswerIn(BaseModel):
    question_id: str
    choice_id: str


class QuizGradeIn(BaseModel):
    answer_token: str
    answers: list[QuizAnswerIn]


class QuizGradedQuestion(BaseModel):
    question_id: str
    word_id: int
    word: str
    prompt: str
    selected_choice_id: str = ""
    selected_text: str = ""
    correct_choice_id: str
    correct_text: str
    correct: bool
    explanation: str = ""


class QuizGradeResponse(BaseModel):
    ok: bool = True
    score: int = 0
    total: int = 0
    feedback: str = ""
    results: list[QuizGradedQuestion] = Field(default_factory=list)
