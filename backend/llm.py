"""LLM 계층 — 앱의 모든 AI 기능을 담당한다 (LangChain / LangGraph).

이 파일이 책임지는 것:
  1) 모델 선택 & 폴백 : 기능별로 어떤 모델을 쓸지 고르고(get_llm), WatsonX가
     안 되면 로컬 Ollama로 자동 대체한다.
  2) 퀴즈            : 단어로 퀴즈 생성 / 학습자 답안 채점.
  3) 슬랭 설명       : 사전 뜻 너머의 구어체·문화적 의미 설명.
  4) 롤플레잉        : 레벨·시나리오에 맞춘 영어 회화 대화.

호출 관계: backend/routers/api.py 가 여기 함수들(generate_quiz, grade_quiz,
explain_slang, start_roleplay, continue_roleplay)을 호출한다.

모델 운영 메모(중요):
  - 우선순위는 WatsonX → (실패 시) Ollama(qwen). WatsonX 키 만료/미설정이어도
    서버는 죽지 않고 로그 경고만 남긴 뒤 qwen으로 동작한다.
  - 단, qwen 폴백을 쓰려면 로컬에 `ollama serve` + 모델(qwen2.5:7b)이 떠 있어야 한다.
  - 검색·단어장·가져오기는 LLM 없이도 동작한다(이 파일과 무관).
"""

import json
import logging
import os
import re
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, TypedDict

from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama
from langgraph.graph import END, StateGraph

from backend.api_usage import track_llm_usage

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", encoding="utf-8-sig")
logger = logging.getLogger(__name__)


class LLMConcurrencyLimitError(RuntimeError):
    """Raised when the app-level LLM concurrency guard is saturated."""


ROLEPLAY_LLM_MAX_CONCURRENT = max(
    1,
    int(os.getenv("ROLEPLAY_LLM_MAX_CONCURRENT", "8") or "8"),
)
_feature_semaphores = {
    "roleplay": threading.BoundedSemaphore(ROLEPLAY_LLM_MAX_CONCURRENT),
}


# ══════════════════════════════════════════════════════════════════════
# 1. 모델 프로필 & 팩토리
# ══════════════════════════════════════════════════════════════════════
# 로컬 Ollama 모델(폴백용). WatsonX가 안 될 때 이걸로 대체한다.
qwen_llm   = ChatOllama(model="qwen2.5:7b")     # 기본 폴백 모델
exaone_llm = ChatOllama(model="exaone3.5:2.4b")  # 예비(현재 직접 사용처 없음)

# WatsonX 자격증명(.env). 셋 다 있어야 WatsonX를 시도한다.
watsonx_api_key    = os.getenv("WATSONX_API_KEY")
watsonx_project_id = os.getenv("WATSONX_PROJECT_ID")
watsonx_url        = os.getenv("WATSONX_URL")
WATSONX_CONFIGURED = all([watsonx_api_key, watsonx_project_id, watsonx_url])
WATSONX_INIT_ERRORS: dict[str, str] = {}  # feature별 WatsonX 초기화 실패 사유 기록

