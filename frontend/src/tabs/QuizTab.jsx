import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import MemberNotice from "../components/MemberNotice";
import QuizStatsPanel from "@/components/quiz/QuizStatsPanel";
import QuizConfig from "@/components/quiz/QuizConfig";
import QuizScreen from "@/components/quiz/QuizScreen";

function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function createInitialStatsRange() {
  return {
    preset: "week",
    startDate: todayMinus(6),
    endDate: todayString(),
  };
}

const DEFAULT_QUESTION_TYPE_COUNTS = {
  meaning_choice: 4,
  context_choice: 4,
  short_answer: 1,
  sentence_answer: 1,
};

function createInitialQuizState() {
  return {
    goal: {
      mode: "random",
      tag: "",
      scope_all: true,
      scope_tags: [],
      scope_saved_date: false,
      scope_due: false,
      saved_from: todayMinus(30),
      saved_to: new Date().toISOString().slice(0, 10),
      instruction: "",
      question_count: 10,
      question_type_counts: DEFAULT_QUESTION_TYPE_COUNTS,
    },
    questions: [],
    answerToken: "",
    answers: {},
    currentIndex: 0,
    gradeResult: null,
    message: "",
  };
}

export default function QuizTab({ user, onRequireLogin, quizState, setQuizState }) {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState("practice");
  const [localQuizState, setLocalQuizState] = useState(createInitialQuizState);
  const [statsRange, setStatsRange] = useState(createInitialStatsRange);
  const [savedSuggestedWords, setSavedSuggestedWords] = useState(() => new Set());
  
  const state = quizState || localQuizState;
  const writeQuizState = setQuizState || setLocalQuizState;
  
  const {
    goal,
    questions,
    answerToken,
    answers,
    currentIndex,
    gradeResult,
    message,
  } = state;

  const updateQuizState = (updater) => {
    writeQuizState((prev) => {
      const base = prev || createInitialQuizState();
      return typeof updater === "function" ? updater(base) : { ...base, ...updater };
    });
  };

  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  const labels = labelsQuery.data?.labels || [];

  const wordsQuery = useQuery({
    queryKey: queryKeys.words(""),
    queryFn: () => api.listWords(""),
    enabled: Boolean(user) && activeView === "practice" && questions.length === 0,
    staleTime: 30_000,
  });
  const words = wordsQuery.data?.words || [];

  const statsQuery = useQuery({
    queryKey: ["quiz-stats", statsRange.startDate, statsRange.endDate],
    queryFn: () => api.quizStats({ startDate: statsRange.startDate, endDate: statsRange.endDate }),
    enabled: Boolean(user) && activeView === "stats",
    staleTime: 30_000,
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      const counts = Object.keys(goal.question_type_counts || {}).length
        ? goal.question_type_counts
        : DEFAULT_QUESTION_TYPE_COUNTS;
      const questionCount = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
      return api.quizGenerate({
        ...goal,
        question_type_counts: counts,
        question_count: questionCount,
      });
    },
    onSuccess: (data) => {
      updateQuizState((prev) => ({
        ...prev,
        gradeResult: null,
        answers: {},
        currentIndex: 0,
        questions: data.questions || [],
        answerToken: data.answer_token || "",
        message: data.questions?.length ? "" : data.message || "",
      }));
      setSavedSuggestedWords(new Set());
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
      updateQuizState((prev) => ({ ...prev, gradeResult: data, message: "" }));
      setSavedSuggestedWords(new Set());
      queryClient.invalidateQueries({ queryKey: ["quiz-stats"] });
    },
  });

  const saveSuggestedWordMutation = useMutation({
    mutationFn: (result) =>
      api.saveWord({
        word: result.suggested_word,
        korean: result.suggested_korean || result.target_word || "",
        korean_detail: "",
        english_def: result.suggested_english_def || "",
        example: result.suggested_example || "",
        tag: result.suggested_tag || "미지정",
      }),
    onSuccess: (_data, result) => {
      setSavedSuggestedWords((prev) => {
        const next = new Set(prev);
        next.add(result.suggested_word);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.words("") });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    },
  });

  const openSessionMutation = useMutation({
    mutationFn: (sessionId) => api.quizSession(sessionId),
    onSuccess: (data) => {
      updateQuizState((prev) => ({
        ...prev,
        questions: data.questions || [],
        answers: data.answers || {},
        gradeResult: data.grade_result || null,
        answerToken: "",
        currentIndex: 0,
        message: "",
      }));
      setActiveView("practice");
    },
  });

  const genLoading = generateMutation.isPending;
  const gradeLoading = gradeMutation.isPending;
  const hasQuiz = questions.length > 0;

  const resultByQuestion = useMemo(() => {
    const pairs = (gradeResult?.results || []).map((result) => [
      result.question_id,
      result,
    ]);
    return Object.fromEntries(pairs);
  }, [gradeResult]);

  const setGoalValue = (key, value) => {
    updateQuizState((prev) => ({
      ...prev,
      goal: { ...prev.goal, [key]: value },
    }));
  };

  const setCurrentIndex = (value) => {
    updateQuizState((prev) => {
      const maxIndex = Math.max((prev.questions?.length || 1) - 1, 0);
      const nextIndex =
        typeof value === "function" ? value(prev.currentIndex || 0) : value;
      return {
        ...prev,
        currentIndex: Math.min(Math.max(nextIndex, 0), maxIndex),
      };
    });
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
    updateQuizState((prev) => ({
      ...prev,
      answers: {
        ...prev.answers,
        [questionId]: { choice_id: choiceId, text_answer: "" },
      },
    }));
  };

  const typeTextAnswer = (questionId, value) => {
    if (gradeResult) return;
    updateQuizState((prev) => ({
      ...prev,
      answers: {
        ...prev.answers,
        [questionId]: { choice_id: "", text_answer: value },
      },
    }));
  };

  const resetQuiz = () => {
    updateQuizState((prev) => ({
      ...prev,
      questions: [],
      gradeResult: null,
      answers: {},
      currentIndex: 0,
      answerToken: "",
      message: "",
    }));
    setSavedSuggestedWords(new Set());
  };

  return (
    <div className="h-full flex flex-col select-none">
      <div className="border-b border-slate-200">
        <div className="flex gap-8">
          {[
            { id: "practice", label: hasQuiz ? "퀴즈 풀이" : "퀴즈" },
            { id: "stats", label: "리포트" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`relative h-11 text-sm font-black transition ${
                activeView === item.id
                  ? "text-[#064e1f]"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {item.label}
              {activeView === item.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#064e1f]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {!user && <MemberNotice feature="퀴즈" onRequireLogin={onRequireLogin} />}

      {/* 에러 및 메시지 배너 */}
      {(generateMutation.error || gradeMutation.error || openSessionMutation.error) && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 px-4 py-3 text-xs font-semibold text-rose-700">
          {(generateMutation.error || gradeMutation.error || openSessionMutation.error).message}
        </div>
      )}

      {message && !hasQuiz && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
          {message}
        </div>
      )}

      {/* 메인 탭 뷰 렌더링 분기 */}
      {user && (
        <div className="flex-1 mt-5">
          {activeView === "stats" ? (
            <QuizStatsPanel
              statsQuery={statsQuery}
              range={statsRange}
              onRangeChange={setStatsRange}
              onOpenSession={(sessionId) => openSessionMutation.mutate(sessionId)}
              openingSessionId={openSessionMutation.isPending ? openSessionMutation.variables : null}
            />
          ) : (
            <div className="h-full">
              {!hasQuiz ? (
                <div className="space-y-4">
                  <QuizConfig
                    goal={goal}
                    setGoalValue={setGoalValue}
                    labels={labels}
                    words={words}
                    onGenerate={generate}
                    disabled={genLoading}
                    loading={genLoading}
                    user={user}
                  />
                </div>
              ) : (
                /* B. 퀴즈 실행 & 결과 화면 */
                <div className="w-full">
                  <QuizScreen
                    questions={questions}
                    answers={answers}
                    chooseAnswer={chooseAnswer}
                    typeTextAnswer={typeTextAnswer}
                    gradeResult={gradeResult}
                    resultByQuestion={resultByQuestion}
                    currentIndex={currentIndex || 0}
                    setCurrentIndex={setCurrentIndex}
                    onGrade={grade}
                    gradeLoading={gradeLoading}
                    onResetQuiz={resetQuiz}
                    onSaveSuggestedWord={(result) => saveSuggestedWordMutation.mutate(result)}
                    savingSuggestedWord={
                      saveSuggestedWordMutation.isPending
                        ? saveSuggestedWordMutation.variables?.suggested_word || ""
                        : ""
                    }
                    savedSuggestedWords={savedSuggestedWords}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
