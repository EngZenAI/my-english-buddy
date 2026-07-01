import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";
import QuizStatsPanel from "@/components/quiz/QuizStatsPanel";
import QuizConfig from "@/components/quiz/QuizConfig";
import QuizScreen from "@/components/quiz/QuizScreen";
import QuizResult from "@/components/quiz/QuizResult";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, HelpCircle, RefreshCw } from "lucide-react";

function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function createInitialQuizState() {
  return {
    goal: {
      mode: "random",
      tag: "",
      saved_from: todayMinus(30),
      saved_to: new Date().toISOString().slice(0, 10),
      instruction: "",
      question_count: 10,
    },
    questions: [],
    answerToken: "",
    answers: {},
    gradeResult: null,
    message: "",
    savedSuggestions: {},
    reviewInterval: "1d",
  };
}

export default function QuizTab({ user, onRequireLogin, quizState, setQuizState }) {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState("practice");
  const [localQuizState, setLocalQuizState] = useState(createInitialQuizState);
  
  const state = quizState || localQuizState;
  const writeQuizState = setQuizState || setLocalQuizState;
  
  const {
    goal,
    questions,
    answerToken,
    answers,
    gradeResult,
    message,
    savedSuggestions,
    reviewInterval,
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

  const statsQuery = useQuery({
    queryKey: ["quiz-stats"],
    queryFn: api.quizStats,
    enabled: Boolean(user) && activeView === "stats",
    staleTime: 30_000,
  });

  const generateMutation = useMutation({
    mutationFn: () => api.quizGenerate(goal),
    onSuccess: (data) => {
      updateQuizState((prev) => ({
        ...prev,
        gradeResult: null,
        answers: {},
        questions: data.questions || [],
        answerToken: data.answer_token || "",
        savedSuggestions: {},
        message: data.message || "",
      }));
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
      queryClient.invalidateQueries({ queryKey: ["quiz-stats"] });
    },
  });

  const applyReviewScheduleMutation = useMutation({
    mutationFn: () => api.quizApplyReviewSchedule(gradeResult?.session_id, reviewInterval),
    onSuccess: (data) => {
      updateQuizState((prev) => ({
        ...prev,
        gradeResult: prev.gradeResult
          ? {
              ...prev.gradeResult,
              review_schedule_applied: true,
              review_schedule_preview:
                data.review_schedule_preview || prev.gradeResult.review_schedule_preview || [],
            }
          : prev.gradeResult,
        message: data.message || "오답 단어의 복습일을 저장했습니다.",
      }));
      queryClient.invalidateQueries({ queryKey: ["words"] });
      queryClient.invalidateQueries({ queryKey: ["quiz-stats"] });
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
      updateQuizState((prev) => ({
        ...prev,
        savedSuggestions: { ...prev.savedSuggestions, [result.question_id]: true },
      }));
      queryClient.invalidateQueries({ queryKey: ["words"] });
    },
  });

  const genLoading = generateMutation.isPending;
  const gradeLoading = gradeMutation.isPending;
  const applyReviewLoading = applyReviewScheduleMutation.isPending;
  const hasQuiz = questions.length > 0;

  const reviewSchedulePreview = gradeResult?.review_schedule_preview || [];
  const incorrectReviewWords = reviewSchedulePreview.filter(
    (item) => item.result === "incorrect",
  );

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

  const setReviewInterval = (value) => {
    updateQuizState((prev) => ({ ...prev, reviewInterval: value }));
  };

  const generate = () => {
    if (genLoading || gradeLoading || !user) return;
    generateMutation.mutate();
  };

  const grade = () => {
    if (genLoading || gradeLoading || !answerToken || !hasQuiz) return;
    gradeMutation.mutate();
  };

  const applyReviewSchedule = () => {
    if (applyReviewLoading || !gradeResult?.session_id || gradeResult.review_schedule_applied) return;
    applyReviewScheduleMutation.mutate();
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

  const scoreSummary = gradeResult
    ? `${Number(gradeResult.score).toFixed(1)} / ${gradeResult.total}`
    : "";

  const resetQuiz = () => {
    updateQuizState((prev) => ({
      ...prev,
      questions: [],
      gradeResult: null,
      answers: {},
      answerToken: "",
      message: "",
    }));
  };

  return (
    <div className="h-full flex flex-col select-none">
      {/* 퀴즈 탭 상단 메뉴 */}
      <div className="flex flex-col gap-5 md:flex-row md:items-center justify-between border-b pb-4.5">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight dark:text-slate-100 flex items-center gap-1.5">
            <Sparkles className="h-5 w-5 text-brand-500 fill-brand-100" />
            AI 어휘 퀴즈
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            단어장에 저장된 단어들을 분석하여 맞춤형 어휘 테스트를 제공합니다.
          </p>
        </div>

        {/* 탭 토글 스위치 */}
        <div className="flex rounded-xl border border-slate-200/80 bg-white p-0.5 self-start">
          {[
            { id: "practice", label: "퀴즈 풀기" },
            { id: "stats", label: "성과 통계" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`h-8 rounded-lg px-4 text-xs font-semibold transition-all ${
                activeView === item.id
                  ? "bg-slate-900 text-white dark:bg-slate-800"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {!user && <MemberNotice feature="퀴즈" onRequireLogin={onRequireLogin} />}

      {/* 에러 및 메시지 배너 */}
      {(generateMutation.error || gradeMutation.error || applyReviewScheduleMutation.error) && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 px-4 py-3 text-xs font-semibold text-rose-700">
          {(generateMutation.error || gradeMutation.error || applyReviewScheduleMutation.error).message}
        </div>
      )}

      {message && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
          {message}
        </div>
      )}

      {/* 메인 탭 뷰 렌더링 분기 */}
      {user && (
        <div className="flex-1 mt-5">
          {activeView === "stats" ? (
            <QuizStatsPanel statsQuery={statsQuery} />
          ) : (
            <div className="h-full">
              {!hasQuiz ? (
                /* A. 퀴즈 대기/설정 화면 (2-Column 구성) */
                <div className="flex flex-col gap-6 md:grid md:grid-cols-12 md:gap-6 items-start">
                  <div className="w-full md:col-span-8">
                    <QuizConfig
                      goal={goal}
                      setGoalValue={setGoalValue}
                      labels={labels}
                      onGenerate={generate}
                      disabled={genLoading}
                      user={user}
                    />
                  </div>

                  <div className="w-full md:col-span-4 space-y-4">
                    <Card className="shadow-sm border-slate-100/90 rounded-2xl bg-slate-50/40">
                      <CardContent className="p-5 space-y-3">
                        <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <HelpCircle className="h-4 w-4 text-brand-500" />
                          퀴즈 학습 안내 가이드
                        </h4>
                        <ul className="text-xs text-slate-500 space-y-2.5 leading-relaxed font-medium list-disc pl-4.5">
                          <li>뜻/단어 맞추기부터 문맥 빈칸 완성, 주관식 영작까지 AI가 골고루 섞어 출제합니다.</li>
                          <li>퀴즈가 종료되면 점수 및 유형별 정확도가 시각적으로 집계됩니다.</li>
                          <li>틀린 단어는 복습 주기(1일/1주/1달 등)를 지정하여 단어장 복습일정을 관리할 수 있습니다.</li>
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                /* B. 퀴즈 실행 & 결과 화면 */
                <div className="max-w-2xl mx-auto space-y-6">
                  {/* 결과 요약판 (종료 시에만 노출) */}
                  {gradeResult && (
                    <div className="flex items-center justify-between pb-1 border-b">
                      <h3 className="text-sm font-extrabold text-slate-800">퀴즈 결과 분석</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resetQuiz}
                        className="h-8.5 rounded-xl border-slate-200 text-xs text-slate-600 gap-1.5"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        새 퀴즈 풀기
                      </Button>
                    </div>
                  )}

                  <QuizScreen
                    questions={questions}
                    answers={answers}
                    chooseAnswer={chooseAnswer}
                    typeTextAnswer={typeTextAnswer}
                    gradeResult={gradeResult}
                    resultByQuestion={resultByQuestion}
                    onGrade={grade}
                    gradeLoading={gradeLoading}
                  />

                  {gradeResult && (
                    <QuizResult
                      gradeResult={gradeResult}
                      scoreSummary={scoreSummary}
                      incorrectReviewWords={incorrectReviewWords}
                      reviewInterval={reviewInterval}
                      setReviewInterval={setReviewInterval}
                      onApplyReview={applyReviewSchedule}
                      applyReviewLoading={applyReviewLoading}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
