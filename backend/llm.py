import logging
import os
from dotenv import load_dotenv
from pathlib import Path
from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langgraph.graph import StateGraph, END
from typing import TypedDict

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", encoding='utf-8-sig')
logger = logging.getLogger(__name__)

# ── 1. LLM 세팅 ───────────────────────────────────────────
qwen_llm   = ChatOllama(model="qwen2.5:7b")
exaone_llm = ChatOllama(model="exaone3.5:2.4b")

watson_llm = None
watsonx_api_key    = os.getenv("WATSONX_API_KEY")
watsonx_project_id = os.getenv("WATSONX_PROJECT_ID")
watsonx_url        = os.getenv("WATSONX_URL")

if all([watsonx_api_key, watsonx_project_id, watsonx_url]):
    try:
        from langchain_ibm import ChatWatsonx
        watson_llm = ChatWatsonx(
            model_id="ibm/granite-4-h-small",
            url=watsonx_url,
            apikey=watsonx_api_key,
            project_id=watsonx_project_id,
            params={"max_tokens": 500}
        )
        logger.info("[OK] WatsonX 연결됨")
    except Exception as e:
        logger.warning("[WARN] WatsonX 연결 실패: %s", e)
else:
    logger.warning("[WARN] WatsonX 환경변수 없음 -> Ollama(qwen)로 대체")

llms = {"qwen": qwen_llm, "exaone": exaone_llm}
if watson_llm:
    llms["watsonx"] = watson_llm

ACTIVE_MODEL = "watsonx" if watson_llm else "qwen"
llm = llms[ACTIVE_MODEL]
logger.info("[OK] 기본 모델: %s", ACTIVE_MODEL)

# ── 2. 파서 ───────────────────────────────────────────────
parser = StrOutputParser()

# ── 3. 체인 정의 ──────────────────────────────────────────
quiz_prompt = ChatPromptTemplate.from_template("""
당신은 영어 학습 튜터입니다.
아래 단어들로 영어 퀴즈를 만들어주세요.

형식:
- 빈칸 채우기 3문제 (예문에서 단어를 _____로 대체)
- 뜻 맞추기 2문제 (영어 뜻을 보고 단어 맞추기)
- 각 문제 아래에 [정답: ] 표시

단어 목록:
{word_list}
""")
quiz_chain = quiz_prompt | llm | parser

grade_prompt = ChatPromptTemplate.from_template("""
당신은 영어 학습 튜터입니다. 아래 퀴즈와 학습자 답변을 채점해주세요.

퀴즈:
{quiz_text}

학습자 답변:
{user_answer}

채점 기준:
- 각 문제별로 O/X 표시
- 틀렸다면 왜 틀렸는지 한국어로 친절하게 설명
- 마지막에 총점과 격려 메시지
""")
grade_chain = grade_prompt | llm | parser

roleplay_start_prompt = ChatPromptTemplate.from_template("""
당신은 영어 회화 튜터입니다.
아래 단어들이 자연스럽게 등장하는 롤플레잉을 시작해주세요.

상황: 카페에서 직원(AI)과 손님(사용자)의 대화
규칙:
- 영어로만 대화
- 아래 단어들을 대화 중 자연스럽게 사용
- 사용자가 틀린 영어를 쓰면 대화 끝에 살짝 교정해줄 것
- 첫 인사부터 시작

반드시 사용할 단어: {word_list}
""")
roleplay_start_chain = roleplay_start_prompt | llm | parser

chat_prompt = ChatPromptTemplate.from_messages([
    ("system", """당신은 영어 회화 튜터입니다.
카페 직원 역할로 손님(사용자)과 영어로 대화하세요.
사용자가 문법적으로 틀린 영어를 쓰면 대화 마지막에 괄호로 살짝 교정해주세요.
예: (Correction: "I want" not "I wants")"""),
    ("placeholder", "{history}"),
    ("human", "{user_msg}")
])
chat_chain = chat_prompt | llm | parser


# ── 4. LangGraph 상태 정의 ────────────────────────────────
class QuizState(TypedDict):
    words:       list
    quiz_text:   str
    user_answer: str
    feedback:    str

def generate_quiz_node(state: QuizState) -> QuizState:
    word_list = "\n".join([
        f"- {w['word']}: {w['korean']} / 예문: {w['example']}"
        for w in state["words"]
    ])
    state["quiz_text"] = quiz_chain.invoke({"word_list": word_list})
    return state

def grade_answer_node(state: QuizState) -> QuizState:
    state["feedback"] = grade_chain.invoke({
        "quiz_text":   state["quiz_text"],
        "user_answer": state["user_answer"]
    })
    return state

# 퀴즈 생성 워크플로우
quiz_workflow = StateGraph(QuizState)
quiz_workflow.add_node("generate", generate_quiz_node)
quiz_workflow.set_entry_point("generate")
quiz_workflow.add_edge("generate", END)
quiz_app = quiz_workflow.compile()

# 채점 워크플로우
grade_workflow = StateGraph(QuizState)
grade_workflow.add_node("grade", grade_answer_node)
grade_workflow.set_entry_point("grade")
grade_workflow.add_edge("grade", END)
grade_app = grade_workflow.compile()


# ── 5. 외부 호출 함수 ─────────────────────────────────────
def generate_quiz(words: list) -> str:
    if not words:
        return "📚 복습할 단어가 없어요! 단어를 먼저 저장해주세요."
    result = quiz_app.invoke({
        "words": words, "quiz_text": "",
        "user_answer": "", "feedback": ""
    })
    return result["quiz_text"]

def grade_quiz(words: list, quiz_text: str, user_answer: str) -> str:
    if not quiz_text:
        return "먼저 퀴즈를 생성해주세요!"
    if not user_answer.strip():
        return "답변을 입력해주세요!"
    result = grade_app.invoke({
        "words": words, "quiz_text": quiz_text,
        "user_answer": user_answer, "feedback": ""
    })
    return result["feedback"]

def start_roleplay(words: list) -> list:
    if not words:
        return [("", "📚 복습할 단어가 없어요! 단어를 먼저 저장해주세요.")]
    word_list = ", ".join([w["word"] for w in words])
    response  = roleplay_start_chain.invoke({"word_list": word_list})
    return [("", response)]

def explain_slang(word: str, kor_word: str = "") -> str:
    """슬랭/구어체 표현의 실제 의미와 원어민 활용법을 LLM으로 설명"""
    prompt = ChatPromptTemplate.from_template("""
You are an English language expert. A Korean learner searched "{word}"
and got the dictionary translation "{kor_word}", but suspects a more
colloquial or cultural meaning exists.

Explain how native speakers actually use "{word}" beyond its literal meaning
(slang, social context, pop culture, irony, etc.).
If no such usage exists, say so in one sentence.

Respond in Korean using this format:

🤖 속뜻과 맥락
[2~3문장]

📝 예문
1. 영어 예문 (한국어 해석)
2. 영어 예문 (한국어 해석)

🔗 비슷한 표현
[2~3개]
""")
    chain = prompt | llm | parser
    return chain.invoke({"word": word, "kor_word": kor_word})

def continue_roleplay(history: list, user_msg: str) -> list:
    if not user_msg.strip():
        return history
    lc_history = []
    for user, bot in history:
        if user: lc_history.append(("human",     user))
        if bot:  lc_history.append(("assistant", bot))
    response = chat_chain.invoke({
        "history":  lc_history,
        "user_msg": user_msg
    })
    history.append((user_msg, response))
    return history
