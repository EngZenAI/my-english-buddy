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
student. Use the student's saved wordbook as the source, but you may include
derived forms of saved words when it helps learning.

Create {question_count} questions. Mix these types from easy to hard:
- meaning_choice: simple meaning or word matching
- context_choice: choose a word/form that fits a sentence
- short_answer: type the target word or derived form
- sentence_answer: write a short English sentence using the target word

Rules:
- Use only provided word_id values as source_word_id/word_id anchors.
- question_type must be one of: meaning_choice, context_choice,
  short_answer, sentence_answer.
- If Goal.question_type_counts is present, create exactly that many questions
  for each listed question_type. The sum is the requested question_count.
- For context_choice, put the English sentence with the blank in passage and
  put only the Korean instruction/question in prompt.
- Create fresh original contexts and sentences. Do not copy, lightly rewrite,
  or imitate any saved example sentence. If examples are absent, invent natural
  new contexts from the word meaning.
- Vary situations, collocations, part-of-speech usage, sentence structure, and
  distractor logic across questions.
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
- Subjective text questions must ask for the saved word or a clear derived form
  only. Do not require a synonym or unrelated related expression as the typed
  answer.
- Objective questions must have exactly four choices A-D and correct_choice_id.
- Objective wrong choices must not be limited to saved wordbook words. Generate
  realistic distractors that could be confused by part of speech, meaning,
  spelling, word form, collocation, or sentence context.
- Do not reuse the same generic wrong choices across questions. Each objective
  question's distractors must be specific to its target word and sentence.
- For every objective question, include answer_explanation, choice_explanations
  with keys A-D, and study_note. Explain every choice, not just the selected one.
- Text questions must have acceptable_answers and no choices.
- Write prompts and explanations in Korean. English passages/examples are allowed.
- Do not reveal the answer in the prompt.
- Respect the user's instruction if present.
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
