export const DEFAULT_QUESTION_TYPE_COUNTS = {
  meaning_choice: 4,
  context_choice: 4,
  short_answer: 1,
  sentence_answer: 1,
};

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatLocalDate(date);
}

export function todayString() {
  return formatLocalDate(new Date());
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
