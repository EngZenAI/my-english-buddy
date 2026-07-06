from langchain_core.prompts import ChatPromptTemplate

from backend.prompts.common import render_prompt

SLANG_EXPLANATION_PROMPT = ChatPromptTemplate.from_template("""
You are an English language expert. A Korean learner searched "{word}"
and got the dictionary translation "{kor_word}", but suspects a more
colloquial or cultural meaning exists.

Explain how native speakers actually use "{word}" beyond its literal meaning
(slang, social context, pop culture, irony, etc.).
If no such usage exists, say so in one sentence.

Respond in Korean using this format:

👀 속뜻과 맥락
[2~3문장]

📝 예문
1. 영어 예문 (한국어 해석)
2. 영어 예문 (한국어 해석)

🔗 비슷한 표현
[2~3개]
""")


def build_slang_explanation_prompt(word: str, kor_word: str = ""):
    return render_prompt(SLANG_EXPLANATION_PROMPT, {"word": word, "kor_word": kor_word})
