from langchain_core.prompts import ChatPromptTemplate

from backend.prompts.common import render_messages, render_prompt, roleplay_history_messages

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


def roleplay_level_guide(level: str) -> str:
    """Return the instruction text for a roleplay difficulty level."""
    return ROLEPLAY_LEVEL_GUIDES.get(
        (level or "").lower(), ROLEPLAY_LEVEL_GUIDES["intermediate"]
    )


def roleplay_scenario_intro(
    scenario: str, tag: str | None, situation: str, words: list
) -> str:
    """Build the roleplay scenario instruction from mode-specific inputs."""
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
    else:
        intro = (
            "This is free-topic role-play for real conversation practice. Play "
            "the appropriate counterpart for the situation and stay in character."
        )
        if situation:
            intro += f"\n\nSituation: {situation}"
        else:
            intro += "\n\nPick a friendly everyday situation and start the conversation."
    return intro


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


def roleplay_system_prompt(
    level,
    scenario,
    tag,
    situation,
    words,
    coaching=False,
    wrap_up=False,
) -> str:
    """Build the system prompt for roleplay start/continue calls."""
    base = f"""You are a friendly native English speaker helping the learner practice real conversation.

{roleplay_scenario_intro(scenario, tag, situation, words)}

{roleplay_level_guide(level)}

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


ROLEPLAY_COACHING_PROMPT = ChatPromptTemplate.from_template("""You are an English speaking coach for a Korean learner.

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

ROLEPLAY_SUMMARY_PROMPT = ChatPromptTemplate.from_template(
    """You are an English tutor reviewing a role-play conversation with a Korean learner.

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
)


def build_roleplay_start_prompt(
    *,
    level: str,
    scenario: str,
    tag: str | None,
    situation: str,
    words: list,
):
    system = roleplay_system_prompt(level, scenario, tag, situation, words)
    return render_messages(
        [
            ("system", system),
            (
                "human",
                "Start the role-play now: set the scene briefly, then greet me and ask your first question.",
            ),
        ]
    )


def build_roleplay_continue_prompt(
    *,
    history: list,
    user_msg: str,
    level: str,
    scenario: str,
    tag: str | None,
    situation: str,
    words: list,
    coaching: bool = False,
    wrap_up: bool = False,
):
    system = roleplay_system_prompt(
        level,
        scenario,
        tag,
        situation,
        words,
        coaching=coaching,
        wrap_up=wrap_up,
    )
    return render_messages(
        [
            ("system", system),
            ("placeholder", "{history}"),
            ("human", "{user_msg}"),
        ],
        {
            "history": roleplay_history_messages(history),
            "user_msg": user_msg,
        },
    )


def build_roleplay_coaching_prompt(
    *,
    recent_context: str,
    user_msg: str,
    ai_reply: str,
    level: str,
    scenario: str,
    tag: str,
    situation: str,
):
    return render_prompt(
        ROLEPLAY_COACHING_PROMPT,
        {
            "recent_context": recent_context,
            "user_msg": user_msg,
            "ai_reply": ai_reply,
            "level": level,
            "scenario": scenario,
            "tag": tag,
            "situation": situation,
        },
    )


def build_roleplay_summary_prompt(transcript: str):
    return render_prompt(ROLEPLAY_SUMMARY_PROMPT, {"transcript": transcript})