# ── 기능별 모델 프로필 ────────────────────────────────────────────────
# 기능(feature)마다 독립적으로 모델/파라미터를 지정한다. 새 기능을 추가하려면
# 여기 항목만 추가하고 get_llm("그_feature")로 받아 쓰면 된다.
# (등록 안 된 feature는 자동으로 "default" 프로필을 사용)
FEATURE_MODEL_PROFILES = {
    # 슬랭 설명 등 일반 용도. 짧고 빠른 경량 모델.
    "default": {
        "provider": "watsonx",
        "model_id": "ibm/granite-4-h-small",
        "params": {"max_tokens": 512},
    },
    # 퀴즈 생성·채점. 정확도 위주라 큰 모델 + 넉넉한 토큰.
    "quiz": {
        "provider": "watsonx",
        "model_id": "openai/gpt-oss-120b",
        "params": {"max_tokens": 4096},
    },
    # 롤플레잉(회화). 매 턴 1회 호출이라 지연에 민감하고, 자연스러운 영어 회화
    # 품질이 핵심 → 120b는 과하고 granite-small보다 회화가 좋은 중형 instruct 모델.
    # temperature 0.7로 답변에 자연스러운 변주를 준다. 한 턴 답변은 짧아 512면 충분.
    "roleplay": {
        "provider": "watsonx",
        "model_id": "meta-llama/llama-3-3-70b-instruct",
        "params": {"max_tokens": 512, "temperature": 0.7, "top_p": 0.9},
    },
    # 기사 학습. 문단별 해설/요약/근거 기반 Q&A는 구조화 출력이 중요하고
    # 입력이 길 수 있어 quiz와 같은 큰 모델을 쓰되 토큰은 중간값으로 제한한다.
    "article": {
        "provider": "watsonx",
        "model_id": "openai/gpt-oss-120b",
        "params": {"max_tokens": 3072, "temperature": 0.2},
    },
}

FALLBACK_MODEL_KEY = "qwen"                       # WatsonX 실패 시 쓸 모델 키
_llm_cache = {"qwen": qwen_llm, "exaone": exaone_llm}  # feature/모델키 → LLM 인스턴스
_active_model_names: dict[str, str] = {}          # feature → 실제 선택된 모델 이름


def _profile_for(feature: str) -> dict:
    """feature에 해당하는 프로필을 반환(없으면 default)."""
    return FEATURE_MODEL_PROFILES.get(feature) or FEATURE_MODEL_PROFILES["default"]


def _create_watsonx_llm(feature: str, profile: dict):
    """프로필대로 ChatWatsonx 인스턴스를 만든다.

    langchain_ibm은 import 비용이 있어 WatsonX를 실제로 쓸 때만 지연 import 한다.
    """
    from langchain_ibm import ChatWatsonx

    return ChatWatsonx(
        model_id=profile["model_id"],
        url=watsonx_url,
        apikey=watsonx_api_key,
        project_id=watsonx_project_id,
        params=profile.get("params") or {},
    )


