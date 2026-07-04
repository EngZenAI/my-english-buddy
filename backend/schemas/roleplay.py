from pydantic import BaseModel


class RoleplayStartIn(BaseModel):
    level: str = "intermediate"
    scenario: str = "general"
    tag: str | None = None
    situation: str = ""


class RoleplayContinueIn(BaseModel):
    history: list
    message: str
    level: str = "intermediate"
    scenario: str = "general"
    tag: str | None = None
    situation: str = ""
    wrap_up: bool = False


class RoleplaySummaryIn(BaseModel):
    history: list
    level: str = "intermediate"
    scenario: str = "general"
    tag: str | None = None
    situation: str = ""
    title: str = ""


class RoleplaySaveWordsIn(BaseModel):
    items: list
    tag: str | None = None


class RoleplayTtsIn(BaseModel):
    text: str
