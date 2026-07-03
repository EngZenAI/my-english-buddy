from typing import Any

from pydantic import BaseModel, Field


class AgentAction(BaseModel):
    id: str = ""
    type: str
    label: str
    payload: dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = True
    destructive: bool = False


class AgentCard(BaseModel):
    title: str
    body: str = ""
    kind: str = "info"
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentChatIn(BaseModel):
    message: str
    current_tab: str = "search"
    recent_messages: list[dict[str, Any]] = Field(default_factory=list)


class AgentActionConfirmIn(BaseModel):
    action: AgentAction


class AgentResponse(BaseModel):
    message: str
    cards: list[AgentCard] = Field(default_factory=list)
    actions: list[AgentAction] = Field(default_factory=list)
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    job_id: str | None = None


class AgentSuggestionResponse(BaseModel):
    message: str
    cards: list[AgentCard] = Field(default_factory=list)
    actions: list[AgentAction] = Field(default_factory=list)