def get_llm(feature: str = "default"):
    """기능별 LLM 인스턴스를 반환한다(생성 결과는 feature 단위로 캐시).

    동작:
      1) 이미 만들어둔 게 있으면 캐시에서 즉시 반환.
      2) 프로필이 WatsonX이고 자격증명이 있으면 WatsonX 생성 시도.
      3) WatsonX가 실패하거나 미설정이면 Ollama(qwen)로 폴백.

    덕분에 같은 기능에서 반복 호출해도 WatsonX 클라이언트를 새로 만들지 않는다.

    예:
        quiz_llm     = get_llm("quiz")      # openai/gpt-oss-120b 우선
        roleplay_llm = get_llm("roleplay")  # llama-3-3-70b-instruct 우선
        default_llm  = get_llm()            # ibm/granite-4-h-small 우선
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
            # 모델 미프로비저닝·키 만료 등 → 폴백으로 넘어간다(서버는 계속 동작).
            WATSONX_INIT_ERRORS[cache_key] = str(e)
            logger.warning("[WARN] WatsonX 연결 실패 (%s): %s", cache_key, e)

    logger.warning("[WARN] %s 모델을 Ollama(qwen)로 대체", cache_key)
    _active_model_names[cache_key] = FALLBACK_MODEL_KEY
    return _llm_cache[FALLBACK_MODEL_KEY]


def get_active_model_name(feature: str = "default") -> str:
    """해당 feature가 실제로 어떤 모델로 동작 중인지 이름을 반환.

    (예: "watsonx:ibm/granite-4-h-small" 또는 "qwen") 아직 초기화 안 됐으면
    get_llm을 먼저 호출해 결정한다.
    """
    cache_key = feature if feature in FEATURE_MODEL_PROFILES else "default"
    if cache_key not in _llm_cache:
        get_llm(cache_key)
    return _active_model_names.get(cache_key, FALLBACK_MODEL_KEY)


# ── 서버 시작 시 기본 모델 워밍업 & 상태 로깅 ─────────────────────────
watson_llm = None
if WATSONX_CONFIGURED:
    try:
        watson_llm = get_llm("default")
    except Exception as e:
        logger.warning("[WARN] WatsonX 연결 실패: %s", e)
else:
    logger.warning("[WARN] WatsonX 환경변수 없음 -> Ollama(qwen)로 대체")

# 하위 호환용 전역들. quiz/slang 체인이 모듈 로드 시점에 묶는 기본 LLM(`llm`)을 쓴다.
llms = {"qwen": qwen_llm, "exaone": exaone_llm}
if get_active_model_name("default").startswith("watsonx"):
    llms["watsonx"] = watson_llm

ACTIVE_MODEL = "watsonx" if get_active_model_name("default").startswith("watsonx") else "qwen"
llm = get_llm("default")  # 퀴즈/슬랭 체인이 사용하는 기본 LLM
logger.info("[OK] 기본 모델: %s", ACTIVE_MODEL)


# ══════════════════════════════════════════════════════════════════════
# 2. 공통 파서
# ══════════════════════════════════════════════════════════════════════
# LLM 응답(AIMessage)에서 본문 문자열만 뽑아낸다. 모든 체인 끝에 붙인다.
parser = StrOutputParser()


@contextmanager
def _llm_concurrency_slot(feature: str):
    """Limit expensive provider calls before they reach the upstream model."""
    semaphore = _feature_semaphores.get(feature)
    if not semaphore:
        yield
        return

    acquired = semaphore.acquire(blocking=False)
    if not acquired:
        raise LLMConcurrencyLimitError(
            f"{feature} LLM 요청이 많아 잠시 대기 중입니다. 방금 전 요청이 끝난 뒤 다시 시도해주세요."
        )
    try:
        yield
    finally:
        semaphore.release()


def _invoke_tracked_llm(feature: str, operation: str, prompt_value) -> str:
    model_name = get_active_model_name(feature)
    try:
        with _llm_concurrency_slot(feature):
            response = get_llm(feature).invoke(prompt_value)
    except Exception:
        track_llm_usage(
            feature=feature,
            operation=operation,
            model_name=model_name,
            input_value=prompt_value,
            success=False,
        )
        raise
    text = parser.invoke(response)
    track_llm_usage(
        feature=feature,
        operation=operation,
        model_name=model_name,
        input_value=prompt_value,
        response=response,
        output_value=text,
    )
    return text


def _chunk_to_text(chunk) -> str:
    """LangChain stream chunk에서 표시 가능한 텍스트만 추출한다."""
    content = getattr(chunk, "content", chunk)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
        return "".join(parts)
    return str(content or "")


class _StreamUsageResponse:
    def __init__(self, content: str, chunks: list):
        self.content = content
        self.usage_metadata = None
        self.response_metadata = {"chunks": chunks}
        for chunk in reversed(chunks):
            usage = getattr(chunk, "usage_metadata", None)
            if usage:
                self.usage_metadata = usage
                break
            metadata = getattr(chunk, "response_metadata", None)
            if metadata:
                self.response_metadata = {
                    **metadata,
                    "chunks": chunks,
                } if isinstance(metadata, dict) else {"metadata": metadata, "chunks": chunks}
                break


def _stream_tracked_llm(feature: str, operation: str, prompt_value) -> Iterator[str]:
    """LLM 토큰 스트림을 내보내고, 완료 후 사용량 이벤트를 기록한다."""
    model_name = get_active_model_name(feature)
    chunks: list[str] = []
    response_chunks: list = []
    try:
        with _llm_concurrency_slot(feature):
            for chunk in get_llm(feature).stream(prompt_value):
                response_chunks.append(chunk)
                text = _chunk_to_text(chunk)
                if not text:
                    continue
                chunks.append(text)
                yield text
    except Exception:
        output = "".join(chunks)
        track_llm_usage(
            feature=feature,
            operation=operation,
            model_name=model_name,
            input_value=prompt_value,
            response=_StreamUsageResponse(output, response_chunks),
            output_value=output,
            success=False,
        )
        raise
    output = "".join(chunks)
    track_llm_usage(
        feature=feature,
        operation=operation,
        model_name=model_name,
        input_value=prompt_value,
        response=_StreamUsageResponse(output, response_chunks),
        output_value=output,
    )


# ══════════════════════════════════════════════════════════════════════
# 3. 퀴즈 — 생성 & 채점
# ══════════════════════════════════════════════════════════════════════
# 참고: 퀴즈 탭은 팀원이 별도 브랜치에서 발전시키는 중. 여기 체인은 레거시 경로다.
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


# ── LangGraph 워크플로우 ──────────────────────────────────────────────
# 지금은 단일 노드라 체인을 직접 호출해도 되지만, 추후 "생성→검수→재생성"처럼
# 다단계로 확장할 여지를 두려고 그래프로 감싸 두었다.
class QuizState(TypedDict):
    words:       list   # 퀴즈 대상 단어들
    quiz_text:   str    # 생성된 퀴즈 본문
    user_answer: str    # 학습자 답안
    feedback:    str    # 채점 결과


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
        "user_answer": state["user_answer"],
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


def generate_quiz(words: list) -> str:
    """단어 목록으로 퀴즈 본문을 생성한다."""
    if not words:
        return "📚 복습할 단어가 없어요! 단어를 먼저 저장해주세요."
    result = quiz_app.invoke({
        "words": words, "quiz_text": "",
        "user_answer": "", "feedback": "",
    })
    return result["quiz_text"]


def grade_quiz(words: list, quiz_text: str, user_answer: str) -> str:
    """학습자 답안을 채점해 피드백을 반환한다."""
    if not quiz_text:
        return "먼저 퀴즈를 생성해주세요!"
    if not user_answer.strip():
        return "답변을 입력해주세요!"
    result = grade_app.invoke({
        "words": words, "quiz_text": quiz_text,
        "user_answer": user_answer, "feedback": "",
    })
    return result["feedback"]


# ══════════════════════════════════════════════════════════════════════
# 4. 슬랭 설명 ("AI에게 물어보기")
# ══════════════════════════════════════════════════════════════════════
def explain_slang(word: str, kor_word: str = "") -> str:
    """사전 뜻 너머의 구어체·문화적 의미를 LLM으로 설명한다.

    사용자가 검색한 단어(word)와 사전 번역(kor_word)을 주면, 원어민이 실제로
    어떻게 쓰는지(슬랭·뉘앙스·밈 등)를 한국어 고정 포맷으로 답한다.
    """
    prompt = ChatPromptTemplate.from_template("""
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
    prompt_value = prompt.invoke({"word": word, "kor_word": kor_word})
    return _invoke_tracked_llm("slang", "explain", prompt_value)


