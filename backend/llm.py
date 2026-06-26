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

watsonx_api_key    = os.getenv("WATSONX_API_KEY")
watsonx_project_id = os.getenv("WATSONX_PROJECT_ID")
watsonx_url        = os.getenv("WATSONX_URL")
WATSONX_CONFIGURED = all([watsonx_api_key, watsonx_project_id, watsonx_url])
WATSONX_INIT_ERRORS: dict[str, str] = {}

FEATURE_MODEL_PROFILES = {
    "default": {
        "provider": "watsonx",
        "model_id": "ibm/granite-4-h-small",
        "params": {"max_tokens": 500},
    },
    "quiz": {
        "provider": "watsonx",
        "model_id": "openai/gpt-oss-120b",
        "params": {"max_tokens": 4096},
    },
    "roleplay": {
        # 매 턴 1회 호출(지연 민감) + 자연스러운 영어 회화 품질이 핵심.
        # 120b는 과하고 granite-small보다 회화가 좋은 중형 instruct 모델을 사용.
        "provider": "watsonx",
        "model_id": "meta-llama/llama-3-3-70b-instruct",
        "params": {"max_tokens": 512, "temperature": 0.7, "top_p": 0.9},
    },
}
FALLBACK_MODEL_KEY = "qwen"
_llm_cache = {"qwen": qwen_llm, "exaone": exaone_llm}
_active_model_names: dict[str, str] = {}


def _profile_for(feature: str) -> dict:
    return FEATURE_MODEL_PROFILES.get(feature) or FEATURE_MODEL_PROFILES["default"]


def _create_watsonx_llm(feature: str, profile: dict):
    from langchain_ibm import ChatWatsonx

    return ChatWatsonx(
        model_id=profile["model_id"],
        url=watsonx_url,
        apikey=watsonx_api_key,
        project_id=watsonx_project_id,
        params=profile.get("params") or {},
    )


def get_llm(feature: str = "default"):
    """기능별 LLM 인스턴스를 반환한다.

    기능별 모델 프로필은 FEATURE_MODEL_PROFILES에 코드 상수로 정의한다.
    등록되지 않은 feature는 "default" 프로필을 사용한다. 생성된 모델 인스턴스는 feature 단위로 캐시해 같은 기능에서
    반복 호출해도 WatsonX 클라이언트를 새로 만들지 않는다.

    예:
        quiz_llm = get_llm("quiz")       # openai/gpt-oss-120b 우선 사용
        default_llm = get_llm()          # ibm/granite-4-h-small 우선 사용
    """
    profile = _profile_for(feature)
    cache_key = feature if feature in FEATURE_MODEL_PROFILES else "default"
    if cache_key in _llm_cache:
        return _llm_cache[cache_key]

    if profile.get("provider") == "watsonx" and WATSONX_CONFIGURED:
        try:
            model = _create_watsonx_llm(cache_key, profile)
            _llm_cache[cache_key] = model
            _active_model_names[cache_key] = f"watsonx:{profile['model_id']}"
            logger.info("[OK] WatsonX 연결됨 (%s)", cache_key)
            return model
        except Exception as e:
            WATSONX_INIT_ERRORS[cache_key] = str(e)
            logger.warning("[WARN] WatsonX 연결 실패 (%s): %s", cache_key, e)

    logger.warning("[WARN] %s 모델을 Ollama(qwen)로 대체", cache_key)
    _active_model_names[cache_key] = FALLBACK_MODEL_KEY
    return _llm_cache[FALLBACK_MODEL_KEY]


def get_active_model_name(feature: str = "default") -> str:
    cache_key = feature if feature in FEATURE_MODEL_PROFILES else "default"
    if cache_key not in _llm_cache:
        get_llm(cache_key)
    return _active_model_names.get(cache_key, FALLBACK_MODEL_KEY)


watson_llm = None
if WATSONX_CONFIGURED:
    try:
        watson_llm = get_llm("default")
    except Exception as e:
        logger.warning("[WARN] WatsonX 연결 실패: %s", e)
else:
    logger.warning("[WARN] WatsonX 환경변수 없음 -> Ollama(qwen)로 대체")

llms = {"qwen": qwen_llm, "exaone": exaone_llm}
if get_active_model_name("default").startswith("watsonx"):
    llms["watsonx"] = watson_llm

