import { useMemo, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
import { EmptyState, LoadingSpinner } from "@/components/AsyncState";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const TYPE_LABELS = {
  meaning_choice: "뜻/단어",
  context_choice: "문맥 빈칸",
  short_answer: "단답형",
  sentence_answer: "문장형",
};
const SAVED_GRAMMAR_BLANK_CHOICE_ALIASES = new Set([["to" + "eic", "part5"].join("_")]);
const CHOICE_IDS = ["A", "B", "C", "D"];

const STATS_SORT_OPTIONS = [
  { value: "incorrect", label: "오답 많은 순" },
  { value: "accuracy_asc", label: "정답률 낮은 순" },
  { value: "recent", label: "최근 풀이 순" },
  { value: "attempts", label: "풀이 많은 순" },
  { value: "word", label: "단어 A-Z" },
];

const CHART_COLORS = {
  correct: "#10b981", // emerald-500
  partial: "#f59e0b", // amber-500
  incorrect: "#ef4444", // red-500
  accuracy: "#6366f1", // indigo-500 (brand)
  incorrectRate: "#fda4af", // rose-300
  grid: "#f1f5f9",
  axis: "#94a3b8",
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

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
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
    <div className="rounded-xl border border-slate-100 bg-white p-3 text-xs shadow-lg">
      {label && <p className="mb-1.5 font-bold text-slate-800">{label}</p>}
      <div className="space-y-1">
        {payload.map((item) => (
          <p key={item.dataKey || item.name} className="text-slate-600 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="font-medium text-slate-500">{item.name}</span>:{" "}
            <span className="font-bold text-slate-800">
              {formatChartValue(item.value, item.dataKey)}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function ChartCard({ title, description, children, legend }) {
  return (
    <Card className="shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-slate-100/85 rounded-2xl overflow-hidden">
      <CardHeader className="p-4.5 pb-2.5 border-b border-slate-50 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-sm font-bold text-slate-800">{title}</CardTitle>
          {description && <CardDescription className="text-xs mt-0.5">{description}</CardDescription>}
        </div>
        {legend && <div className="flex flex-wrap gap-2">{legend}</div>}
      </CardHeader>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

function ChartLegendItem({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
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

export default function QuizStatsPanel({ statsQuery }) {
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
      <div className="mt-4 p-8 border rounded-2xl bg-white flex justify-center">
        <LoadingSpinner label="학습 통계를 불러오는 중" />
      </div>
    );
  }

  if (statsQuery.error) {
    return (
      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 px-4 py-3 text-xs font-semibold text-rose-700">
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
    <div className="space-y-5 animate-fadeIn select-none">
      {/* 1. 핵심 요약 대시보드 카드 */}
      <Card className="shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-slate-100/80 rounded-2xl overflow-hidden">
        <CardContent className="p-5 grid gap-4 grid-cols-2 md:grid-cols-4">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">총 풀이 횟수</span>
            <p className="text-xl font-extrabold text-slate-800">{summary.attempt_count || 0}회</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">평균 정답률</span>
            <p className="text-xl font-extrabold text-green-600">{percent(summary.accuracy)}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">평균 오답률</span>
            <p className="text-xl font-extrabold text-rose-500">{percent(summary.incorrect_rate)}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">집중 관리 단어</span>
            <p className="text-xl font-extrabold text-amber-500">{summary.incorrect_word_count || 0}개</p>
          </div>
        </CardContent>
      </Card>

      {/* 2. 조절 툴바 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mt-4">
        <h4 className="text-sm font-bold text-slate-800">📊 퀴즈 성과 및 오답 통계</h4>
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* 목록/차트 토글 */}
          <div className="flex rounded-xl border border-slate-200/80 bg-white p-0.5 w-full sm:w-auto justify-center">
            {[
              { id: "sheet", label: "리스트 보기" },
              { id: "chart", label: "차트 분석" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setViewMode(item.id)}
                className={`h-8 rounded-lg px-4 text-xs font-semibold transition-all ${
                  viewMode === item.id
                    ? "bg-slate-900 text-white dark:bg-slate-800"
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
            className="h-9 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 outline-none hover:border-slate-300"
          >
            {STATS_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 3. 본문 뷰분기 (리스트형 vs 차트형) */}
      {viewMode === "sheet" ? (
        <div className="grid gap-5 md:grid-cols-3">
          {/* 단어별 리스트 */}
          <Card className="md:col-span-2 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-slate-100 rounded-2xl overflow-hidden p-5 space-y-3">
            <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b pb-2">단어 성과 현황</h5>
            <ScrollArea className="h-[350px] pr-2">
              <div className="divide-y divide-slate-100">
                {sortedWordStats.slice(0, 15).map((item) => (
                  <div key={`${item.word_id}-${item.word}`} className="flex flex-col sm:flex-row justify-between sm:items-center py-3 gap-2">
                    <div className="space-y-0.5">
                      <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200">{item.word || "-"}</p>
                      <p className="text-[10px] text-slate-400 font-semibold">
                        {item.attempt_count}회 중 오답 {item.incorrect_count}회 · {sortLabel}
                      </p>
                    </div>
                    <div className="w-full sm:w-36 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold">
                        <span>정답률</span>
                        <span>{percent(item.accuracy)}</span>
                      </div>
                      <Progress value={Math.round((item.accuracy || 0) * 100)} className="h-1.5" />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>

          {/* 유형별 및 최근 오답 */}
          <div className="space-y-5">
            <Card className="shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-slate-100 rounded-2xl p-5 space-y-3">
              <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b pb-2">유형별 성과</h5>
              <div className="space-y-3.5 pt-1">
                {typeStats.map((item) => (
                  <div key={item.question_type} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                      <span>{questionTypeLabel(item.question_type)}</span>
                      <span>{percent(item.accuracy)} ({item.attempt_count}회)</span>
                    </div>
                    <Progress value={Math.round((item.accuracy || 0) * 100)} className="h-1.5 bg-slate-100" />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-slate-100 rounded-2xl p-5 space-y-3">
              <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b pb-2">최근 오답 노트</h5>
              <ScrollArea className="h-[180px]">
                <div className="space-y-3 pt-1">
                  {recentIncorrect.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">오답 기록이 아직 없습니다.</p>
                  ) : (
                    recentIncorrect.slice(0, 5).map((item, index) => (
                      <div key={`${item.word_id}-${item.created_at}-${index}`} className="text-xs border-b pb-2.5 last:border-0 last:pb-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-extrabold text-slate-800 dark:text-slate-200">{item.word || item.target_word}</p>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {String(item.created_at || "").slice(2, 10)}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-[11px] text-slate-400 leading-normal bg-slate-50 dark:bg-slate-900 p-1.5 rounded-lg border border-slate-100">
                          {item.prompt}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </Card>
          </div>
        </div>
      ) : (
        /* 차트형 뷰 */
        <div className="grid gap-5 md:grid-cols-2">
          {/* 전체 정답 비율 */}
          <ChartCard
            title="전체 결과 분포"
            description="채점 결과(정답/오답/부분정답) 비율을 확인합니다."
            legend={resultDistribution.map((item) => (
              <ChartLegendItem key={item.name} color={item.color} label={item.name} />
            ))}
          >
            <div className="relative h-60">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={resultDistribution}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={4}
                    stroke="none"
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
                  <p className="text-xl font-extrabold text-slate-800">
                    {percent(summary.accuracy)}
                  </p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">평균 정답률</p>
                </div>
              </div>
            </div>
          </ChartCard>

          {/* 유형별 정답률 */}
          <ChartCard
            title="유형별 정답률 비교"
            description="다양한 퀴즈 유형 중 오답률이 높은 취약 영역입니다."
            legend={<ChartLegendItem color={CHART_COLORS.accuracy} label="정답률" />}
          >
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeChartData} margin={{ top: 8, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: CHART_COLORS.axis }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="accuracy" name="정답률" fill={CHART_COLORS.accuracy} radius={[6, 6, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* 취약 단어 (상위 10개) */}
          <ChartCard
            title="취약/관리 단어 정밀 비교 (Top 10)"
            description={`정렬 기준: ${sortLabel}`}
            legend={
              <div className="flex gap-3">
                <ChartLegendItem color={CHART_COLORS.incorrectRate} label="오답률" />
                <ChartLegendItem color={CHART_COLORS.accuracy} label="정답률" />
              </div>
            }
          >
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={wordChartData}
                  layout="vertical"
                  margin={{ top: 8, right: 10, left: 10, bottom: 0 }}
                  barGap={4}
                >
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={80}
                    tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="incorrectRate" name="오답률" fill={CHART_COLORS.incorrectRate} radius={[0, 6, 6, 0]} barSize={10} />
                  <Bar dataKey="accuracy" name="정답률" fill={CHART_COLORS.accuracy} radius={[0, 6, 6, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