# ══════════════════════════════════════════════════════════════════════
# 5. 롤플레잉 — 실전 영어 회화 연습
# ══════════════════════════════════════════════════════════════════════
# 목적: 단어 "복습"이 아니라, 원어민과의 실전 회화 연습이다. AI가 상황 속
#       상대역을 맡아 사용자가 영어로 말하게 만들고, 배운 표현을 실제로 써보게 한다.
#
# 세 가지 모드(scenario):
#   - "opic"   : OPIc 설문형 상황극. situation으로 구체적 과제를 받는다
#                (예: "환자가 되어 병원에 전화해 예약을 미뤄라" → AI는 접수원 역).
#   - "tag"    : 사용자 단어장 태그(예: car_konglish, 여행)를 주제로 한 대화.
#                그 태그의 단어들(words)을 "써볼 기회를 만들어주는" 용도로 쓴다
#                (암기 점검이 아니라 활용 연습). 대화 후 유용 표현 정리로 이어질 예정.
#   - "general": 사용자가 고른 자유 주제 상황극. situation으로 상황을 받는다
#                (예: "럭비 경기장 매점 알바" → AI는 손님 역).
#
# 매개변수 메모:
#   - situation: 클릭한 예시 카드/자유 입력에서 온 "구체적 상황" 문자열. 시스템
#                프롬프트에 그대로 주입된다. 비어 있으면 모드 기본 상황으로 시작.
#   - words: tag 모드에서만 채워진다(해당 태그의 단어 = 활용 대상 어휘). opic/general은 비움.
#   - history 포맷: [(user, bot), ...] 튜플. 첫 메시지는 사용자 발화가 없어
#                ("", 봇첫인사) 형태. (프론트는 객체 메시지로 변환해 렌더)
#
# 레벨(beginner/intermediate/advanced)에 따라 AI의 어휘·속도·질문 난이도를 조절한다.
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
    """레벨 키에 맞는 지침 문장을 반환(미상이면 intermediate)."""
    return ROLEPLAY_LEVEL_GUIDES.get(
        (level or "").lower(), ROLEPLAY_LEVEL_GUIDES["intermediate"]
    )


