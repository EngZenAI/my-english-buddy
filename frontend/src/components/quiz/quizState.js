export const DEFAULT_QUESTION_TYPE_COUNTS = {
  meaning_choice: 4,
  context_choice: 4,
  short_answer: 1,
  sentence_answer: 1,
};

export function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function createInitialQuizState() {
  return {
    goal: {
      mode: "random",
      tag: "",
      scope_all: true,
      scope_tags: [],
      scope_saved_date: false,
      scope_due: false,
      saved_from: todayMinus(30),
      saved_to: todayString(),
      instruction: "",
      question_count: 10,
      question_type_counts: { ...DEFAULT_QUESTION_TYPE_COUNTS },
    },
    questions: [],
    answerToken: "",
    answers: {},
    currentIndex: 0,
    gradeResult: null,
    message: "",
  };
}
