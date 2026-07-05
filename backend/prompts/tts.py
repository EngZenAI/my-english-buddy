from langchain_core.prompts import ChatPromptTemplate

from backend.prompts.common import render_text_prompt

ROLEPLAY_TTS_PROMPT = ChatPromptTemplate.from_template(
    """Read this role-play line aloud in natural, friendly American English. Do not add extra words or sound effects.

{text}
"""
)


def build_roleplay_tts_prompt(text: str) -> str:
    return render_text_prompt(ROLEPLAY_TTS_PROMPT, {"text": text})