def _roleplay_scenario_intro(
    scenario: str, tag: str | None, situation: str, words: list
) -> str:
    """모드별 상황 설명 문장을 만든다(situation/태그 어휘 반영).

    scenario:
      - "opic"   : OPIc 설문형 상황극. AI가 상대역을 맡아 사용자를 말하게 한다.
      - "tag"    : 단어장 태그 주제 대화. 태그 단어를 써볼 기회를 만들어준다.
      - "general": 자유 주제 상황극. situation으로 상황을 받는다.
    """
    word_list = ", ".join([w["word"] for w in words]) if words else ""
    scenario = (scenario or "general").lower()
    situation = (situation or "").strip()

    if scenario == "opic":
        intro = (
            "This is OPIc-style speaking practice. Play the other person in a "
            "realistic role-play and keep the learner talking, like an OPIc "
            "examiner drawing out detail, opinions, and reactions. Stay in "
            "character and ask one thing at a time."
        )
        if situation:
            intro += f"\n\nRole-play setup: {situation}"
    elif scenario == "tag":
        topic = tag or "general topics"
        intro = (
            f"Have a natural, immersive English conversation about '{topic}', "
            "like chatting with a native friend. Ask questions and react "
            "naturally to keep the learner speaking."
        )
        if word_list:
            intro += (
                "\n\nThe learner has been studying these expressions and wants "
                "to actually use them, so create natural openings for them: "
                f"{word_list}. Don't force them all or turn it into a vocabulary drill."
            )
    else:  # general / 자유 주제
        intro = (
            "This is free-topic role-play for real conversation practice. Play "
            "the appropriate counterpart for the situation and stay in character."
        )
        if situation:
            intro += f"\n\nSituation: {situation}"
        else:
            intro += "\n\nPick a friendly everyday situation and start the conversation."
    return intro


# 대화 중 코칭(2단계): 답변과 별도로 학습자 발화에 대한 짧은 코칭을 JSON으로 받는다.
_ROLEPLAY_COACHING_INSTRUCTION = """
COACHING (very important):
Besides staying in character, give brief coaching on the learner's MOST RECENT message,
written for a Korean learner. Reply with ONLY a JSON object — no markdown, no code fences —
in exactly this shape:
{{"reply": "<your in-character English reply>", "coaching": "<coaching in Korean>"}}
- "reply": your in-character reply. Do NOT put any correction inside it.
- "coaching": 1-2 short Korean tips — suggest a more natural/native expression, or fix a
  grammar/word-choice mistake from the learner's last message. Keep it short so it doesn't
  break immersion. If their English was already natural and correct, use an empty string "".
"""


