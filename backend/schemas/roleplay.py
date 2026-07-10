from pydantic import BaseModel, Field


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


class RoleplayRealtimeSessionIn(BaseModel):
    level: str = "intermediate"
    scenario: str = "general"
    tag: str | None = None
    situation: str = ""
    title: str = ""


class RoleplayRealtimeCoachingIn(BaseModel):
    history: list
    user_message: str
    assistant_reply: str
    level: str = "intermediate"
    scenario: str = "general"
    tag: str | None = None
    situation: str = ""


class RoleplayRealtimeUsageIn(BaseModel):
    usage_group_id: str | None = Field(default=None, max_length=200)
    operation: str = "realtime"
    model: str = ""
    usage: dict = Field(default_factory=dict)
    success: bool = True
    error_message: str = ""
