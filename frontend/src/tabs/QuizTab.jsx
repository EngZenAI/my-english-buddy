import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

const MODES = [
  { id: "random", label: "무작위" },
  { id: "tag", label: "태그" },
  { id: "saved_date", label: "저장일" },
  { id: "ai_instruction", label: "AI 지시" },
];

const TYPE_LABELS = {
  meaning_choice: "뜻/단어",
  context_choice: "문맥 빈칸",
  grammar_blank_choice: "시험형 빈칸",
  short_answer: "단답형",
  sentence_answer: "문장형",
};
const SAVED_GRAMMAR_BLANK_CHOICE_ALIASES = new Set([["to" + "eic", "part5"].join("_")]);
const CHOICE_IDS = ["A", "B", "C", "D"];

const DIFFICULTY_LABELS = {
  easy: "기초",
  medium: "응용",
  hard: "심화",
  challenge: "도전",
};

const STATUS_LABELS = {
  correct: "정답",
  partial: "부분 정답",
  incorrect: "오답",
};

function normalizeQuestionType(type) {
  return SAVED_GRAMMAR_BLANK_CHOICE_ALIASES.has(type) ? "grammar_blank_choice" : type;
}

function questionTypeLabel(type) {
  const normalized = normalizeQuestionType(type);
  return TYPE_LABELS[normalized] || normalized;
}