def _roleplay_system_prompt(
    level, scenario, tag, situation, words, coaching=False, wrap_up=False
) -> str:
    """롤플레잉 시스템 프롬프트(상황 + 레벨 + 공통 규칙)를 조립한다.

    coaching=True(대화 진행 턴)면 코칭 JSON 출력 지시를 덧붙인다.
    coaching=False(첫 메시지)면 평문 답변만 생성한다.
    wrap_up=True면 대화가 충분히 길어졌으니 자연스럽게 마무리하도록 유도한다.
    """
    base = f"""You are a friendly native English speaker helping the learner practice real conversation.

{_roleplay_scenario_intro(scenario, tag, situation, words)}

{_roleplay_level_guide(level)}

Rules:
- Speak ONLY in English (the in-character reply must be English).
- Keep your turn fairly short and end with a question to keep the conversation going.
- Stay in character for the situation.
"""
    if wrap_up:
        base += (
            "\nWRAP UP: The conversation has gone on long enough. Respond to the learner, "
            "then gently bring the role-play to a natural close (warmly signal it's a good "
            "place to stop) instead of opening big new topics. Do NOT ask a new question.\n"
        )
    if coaching:
        base += _ROLEPLAY_COACHING_INSTRUCTION
    return base


def _parse_coached(raw: str) -> dict:
    """LLM 응답에서 {reply, coaching}를 견고하게 파싱한다.

    JSON이 깨지거나 코드펜스로 감싸진 경우까지 방어한다. 끝내 못 읽으면
    전체를 reply로 쓰고 coaching은 비운다(대화는 끊기지 않게).
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()

    candidates = [text]
    m = re.search(r"\{.*\}", text, re.S)  # 본문 중 첫 JSON 블록
    if m:
        candidates.append(m.group(0))

    for c in candidates:
        try:
            obj = json.loads(c)
        except Exception:
            continue
        if isinstance(obj, dict) and "reply" in obj:
            reply = str(obj.get("reply") or "").strip()
            coaching = str(obj.get("coaching") or "").strip()
            if reply:
                return {"reply": reply, "coaching": coaching}

    return {"reply": text, "coaching": ""}


def start_roleplay(
    level: str = "intermediate",
    scenario: str = "general",
    tag: str | None = None,
    situation: str = "",
    words: list | None = None,
) -> str:
    """롤플레잉 첫 메시지(AI의 인사/상황 도입 + 첫 질문)를 생성한다.

    Args:
        level: beginner | intermediate | advanced.
        scenario: general | opic | tag.
        tag: scenario == "tag" 일 때의 주제 태그.
        situation: 예시 카드/자유 입력에서 온 구체적 상황(없어도 됨).
        words: tag 모드의 활용 대상 어휘(없어도 됨).

    Returns:
        봇 첫 메시지 문자열. (첫 턴은 학습자 발화가 없어 코칭 없음.)
    """
    words = words or []
    system = _roleplay_system_prompt(level, scenario, tag, situation, words)
    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("human", "Start the role-play now: set the scene briefly, then greet me and ask your first question."),
    ])
    prompt_value = prompt.invoke({})
    return _invoke_tracked_llm("roleplay", "start", prompt_value)


def continue_roleplay(
    history: list,
    user_msg: str,
    level: str = "intermediate",
    scenario: str = "general",
    tag: str | None = None,
    situation: str = "",
    words: list | None = None,
    wrap_up: bool = False,
) -> dict:
    """사용자 발화에 대한 AI 응답 + 코칭을 생성한다(history는 변경하지 않음).

    세션 설정(level/scenario/tag/situation/words)을 매 턴 다시 받아 시스템
    프롬프트를 일관되게 유지한다(엔드포인트가 stateless이기 때문). history 합성은
    api.py가 담당한다.

    Args:
        history: 지금까지의 [(user, bot), ...]. 빈 user는 AI 첫 인사를 뜻한다.
                 (코칭은 LLM 맥락에 불필요하므로 user/bot만 넘긴다.)
        user_msg: 이번 턴 사용자 입력. 비어 있으면 빈 결과 반환.

    Returns:
        {"reply": <AI 답변>, "coaching": <한국어 코칭 또는 "">}
    """
    if not user_msg.strip():
        return {"reply": "", "coaching": ""}

    words = words or []
    system = _roleplay_system_prompt(
        level, scenario, tag, situation, words, coaching=True, wrap_up=wrap_up
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("placeholder", "{history}"),  # 이전 대화가 여기로 펼쳐진다
        ("human", "{user_msg}"),
    ])
    # 튜플 history → LangChain 메시지(role, content) 리스트로 변환.
    lc_history = []
    for user, bot in history:
        if user:
            lc_history.append(("human", user))
        if bot:
            lc_history.append(("assistant", bot))

    prompt_value = prompt.invoke({"history": lc_history, "user_msg": user_msg})
    raw = _invoke_tracked_llm("roleplay", "continue", prompt_value)
    return _parse_coached(raw)


def _roleplay_continue_prompt_value(
    history: list,
    user_msg: str,
    level: str = "intermediate",
    scenario: str = "general",
    tag: str | None = None,
    situation: str = "",
    words: list | None = None,
    wrap_up: bool = False,
):
    """롤플레잉 진행 턴의 순수 답변용 prompt value를 만든다."""
    words = words or []
    system = _roleplay_system_prompt(
        level, scenario, tag, situation, words, coaching=False, wrap_up=wrap_up
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("placeholder", "{history}"),
        ("human", "{user_msg}"),
    ])
    lc_history = []
    for user, bot in history:
        if user:
            lc_history.append(("human", user))
        if bot:
            lc_history.append(("assistant", bot))
    return prompt.invoke({"history": lc_history, "user_msg": user_msg})


def stream_roleplay_reply(
    history: list,
    user_msg: str,
    level: str = "intermediate",
    scenario: str = "general",
    tag: str | None = None,
    situation: str = "",
    words: list | None = None,
    wrap_up: bool = False,
) -> Iterator[str]:
    """사용자 발화에 대한 AI 답변을 토큰 단위로 스트리밍한다."""
    if not user_msg.strip():
        return
    prompt_value = _roleplay_continue_prompt_value(
        history,
        user_msg,
        level=level,
        scenario=scenario,
        tag=tag,
        situation=situation,
        words=words,
        wrap_up=wrap_up,
    )
    yield from _stream_tracked_llm("roleplay", "continue_stream", prompt_value)


def coach_roleplay_turn(
    history: list,
    user_msg: str,
    ai_reply: str,
    level: str = "intermediate",
    scenario: str = "general",
    tag: str | None = None,
    situation: str = "",
) -> str:
    """스트리밍 답변 완료 후, 최근 사용자 발화에 대한 짧은 한국어 코칭을 생성한다."""
    if not user_msg.strip():
        return ""

    lines = []
    for user, bot in history[-4:]:
        if user:
            lines.append(f"Learner: {user}")
        if bot:
            lines.append(f"AI: {bot}")
    recent_context = "\n".join(lines).strip()

    prompt = ChatPromptTemplate.from_template("""You are an English speaking coach for a Korean learner.

