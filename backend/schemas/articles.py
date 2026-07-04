from pydantic import BaseModel, Field


class ArticleAskIn(BaseModel):
    question: str


class ArticleSaveWordsIn(BaseModel):
    items: list[dict] = Field(..., max_length=100)
    tag: str | None = "뉴스"