function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function QuizTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState({
    mode: "random",
    tag: "",
    saved_from: todayMinus(30),
    saved_to: new Date().toISOString().slice(0, 10),
    instruction: "",
    question_count: 10,
  });
  const [questions, setQuestions] = useState([]);
  const [answerToken, setAnswerToken] = useState("");
  const [answers, setAnswers] = useState({});
  const [gradeResult, setGradeResult] = useState(null);
  const [message, setMessage] = useState("");
  const [savedSuggestions, setSavedSuggestions] = useState({});

  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });

  const labels = labelsQuery.data?.labels || [];

  const generateMutation = useMutation({
    mutationFn: () => api.quizGenerate(goal),
    onSuccess: (data) => {
      setGradeResult(null);
      setAnswers({});
      setQuestions(data.questions || []);
      setAnswerToken(data.answer_token || "");
      setSavedSuggestions({});
      setMessage(data.message || "");
    },
  });

  const gradePayload = useMemo(
    () =>
      Object.entries(answers).map(([questionId, value]) => ({
        question_id: questionId,
        choice_id: value?.choice_id || "",
        text_answer: value?.text_answer || "",
      })),
    [answers],
  );

  const gradeMutation = useMutation({
    mutationFn: () => api.quizGrade(answerToken, gradePayload),
    onSuccess: (data) => {
      setGradeResult(data);
      setMessage("");
    },
  });

  const saveSuggestionMutation = useMutation({
    mutationFn: (result) =>
      api.saveWord({
        word: result.suggested_word,
        korean: result.suggested_korean,
        korean_detail: result.suggested_korean,
        english_def: result.suggested_english_def,
        example: result.suggested_example,
        tag: result.suggested_tag || "미지정",
      }),
    onSuccess: (_data, result) => {
      setSavedSuggestions((prev) => ({ ...prev, [result.question_id]: true }));
      queryClient.invalidateQueries({ queryKey: ["words"] });
      queryClient.invalidateQueries({ queryKey: ["word-saved"] });
    },
  });

  const genLoading = generateMutation.isPending;
  const gradeLoading = gradeMutation.isPending;
  const answeredCount = Object.keys(answers).length;
  const hasQuiz = questions.length > 0;
  const resultByQuestion = useMemo(() => {
    const pairs = (gradeResult?.results || []).map((result) => [
      result.question_id,
      result,
    ]);
    return Object.fromEntries(pairs);
  }, [gradeResult]);

  const setGoalValue = (key, value) => {
    setGoal((prev) => ({ ...prev, [key]: value }));
  };

  const generate = () => {
    if (genLoading || gradeLoading || !user) return;
    generateMutation.mutate();
  };

  const grade = () => {
    if (genLoading || gradeLoading || !answerToken || !hasQuiz) return;
    gradeMutation.mutate();
  };

  const chooseAnswer = (questionId, choiceId) => {
    if (gradeResult) return;
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { choice_id: choiceId, text_answer: "" },
    }));
  };

  const typeTextAnswer = (questionId, value) => {
    if (gradeResult) return;
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { choice_id: "", text_answer: value },
    }));
  };

  const scoreSummary = gradeResult
    ? `${Number(gradeResult.score).toFixed(1)} / ${gradeResult.total}`
    : "";

  return (
    <div>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">AI 어휘 과제</h3>
        <p className="text-sm text-slate-500">
          목표를 정하면 저장한 단어와 파생어를 섞어 난이도별 퀴즈를 생성합니다.
        </p>
      </div>

      {!user && <MemberNotice feature="퀴즈" onRequireLogin={onRequireLogin} />}

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setGoalValue("mode", mode.id)}
              className={`h-9 rounded-lg border px-3 text-sm font-semibold ${
                goal.mode === mode.id
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {goal.mode === "tag" && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-600">태그</span>
              <select
                value={goal.tag}
                onChange={(e) => setGoalValue("tag", e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm
                           focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">전체 태그</option>
                {labels.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </label>
          )}

          {goal.mode === "saved_date" && (
            <>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">저장 시작일</span>
                <input
                  type="date"
                  value={goal.saved_from}
                  onChange={(e) => setGoalValue("saved_from", e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">저장 종료일</span>
                <input
                  type="date"
                  value={goal.saved_to}
                  onChange={(e) => setGoalValue("saved_to", e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </label>
            </>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">문항 수</span>
            <select
              value={goal.question_count}
              onChange={(e) => setGoalValue("question_count", Number(e.target.value))}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              {[5, 10, 15, 20].map((count) => (
                <option key={count} value={count}>{count}문항</option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium text-slate-600">AI 출제 지시문</span>
          <textarea
            rows={3}
            value={goal.instruction}
            onChange={(e) => setGoalValue("instruction", e.target.value)}
            placeholder="예: 시험형 빈칸 문제를 많이 넣고, 헷갈리는 파생어를 포함해줘."
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </label>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            단순 뜻맞추기부터 문맥 빈칸, 시험형 빈칸, 주관식까지 섞어 출제합니다.
          </p>
          <button
            onClick={generate}
            disabled={genLoading || gradeLoading || !user}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {genLoading ? (
              <LoadingSpinner
                label="출제 중"
                className="text-white"
                spinnerClassName="border-white/40 border-t-white"
              />
            ) : "AI 퀴즈 생성"}
          </button>
        </div>
      </section>

      {(generateMutation.error || gradeMutation.error || saveSuggestionMutation.error) && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {(generateMutation.error || gradeMutation.error || saveSuggestionMutation.error).message}
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          {message}
        </div>
      )}

      <div className="mt-4">
        {genLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border border-slate-200 bg-white p-4">
                <SkeletonBlock className="h-4 w-3/4" />
                <SkeletonBlock className="mt-3 h-4 w-5/6" />
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <SkeletonBlock className="h-10" />
                  <SkeletonBlock className="h-10" />
                  <SkeletonBlock className="h-10" />
                  <SkeletonBlock className="h-10" />
                </div>
              </div>
            ))}
          </div>
        ) : hasQuiz ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>총 {questions.length}문제</span>
              <span>{answeredCount}/{questions.length} 답변</span>
            </div>

            {questions.map((question, index) => {
              const result = resultByQuestion[question.id];
              const answer = answers[question.id] || {};
              const normalizedQuestionType = normalizeQuestionType(question.question_type);
              const choiceExplanationEntries = result?.choice_explanations
                ? CHOICE_IDS
                    .map((choiceId) => [choiceId, result.choice_explanations[choiceId]])
                    .filter(([, text]) => Boolean(text))
                : [];
              return (
                <div
                  key={question.id}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                      {questionTypeLabel(question.question_type)}
                    </span>
                    <span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700">
                      {DIFFICULTY_LABELS[question.difficulty] || question.difficulty}
                    </span>
                    {question.is_derived && (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                        파생어
                      </span>
                    )}
                    {result && (
                      <span
                        className={`ml-auto rounded-full px-2 py-1 text-xs font-semibold ${
                          result.status === "correct"
                            ? "bg-emerald-50 text-emerald-700"
                            : result.status === "partial"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {STATUS_LABELS[result.status] || result.status}
                      </span>
                    )}
                  </div>

                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    {index + 1}. {question.prompt}
                  </p>
                  {question.passage && (
                    <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {question.passage}
                    </p>
                  )}

                  {question.answer_format === "choice" ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {question.choices.map((choice) => {
                        const selected = answer.choice_id === choice.id;
                        const correctChoice = result?.correct_choice_id === choice.id;
                        const wrongSelected = result && selected && !correctChoice;
                        return (
                          <button
                            key={choice.id}
                            type="button"
                            onClick={() => chooseAnswer(question.id, choice.id)}
                            disabled={Boolean(gradeResult)}
                            className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition
                              ${selected ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white hover:bg-slate-50"}
                              ${correctChoice ? "border-emerald-500 bg-emerald-50 text-emerald-800" : ""}
                              ${wrongSelected ? "border-rose-500 bg-rose-50 text-rose-800" : ""}
                              disabled:cursor-default`}
                          >
                            <span className="font-semibold">{choice.id}.</span>{" "}
                            <span>{choice.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <textarea
                      rows={normalizedQuestionType === "sentence_answer" ? 3 : 2}
                      value={answer.text_answer || ""}
                      onChange={(e) => typeTextAnswer(question.id, e.target.value)}
                      disabled={Boolean(gradeResult)}
                      placeholder={
                        normalizedQuestionType === "sentence_answer"
                          ? "영어 문장을 입력하세요."
                          : "답을 입력하세요."
                      }
                      className="mt-3 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm
                                 disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  )}

                  {result && (
                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      {result.correct_text && (
                        <div>
                          <p className="font-semibold text-slate-800">정답</p>
                          <p className="mt-1">
                            {result.correct_choice_id}. {result.correct_text}
                          </p>
                          {(result.answer_explanation || result.explanation) && (
                            <p className="mt-1">
                              {result.answer_explanation || result.explanation}
                            </p>
                          )}
                        </div>
                      )}
                      {!result.correct_text && result.acceptable_answers?.length > 0 && (
                        <div>
                          <p className="font-semibold text-slate-800">허용 답안</p>
                          <p className="mt-1">{result.acceptable_answers.join(", ")}</p>
                          {result.explanation && <p className="mt-1">{result.explanation}</p>}
                        </div>
                      )}
                      {choiceExplanationEntries.length > 0 && (
                        <div className="mt-3">
                          <p className="font-semibold text-slate-800">선택지 분석</p>
                          <ul className="mt-1 space-y-1">
                            {choiceExplanationEntries.map(([choiceId, text]) => (
                              <li key={choiceId}>
                                <span className="font-semibold">{choiceId}.</span> {text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {result.study_note && (
                        <div className="mt-3">
                          <p className="font-semibold text-slate-800">학습 노트</p>
                          <p className="mt-1">{result.study_note}</p>
                        </div>
                      )}
                      {result.confidence < 0.7 && (
                        <p className="mt-1 text-amber-700">
                          AI 채점 확신도가 낮습니다. 답안 해석이 애매할 수 있습니다.
                        </p>
                      )}
                      {result.can_add_to_wordbook && (
                        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-sm text-amber-800">
                            파생어 {result.suggested_word}를 단어장에 추가할까요?
                          </span>
                          <button
                            type="button"
                            onClick={() => saveSuggestionMutation.mutate(result)}
                            disabled={savedSuggestions[result.question_id] || saveSuggestionMutation.isPending}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold
                                       text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savedSuggestions[result.question_id] ? "추가됨" : "단어장에 추가"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={grade}
              disabled={genLoading || gradeLoading || !user || !answerToken || Boolean(gradeResult)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold
                         hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {gradeLoading ? <LoadingSpinner label="채점 중" /> : "채점하기"}
            </button>

            {gradeResult && (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">
                  점수 {scoreSummary}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(gradeResult.type_stats || {}).map(([type, stat]) => (
                    <span
                      key={type}
                      className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
                    >
                      {questionTypeLabel(type)}: {Math.round((stat.accuracy || 0) * 100)}%
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  정답 단어는 30일 뒤, 오답 단어는 1일 뒤로 다음 복습일이 조정됩니다.
                </p>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            title={user ? "생성된 퀴즈가 없습니다" : "로그인이 필요합니다"}
            description={
              user
                ? "목표를 설정하고 AI 퀴즈 생성을 누르세요."
                : "로그인하면 저장한 단어로 AI 어휘 과제를 받을 수 있어요."
            }
          />
        )}
      </div>
    </div>
  );
}
