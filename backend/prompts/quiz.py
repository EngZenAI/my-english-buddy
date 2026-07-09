from langchain_core.prompts import ChatPromptTemplate

from backend.prompts.common import render_prompt

LEGACY_QUIZ_PROMPT = ChatPromptTemplate.from_template("""
당신은 영어 학습 튜터입니다.
아래 단어들로 영어 퀴즈를 만들어주세요.

형식:
- 빈칸 채우기 3문제 (예문에서 단어를 _____로 대체)
- 뜻 맞추기 2문제 (영어 뜻을 보고 단어 맞추기)
- 각 문제 아래에 [정답: ] 표시

단어 목록:
{word_list}
""")

LEGACY_GRADE_PROMPT = ChatPromptTemplate.from_template("""
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

QUIZ_GENERATION_PROMPT = ChatPromptTemplate.from_template(
    """
You are an English academy teacher creating vocabulary homework for a Korean
learner. Saved wordbook items are anchors/topics, not mandatory answers.
target_word may be a saved word, derived form, related expression, synonym,
antonym, collocation, or contextual trap when that makes a better question.

Create {question_count} questions. Mix these types from easy to hard:
- meaning_choice: choose the Korean meaning/nuance of a target word used in an English sentence
- context_choice: choose the word/form that fits a natural English blank sentence
- collocation_choice: choose the natural word/phrase for a common collocation or expression
- usage_choice: choose the English sentence that uses the target word naturally
- short_answer: type the target word or derived form
- sentence_answer: write a short English sentence using the target word

Rules:
- Use only provided word_id values as source_word_id/word_id anchors.
- question_type must be one of: meaning_choice, context_choice,
  collocation_choice, usage_choice, short_answer, sentence_answer.
- If Goal.question_type_counts is present, follow those counts exactly.
- meaning_choice: passage is an English sentence containing target_word. Choices are Korean meanings/nuances only, never English target words.
- context_choice/collocation_choice: passage is an English sentence with one blank. The correct choice must not appear in prompt or passage.
- usage_choice: choices are four English sentences. All four include target_word, but exactly one uses it naturally.
- short_answer: ask from an English clue or English blank sentence. Do not ask "한국어 '...'에 해당하는 영어 단어" or use Korean example sentences.
- sentence_answer: prompt must name the exact target_word, e.g. "다음 단어를 사용해 영어 문장을 작성하세요: target_word".
- Korean is for instructions/explanations only. Every example sentence,
  situation sentence, passage, and blank sentence must be English.
- Objective questions must test usage in context, not dictionary recall. Do not use direct-definition prompts like "'word'의 뜻은?".
- Create fresh contexts; do not copy or lightly rewrite saved examples.
- Vary situations, collocations, parts of speech, and sentence structures.
- For derived words, keep word_id/source_word_id as the original saved word id,
  set is_derived=true, target_word to the derived word, and derived_from_word_id.
- Objective questions may use a related target_word that is not in the saved
  wordbook when it improves learning: derived forms, synonyms, antonyms,
  collocations, same word family, or a contextually natural expression. Keep
  source_word_id anchored to the saved word, set is_related=true, and set
  relation_type to one of: derived, synonym, antonym, collocation, word_family,
  contextual.
- When target_word is not the saved source word, fill suggested_korean,
  suggested_english_def, suggested_example, and suggested_tag so the learner can
  add the missed target to the wordbook after grading.
- Text questions may ask for a saved, derived, or closely related answer, but
  the clue must be enough to infer it from English context.
- Objective questions must have exactly four choices A-D and correct_choice_id.
- Wrong choices must usually be newly generated distractors, not other saved
  wordbook words. Use plausible distractors by meaning, part of speech,
  spelling, word form, collocation, or context.
- Do not use generic wrong choices such as "related meaning", "opposite
  meaning", or "unrelated meaning".
- For every objective question, include answer_explanation, choice_explanations
  with keys A-D, and study_note. Explain every choice, not just the selected one.
- Text questions must have acceptable_answers and no choices.
- Write prompts and explanations in Korean. Write passages/examples in English.
- Do not reveal the answer in the prompt.
- Respect the user's instruction if present.
- Use concise reasoning and write the final JSON immediately.
- Return only one valid JSON object that matches the schema. Do not return
  markdown fences, comments, prose, or null.

Generation note:
{generation_note}

Goal:
{goal_json}

Wordbook JSON:
{wordbook_json}

{format_instructions}
"""
)

SUBJECTIVE_GRADE_PROMPT = ChatPromptTemplate.from_template(
    """
You are grading an English vocabulary quiz answer from a Korean learner.

Question:
{prompt}

Target word:
{target_word}

Acceptable answers:
{acceptable_answers}

User answer:
{user_answer}

Grade with this policy:
- correct: clearly uses or identifies the expected word/form correctly.
- partial: understandable but has a typo, weak grammar, or incomplete use.
- incorrect: wrong word, missing answer, or meaning does not match.
- confidence should be lower when several interpretations are possible.
- Feedback must be concise Korean.

{format_instructions}
"""
)


def build_legacy_quiz_prompt(word_list: str):
    return render_prompt(LEGACY_QUIZ_PROMPT, {"word_list": word_list})


def build_legacy_grade_prompt(quiz_text: str, user_answer: str):
    return render_prompt(
        LEGACY_GRADE_PROMPT,
        {
            "quiz_text": quiz_text,
            "user_answer": user_answer,
        },
    )


def build_quiz_generation_prompt(
    *,
    question_count: int,
    goal_json: str,
    wordbook_json: str,
    generation_note: str,
    format_instructions: str,
):
    return render_prompt(
        QUIZ_GENERATION_PROMPT,
        {
            "question_count": question_count,
            "goal_json": goal_json,
            "wordbook_json": wordbook_json,
            "generation_note": generation_note,
            "format_instructions": format_instructions,
        },
    )


def build_subjective_grade_prompt(
    *,
    prompt: str,
    target_word: str,
    acceptable_answers: str,
    user_answer: str,
    format_instructions: str,
):
    return render_prompt(
        SUBJECTIVE_GRADE_PROMPT,
        {
            "prompt": prompt,
            "target_word": target_word,
            "acceptable_answers": acceptable_answers,
            "user_answer": user_answer,
            "format_instructions": format_instructions,
        },
    )