Recent context:
{recent_context}

Current learner message:
{user_msg}

AI's in-character reply:
{ai_reply}

Level: {level}
Scenario: {scenario}
Tag: {tag}
Situation: {situation}

Write ONLY a brief Korean coaching tip for the learner's current message.
Rules:
- 1-2 short Korean sentences.
- Suggest a more natural/native expression, or fix grammar/word choice.
- If the learner's English was already natural and correct, return an empty string.
- Do not include markdown, labels, or bullet points.
""")
    prompt_value = prompt.invoke({
        "recent_context": recent_context,
        "user_msg": user_msg,
        "ai_reply": ai_reply,
        "level": level,
        "scenario": scenario,
        "tag": tag or "",
        "situation": situation or "",
    })
    return _invoke_tracked_llm("roleplay", "coaching", prompt_value).strip()


# ── 대화 종료 후 정리(3단계): 요약 + 유용 표현 + 유용 어휘 추출 ──────────
_ROLEPLAY_SUMMARY_TEMPLATE = """You are an English tutor reviewing a role-play conversation with a Korean learner.

Conversation:
{transcript}

Write a short, encouraging review FOR THE LEARNER and extract only high-value study items.
Respond with ONLY a JSON object,
no markdown and no code fences, in exactly this shape:
{{"summary": "<2-3 sentences in Korean: how the conversation went + one encouragement>", "expressions": [{{"en": "<a useful, natural English expression from or for this conversation>", "ko": "<Korean meaning>"}}], "vocab": [{{"word": "<useful English word or short phrase>", "korean": "<Korean meaning>", "example": "<a short English example sentence>"}}]}}

