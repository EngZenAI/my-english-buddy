from pydantic import BaseModel, Field


class ArticleFeedRefreshIn(BaseModel):
    source_key: str = ""
    publish: bool = True
    max_items: int = Field(default=1, ge=1, le=3)


class ArticleCreateIn(BaseModel):
    source: str = ""
    title: str
    url: str
    image_url: str = ""
    topic: str = "General"
    level: str = "B1"
    description: str = ""
    content: str
    is_published: bool = False


class ArticleUpdateIn(ArticleCreateIn):
    pass


class ArticlePublishIn(BaseModel):
    is_published: bool = True