ACTIVE_MODEL = "watsonx" if get_active_model_name("default").startswith("watsonx") else "qwen"
llm = get_llm("default")
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

# ── 롤플레잉: 레벨·시나리오별 시스템 프롬프트 빌더 ──────────
# 레벨에 따라 AI의 어휘/속도/질문 난이도를 조절한다.
ROLEPLAY_LEVEL_GUIDES = {
    "beginner": (
        "The learner is a BEGINNER. Use simple, common vocabulary and short "
        "sentences. Speak slowly and clearly. Ask easy, concrete questions, "
        "one at a time."
    ),
    "intermediate": (
        "The learner is INTERMEDIATE. Use everyday vocabulary with some common "
        "idioms. Ask follow-up questions that require explanation and opinions."
    ),
    "advanced": (
        "The learner is ADVANCED. Use rich, natural, native-level vocabulary "
        "and idioms. Ask nuanced, open-ended questions and push the learner to "
        "elaborate and defend their views."
    ),
}


def _roleplay_level_guide(level: str) -> str:
    return ROLEPLAY_LEVEL_GUIDES.get(
        (level or "").lower(), ROLEPLAY_LEVEL_GUIDES["intermediate"]
    )


def _roleplay_scenario_intro(scenario: str, tag: str | None, words: list) -> str:
    word_list = ", ".join([w["word"] for w in words]) if words else ""
    scenario = (scenario or "daily").lower()

    if scenario == "opic":
        intro = (
            "This is an OPIc-style English speaking test. You are the OPIc "
            "interviewer named Ava. Run the session like a real OPIc exam: open "
            "with a friendly self-introduction prompt, then move through everyday "
            "topics and role-play tasks. Ask exactly one question per turn and, "
            "like an examiner scoring fluency, naturally probe for more detail, "
            "opinions, and reactions."
        )
    elif scenario == "tag":
        topic = tag or "일상"
        intro = (
            f"This is a themed role-play about '{topic}'. Play a natural "
            f"native-speaker counterpart who fits a realistic '{topic}' situation. "
            "Keep it immersive, like chatting with a native friend over a "
            "messenger app."
        )
    else:
        intro = (
            "This is a casual English conversation with a friendly native "
            "speaker, like texting a close friend."
        )

    if word_list:
        intro += (
            "\n\nWhen it fits naturally, weave in these review words from the "
            f"learner's wordbook: {word_list}."
        )
    return intro


def _roleplay_system_prompt(level, scenario, tag, words) -> str:
    return f"""You are an English conversation tutor and a friendly native speaker.

{_roleplay_scenario_intro(scenario, tag, words)}

{_roleplay_level_guide(level)}

Rules:
- Speak ONLY in English.
- Keep your turn fairly short and end with a question to keep the conversation going.
- If the learner makes a grammar or word-choice mistake, add a brief, gentle correction at the very end in parentheses. Example: (Correction: "I want" not "I wants")
"""


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

def start_roleplay(
    words: list | None = None,
    level: str = "intermediate",
    scenario: str = "daily",
    tag: str | None = None,
) -> list:
    """레벨·시나리오에 맞춰 롤플레잉 첫 메시지를 생성한다.

    words가 없어도 동작한다(OPIc/태그 시나리오는 복습단어가 없을 수 있음).
    반환 형식은 기존과 동일한 [("", response)] (api에서 객체로 변환).
    """
    words = words or []
    system = _roleplay_system_prompt(level, scenario, tag, words)
    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("human", "Start the role-play now: greet me and ask your first question."),
    ])
    chain = prompt | get_llm("roleplay") | parser
    response = chain.invoke({})
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

def continue_roleplay(
    history: list,
    user_msg: str,
    level: str = "intermediate",
    scenario: str = "daily",
    tag: str | None = None,
    words: list | None = None,
) -> list:
    if not user_msg.strip():
        return history
    words = words or []
    system = _roleplay_system_prompt(level, scenario, tag, words)
    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("placeholder", "{history}"),
        ("human", "{user_msg}"),
    ])
    chain = prompt | get_llm("roleplay") | parser
    lc_history = []
    for user, bot in history:
        if user: lc_history.append(("human",     user))
        if bot:  lc_history.append(("assistant", bot))
    response = chain.invoke({
        "history":  lc_history,
        "user_msg": user_msg
    })
    history.append((user_msg, response))
    return history
