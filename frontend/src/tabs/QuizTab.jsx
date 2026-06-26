import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

const MODES = [
  { id: "random", label: "무작위" },
  { id: "tag", label: "태그" },
  { id: "saved_date", label: "저장 기간" },
];

const TYPE_LABELS = {
  meaning_choice: "뜻/단어",
  context_choice: "문맥 빈칸",
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

const REVIEW_INTERVAL_OPTIONS = [
  { value: "1d", label: "1일 후" },
  { value: "1w", label: "1주일 후" },
  { value: "1m", label: "1개월 후" },
  { value: "3m", label: "3개월 후" },
];

const STATS_SORT_OPTIONS = [
  { value: "incorrect", label: "오답 많은 순" },
  { value: "accuracy_asc", label: "정답률 낮은 순" },
  { value: "recent", label: "최근 풀이 순" },
  { value: "attempts", label: "풀이 많은 순" },
  { value: "word", label: "단어 A-Z" },
];

const CHART_COLORS = {
  correct: "#059669",
  partial: "#d97706",
  incorrect: "#dc2626",
  accuracy: "#0f766e",
  incorrectRate: "#e11d48",
  grid: "#e2e8f0",
  axis: "#64748b",
};

function normalizeQuestionType(type) {
  if (SAVED_GRAMMAR_BLANK_CHOICE_ALIASES.has(type) || type === "grammar_blank_choice") {
    return "context_choice";
  }
  return type;
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

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function ProgressMeter({ value }) {
  const pct = Math.max(0, Math.min(Math.round(Number(value || 0) * 100), 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatChartValue(value, dataKey) {
  if (dataKey === "value" || dataKey === "attempts") {
    return `${Number(value || 0).toLocaleString()}회`;
  }
  return `${value}%`;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg shadow-slate-200/70">
      {label && <p className="mb-1 font-semibold text-slate-800">{label}</p>}
      <div className="space-y-0.5">
        {payload.map((item) => (
          <p key={item.dataKey || item.name} className="text-slate-600">
            <span className="font-semibold" style={{ color: item.color }}>
              {item.name}
            </span>
            : {formatChartValue(item.value, item.dataKey)}
          </p>
        ))}
      </div>
    </div>
  );
}

function ChartCard({ title, description, children, legend }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/70">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
        </div>
        {legend && <div className="flex flex-wrap gap-2">{legend}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ChartLegendItem({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function sortWordStats(items, sortBy) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (sortBy === "accuracy_asc") {
      return (a.accuracy || 0) - (b.accuracy || 0) || (b.attempt_count || 0) - (a.attempt_count || 0);
    }
    if (sortBy === "recent") {
      return String(b.last_quiz_at || "").localeCompare(String(a.last_quiz_at || ""));
    }
    if (sortBy === "attempts") {
      return (b.attempt_count || 0) - (a.attempt_count || 0) || (b.incorrect_count || 0) - (a.incorrect_count || 0);
    }
    if (sortBy === "word") {
      return String(a.word || "").localeCompare(String(b.word || ""));
    }
    return (b.incorrect_count || 0) - (a.incorrect_count || 0) || (b.attempt_count || 0) - (a.attempt_count || 0);
  });
  return sorted;
}

function QuizStatsPanel({ statsQuery }) {
  const [viewMode, setViewMode] = useState("sheet");
  const [sortBy, setSortBy] = useState("incorrect");
  const data = statsQuery.data || {};
  const summary = data.summary || {};
  const wordStats = data.word_stats || [];
  const typeStats = data.type_stats || [];
  const recentIncorrect = data.recent_incorrect || [];
  const sortedWordStats = useMemo(
    () => sortWordStats(wordStats, sortBy),
    [wordStats, sortBy],
  );
  const resultDistribution = [
    { name: "정답", value: Number(summary.correct_count || 0), color: CHART_COLORS.correct },
    { name: "부분 정답", value: Number(summary.partial_count || 0), color: CHART_COLORS.partial },
    { name: "오답", value: Number(summary.incorrect_count || 0), color: CHART_COLORS.incorrect },
  ].filter((item) => item.value > 0);
  const typeChartData = typeStats.map((item) => ({
    name: questionTypeLabel(item.question_type),
    accuracy: Math.round(Number(item.accuracy || 0) * 100),
    incorrectRate: Math.round(Number(item.incorrect_rate || 0) * 100),
    attempts: item.attempt_count || 0,
  }));
  const wordChartData = sortedWordStats.slice(0, 10).map((item) => ({
    name: item.word || "-",
    accuracy: Math.round(Number(item.accuracy || 0) * 100),
    incorrectRate: Math.round(Number(item.incorrect_rate || 0) * 100),
    attempts: item.attempt_count || 0,
  }));
  const sortLabel = STATS_SORT_OPTIONS.find((option) => option.value === sortBy)?.label || "";
  const hasStats = Number(summary.attempt_count || 0) > 0;

  if (statsQuery.isPending) {
    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6">
        <LoadingSpinner label="학습 통계를 불러오는 중" />
      </div>
    );
  }

  if (statsQuery.error) {
    return (
      <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        {statsQuery.error.message}
      </div>
    );
  }

  if (!hasStats) {
    return (
      <div className="mt-4">
        <EmptyState
          title="아직 학습 통계가 없습니다"
          description="퀴즈를 풀고 채점하면 단어별 정답률과 최근 오답이 여기에 쌓입니다."
        />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-slate-500">총 풀이</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {summary.attempt_count || 0}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">평균 정답률</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {percent(summary.accuracy)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">오답률</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {percent(summary.incorrect_rate)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">취약 단어</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {summary.incorrect_word_count || 0}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="text-sm font-semibold text-slate-800">단어별 성과</h4>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              {[
                { id: "sheet", label: "목록 보기" },
                { id: "chart", label: "차트 보기" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setViewMode(item.id)}
                  className={`h-8 rounded-md px-3 text-xs font-semibold ${
                    viewMode === item.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600
                         focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              {STATS_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {viewMode === "sheet" ? (
          <div className="mt-3 divide-y divide-slate-100">
            {sortedWordStats.slice(0, 12).map((item) => (
              <div key={`${item.word_id}-${item.word}`} className="grid gap-3 py-3 sm:grid-cols-[1fr_9rem_8rem] sm:items-center">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{item.word || "-"}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.attempt_count}회 풀이 · 오답 {item.incorrect_count}회 · {sortLabel}
                  </p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>정답률</span>
                    <span>{percent(item.accuracy)}</span>
                  </div>
                  <ProgressMeter value={item.accuracy} />
                </div>
                <p className="text-xs text-slate-500 sm:text-right">
                  최근 {String(item.last_quiz_at || "").slice(0, 10) || "-"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="전체 결과"
              description="채점 결과의 비중을 한눈에 확인합니다."
              legend={resultDistribution.map((item) => (
                <ChartLegendItem key={item.name} color={item.color} label={item.name} />
              ))}
            >
              <div className="relative h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={resultDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={64}
                      outerRadius={96}
                      paddingAngle={4}
                      stroke="#ffffff"
                      strokeWidth={4}
                    >
                      {resultDistribution.map((item) => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-2xl font-semibold text-slate-900">
                      {percent(summary.accuracy)}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-500">평균 정답률</p>
                  </div>
                </div>
              </div>
            </ChartCard>

            <ChartCard
              title="유형별 정답률"
              description="문제 유형별로 약한 영역을 비교합니다."
              legend={<ChartLegendItem color={CHART_COLORS.accuracy} label="정답률" />}
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={typeChartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="accuracy" name="정답률" fill={CHART_COLORS.accuracy} radius={[7, 7, 0, 0]} barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="취약 단어"
              description={`현재 정렬 기준: ${sortLabel}`}
              legend={
                <>
                  <ChartLegendItem color={CHART_COLORS.incorrectRate} label="오답률" />
                  <ChartLegendItem color={CHART_COLORS.accuracy} label="정답률" />
                </>
              }
            >
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={wordChartData}
                    layout="vertical"
                    margin={{ top: 8, right: 20, left: 20, bottom: 0 }}
                    barGap={6}
                  >
                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={88}
                      tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="incorrectRate" name="오답률" fill={CHART_COLORS.incorrectRate} radius={[0, 7, 7, 0]} barSize={12} />
                    <Bar dataKey="accuracy" name="정답률" fill={CHART_COLORS.accuracy} radius={[0, 7, 7, 0]} barSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>
        )}
      </section>

      {viewMode === "sheet" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
            <h4 className="text-sm font-semibold text-slate-800">유형별 성과</h4>
            <div className="mt-3 space-y-3">
              {typeStats.map((item) => (
                <div key={item.question_type}>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>{questionTypeLabel(item.question_type)}</span>
                    <span>{percent(item.accuracy)} · {item.attempt_count}회</span>
                  </div>
                  <ProgressMeter value={item.accuracy} />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
            <h4 className="text-sm font-semibold text-slate-800">최근 오답</h4>
            <div className="mt-3 space-y-3">
              {recentIncorrect.length === 0 ? (
                <p className="text-sm text-slate-500">최근 오답이 없습니다.</p>
              ) : (
                recentIncorrect.map((item, index) => (
                  <div key={`${item.word_id}-${item.created_at}-${index}`} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-800">{item.word || item.target_word}</p>
                      <span className="text-xs text-slate-400">
                        {String(item.created_at || "").slice(0, 10)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.prompt}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
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
      queryClient.invalidateQueries({ queryKey: ["word-saved"] });
    },
  });

  const genLoading = generateMutation.isPending;
  const gradeLoading = gradeMutation.isPending;
  const applyReviewLoading = applyReviewScheduleMutation.isPending;
  const answeredCount = Object.keys(answers).length;
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
    if (
      applyReviewLoading ||
      !gradeResult?.session_id ||
      gradeResult.review_schedule_applied
    ) {
      return;
    }
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

  return (
    <div>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">AI 어휘 과제</h3>
        <p className="text-sm text-slate-500">
          목표를 정하면 저장한 단어와 파생어를 섞어 난이도별 퀴즈를 생성합니다.
        </p>
      </div>

      {!user && <MemberNotice feature="퀴즈" onRequireLogin={onRequireLogin} />}

      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {[
          { id: "practice", label: "문제 풀기" },
          { id: "stats", label: "학습 통계" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveView(item.id)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              activeView === item.id
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {activeView === "stats" ? (
        user ? (
          <QuizStatsPanel statsQuery={statsQuery} />
        ) : (
          <div className="mt-4">
            <EmptyState
              title="로그인이 필요합니다"
              description="로그인하면 퀴즈 학습 통계를 확인할 수 있어요."
            />
          </div>
        )
      ) : (
        <>
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
          <span className="mb-1 block text-sm font-medium text-slate-600">추가 출제 요청</span>
          <textarea
            rows={3}
            value={goal.instruction}
            onChange={(e) => setGoalValue("instruction", e.target.value)}
            placeholder="예: 헷갈리는 파생어를 포함하고, 문맥을 보고 고르는 문제를 많이 넣어줘."
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </label>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            단순 뜻맞추기부터 문맥 빈칸, 주관식까지 섞어 출제합니다.
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

      {(generateMutation.error ||
        gradeMutation.error ||
        applyReviewScheduleMutation.error ||
        saveSuggestionMutation.error) && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {(
            generateMutation.error ||
            gradeMutation.error ||
            applyReviewScheduleMutation.error ||
            saveSuggestionMutation.error
          ).message}
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
                    {question.is_related && !question.is_derived && (
                      <span className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700">
                        관련어
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
                    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <p className="mb-1 font-semibold text-slate-800">예문</p>
                      <p>{question.passage}</p>
                    </div>
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
                            틀린 문제의 단어 {result.suggested_word}를 단어장에 추가할까요?
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
                {incorrectReviewWords.length > 0 && (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          틀린 단어 {incorrectReviewWords.length}개를 언제 다시 복습할까요?
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {incorrectReviewWords.map((item) => item.word).join(", ")}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          value={reviewInterval}
                          onChange={(e) => setReviewInterval(e.target.value)}
                          disabled={gradeResult.review_schedule_applied || applyReviewLoading}
                          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm
                                     focus:outline-none focus:ring-2 focus:ring-brand-200
                                     disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {REVIEW_INTERVAL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={applyReviewSchedule}
                          disabled={
                            applyReviewLoading ||
                            gradeResult.review_schedule_applied ||
                            !gradeResult.session_id
                          }
                          className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white
                                     hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {gradeResult.review_schedule_applied
                            ? "저장됨"
                            : applyReviewLoading
                              ? "저장 중"
                              : "복습일 저장"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
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
        </>
      )}
    </div>
  );
}