Rules:
- Choose items that improve the learner's next similar role-play, not random words that merely appeared.
- "expressions" must be reusable conversational chunks, sentence frames, or natural phrases for the exact situation.
  Prefer practical items like "Could you recommend...?", "I'd like to...", "That sounds...", "I'm looking for...".
- Do NOT include weak filler or overly generic items such as "so on", "good luck", "that's cool", "thanks", "you're welcome",
  unless you upgrade them into a more useful natural expression.
- "vocab" must be role-play-relevant words or short phrases that are worth saving to a wordbook.
  Prefer situational phrases and useful collocations over isolated easy nouns.
- For each vocab item, the "example" must be related to this role-play situation, not a generic dictionary example.
- 3-5 items in "expressions" and 3-5 items in "vocab". It is better to return fewer strong items than many weak ones.
- "summary", "ko", and "korean" must be Korean. "en", "word", "example" must be English.
- If the conversation is too short to extract from, still return valid JSON with what you can.
"""


def _parse_summary(raw: str) -> dict:
    """요약 LLM 응답에서 {summary, expressions, vocab}를 견고하게 파싱한다."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()

    candidates = [text]
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        candidates.append(m.group(0))

    data = {}
    for c in candidates:
        try:
            parsed = json.loads(c)
        except Exception:
            continue
        if isinstance(parsed, dict):
            data = parsed
            break

    def _clean_list(items, keys):
        out = []
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict):
                    row = {k: str(it.get(k, "") or "").strip() for k in keys}
                    if any(row.values()):
                        out.append(row)
        return out

    return {
        "summary": str(data.get("summary", "") or "").strip(),
        "expressions": _clean_list(data.get("expressions"), ["en", "ko"]),
        "vocab": _clean_list(data.get("vocab"), ["word", "korean", "example"]),
    }


def summarize_roleplay(
    history: list,
    level: str = "intermediate",
    scenario: str = "general",
    tag: str | None = None,
    situation: str = "",
) -> dict:
    """대화 전체에서 요약 + 유용 표현 + 유용 어휘를 1회 LLM 호출로 추출한다.

    Returns:
        {"summary": str, "expressions": [{"en","ko"}], "vocab": [{"word","korean","example"}]}
    """
    lines = []
    for user, bot in history:
        if user:
            lines.append(f"Learner: {user}")
        if bot:
            lines.append(f"AI: {bot}")
    transcript = "\n".join(lines).strip()
    if not transcript:
        return {"summary": "", "expressions": [], "vocab": []}

    prompt = ChatPromptTemplate.from_template(_ROLEPLAY_SUMMARY_TEMPLATE)
    prompt_value = prompt.invoke({"transcript": transcript})
    raw = _invoke_tracked_llm("roleplay", "summary", prompt_value)
    return _parse_summary(raw)
