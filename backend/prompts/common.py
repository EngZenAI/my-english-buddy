from typing import Any

from langchain_core.prompts import ChatPromptTemplate


def render_prompt(template: ChatPromptTemplate, variables: dict[str, Any] | None = None):
    """Render a ChatPromptTemplate with a standard empty-dict default."""
    return template.invoke(variables or {})


def render_text_prompt(template: ChatPromptTemplate, variables: dict[str, Any] | None = None) -> str:
    """Render a ChatPromptTemplate and flatten its messages into text."""
    prompt_value = render_prompt(template, variables)
    messages = prompt_value.to_messages()
    return "\n\n".join(str(message.content or "") for message in messages).strip()


def render_messages(messages: list[Any], variables: dict[str, Any] | None = None):
    """Build and render a message-based ChatPromptTemplate."""
    return ChatPromptTemplate.from_messages(messages).invoke(variables or {})


def roleplay_history_messages(history: list) -> list[tuple[str, str]]:
    """Convert roleplay (user, bot) tuples into LangChain message tuples."""
    lc_history = []
    for item in history:
        if not item:
            continue
        user = item[0] if len(item) > 0 else ""
        bot = item[1] if len(item) > 1 else ""
        if user:
            lc_history.append(("human", user))
        if bot:
            lc_history.append(("assistant", bot))
    return lc_history
