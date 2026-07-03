import { useMemo } from "react";
import { CalendarDays, Loader2, Tag } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Scatter,
  ScatterChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DataTable, { SortableHeader } from "@/components/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingSpinner } from "@/components/AsyncState";
import { cn } from "@/lib/utils";

const TYPE_LABELS = {
  meaning_choice: "뜻/단어",
  context_choice: "문맥 빈칸",
  short_answer: "단답형",
  sentence_answer: "문장형 영작",
};

const SAVED_GRAMMAR_BLANK_CHOICE_ALIASES = new Set([["to" + "eic", "part5"].join("_")]);

function normalizeQuestionType(type) {
  if (SAVED_GRAMMAR_BLANK_CHOICE_ALIASES.has(type) || type === "grammar_blank_choice") {
    return "context_choice";
  }
  return type;
}

function questionTypeLabel(type) {
  return TYPE_LABELS[normalizeQuestionType(type)] || type || "기타";
}

function percent(value) {
  return Math.round(Number(value || 0) * 100);
}

function formatPercent(value) {
  return `${percent(value)}%`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  return `${date.toISOString().slice(0, 10)} ${date.toTimeString().slice(0, 5)}`;
}

const RANGE_OPTIONS = [
  { value: "week", label: "1주", days: 7 },
  { value: "month", label: "1달", days: 30 },
  { value: "quarter", label: "3달", days: 90 },
];

function parseDateOnly(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function todayString() {
  return formatDateOnly(new Date());
}

function formatRangeText(range) {
  const start = String(range?.startDate || "").replaceAll("-", ".");
  const end = String(range?.endDate || "").replaceAll("-", ".");
  const preset = RANGE_OPTIONS.find((item) => item.value === range?.preset);
  return `${start || "-"}  ~  ${end || "-"}${preset ? `  (${preset.label})` : ""}`;
}

function sortPriorityWords(items) {
  return [...items]
    .filter((item) => Number(item.attempt_count || 0) > 0)
    .sort((a, b) => {
      const aIncorrect = Number(a.incorrect_count || 0);
      const bIncorrect = Number(b.incorrect_count || 0);
      if (bIncorrect !== aIncorrect) return bIncorrect - aIncorrect;
      return Number(a.accuracy || 0) - Number(b.accuracy || 0);
    });
}

function ChartCard({ title, description, children }) {
  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-base font-black text-slate-950">{title}</h3>
        {description && <p className="mt-1 text-sm font-medium text-slate-500">{description}</p>}
      </div>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

function ReportRangeControl({ range, onRangeChange, loading }) {
  const applyQuickRange = (option) => {
    const end = parseDateOnly(range?.endDate) || parseDateOnly(todayString()) || new Date();
    onRangeChange?.({
      preset: option.value,
      startDate: formatDateOnly(addDays(end, -(option.days - 1))),
      endDate: formatDateOnly(end),
    });
  };

  const setDate = (key, value) => {
    onRangeChange?.({
      ...range,
      preset: "custom",
      [key]: value,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border border-slate-200 bg-white p-1">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => applyQuickRange(option)}
            className={cn(
              "h-8 rounded px-3 text-xs font-bold transition-colors",
              range?.preset === option.value ? "bg-[#0f766e] text-white" : "text-slate-500 hover:bg-slate-50",
            )}
          >
            {option.label}
          </button>
        ))}
        {range?.preset === "custom" && (
          <span className="inline-flex h-8 items-center rounded bg-slate-100 px-3 text-xs font-bold text-slate-600">
            사용자 지정
          </span>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
        시작일
        <Input
          type="date"
          value={range?.startDate || ""}
          onChange={(event) => setDate("startDate", event.target.value)}
          className="h-10 w-40"
        />
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
        종료일
        <Input
          type="date"
          value={range?.endDate || ""}
          onChange={(event) => setDate("endDate", event.target.value)}
          className="h-10 w-40"
        />
      </label>
      {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
    </div>
  );
}

function ReportHeader({ range, onRangeChange, loading }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 className="text-2xl font-black tracking-normal text-slate-950">리포트</h2>
        <p className="mt-2 text-sm font-medium text-slate-600">
          학습 성과와 복습이 필요한 내용을 확인하세요.
        </p>
        <p className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-slate-500">
          <CalendarDays className="h-4 w-4" />
          {formatRangeText(range)}
        </p>
      </div>
      <ReportRangeControl range={range} onRangeChange={onRangeChange} loading={loading} />
    </div>
  );
}

function MostMissedWordsChart({ data }) {
  return (
    <ChartContainer>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 18, left: 14, bottom: 0 }}>
          <CartesianGrid stroke="#e5e7eb" vertical={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
          <YAxis type="category" dataKey="word" width={92} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#334155" }} />
          <Tooltip content={<ChartTooltipContent formatter={(value) => `${Number(value || 0).toLocaleString()}회`} />} />
          <Bar dataKey="incorrect" name="오답" fill="#e11d48" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function HighIncorrectRateWordsChart({ data }) {
  return (
    <ChartContainer>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 18, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#e5e7eb" vertical={false} />
          <XAxis
            type="number"
            dataKey="attempts"
            name="풀이"
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
          />
          <YAxis
            type="number"
            dataKey="incorrectRate"
            name="오답률"
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const item = payload[0]?.payload || {};
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                  <p className="font-black text-slate-900">{item.word}</p>
                  <p className="mt-1 font-medium text-slate-500">오답률 {item.incorrectRate}%</p>
                  <p className="font-medium text-slate-500">풀이 {item.attempts}회 · 오답 {item.incorrect}회</p>
                </div>
              );
            }}
          />
          <Scatter name="단어" data={data} fill="#f59e0b" />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function PriorityWordsDataTable({ items }) {
  const columns = useMemo(
    () => [
      {
        id: "rank",
        header: "번호",
        cell: ({ row }) => <span className="font-black text-slate-950">{row.index + 1}</span>,
      },
      {
        accessorKey: "word",
        header: ({ column }) => <SortableHeader column={column}>단어</SortableHeader>,
        cell: ({ row }) => <span className="font-semibold text-slate-950">{row.original.word || "-"}</span>,
      },
      {
        accessorKey: "korean",
        header: "뜻",
        cell: ({ row }) => (
          <span className="block max-w-[240px] truncate text-slate-600">{row.original.korean || "-"}</span>
        ),
      },
      {
        accessorKey: "tag",
        header: ({ column }) => <SortableHeader column={column}>태그</SortableHeader>,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0b6b49]">
            <Tag className="h-3.5 w-3.5 fill-[#0b6b49]/10" />
            {row.original.tag || "일반"}
          </span>
        ),
      },
      {
        accessorKey: "accuracy",
        header: ({ column }) => <SortableHeader column={column}>정답률</SortableHeader>,
        cell: ({ row }) => (
          <span className="font-black text-slate-800">{formatPercent(row.original.accuracy)}</span>
        ),
      },
      {
        accessorKey: "incorrect_count",
        header: ({ column }) => <SortableHeader column={column}>오답 횟수</SortableHeader>,
        cell: ({ row }) => <span>{row.original.incorrect_count || 0}회</span>,
      },
      {
        accessorKey: "attempt_count",
        header: ({ column }) => <SortableHeader column={column}>풀이</SortableHeader>,
        cell: ({ row }) => <span>{row.original.attempt_count || 0}회</span>,
      },
      {
        accessorKey: "last_quiz_at",
        header: "최근 풀이",
        cell: ({ row }) => <span>{formatDate(row.original.last_quiz_at)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="p-5">
      <DataTable
        columns={columns}
        data={items}
        emptyTitle="복습 우선순위가 없습니다"
        emptyDescription="오답 횟수가 많은 단어부터 표시됩니다."
        searchColumn="word"
        searchPlaceholder="단어 검색"
        showSearch
        enablePagination
        pageSize={10}
        minWidth="min-w-[820px]"
      />
    </div>
  );
}

function RecentQuizHistory({ sessions, onOpenSession, openingSessionId }) {
  if (!sessions.length) {
    return (
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardContent className="p-5 text-sm font-medium text-slate-500">
          최근 완료한 퀴즈 기록이 없습니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-lg font-black text-slate-950">최근 퀴즈 히스토리</h3>
      </div>
      <CardContent className="p-0">
        <div className="divide-y divide-slate-100">
          {sessions.map((session) => {
            const total = Number(session.total_questions || session.question_count || 0);
            const score = Number(session.score || 0);
            const accuracy = total ? Math.round((score / total) * 100) : 0;
            const completedAt = session.completed_at || session.created_at;
            const title = `${formatDateTime(completedAt)} 퀴즈`;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onOpenSession?.(session.id)}
                className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-[#fbfaf5] sm:grid-cols-[1fr_auto_auto] sm:items-center"
              >
                <div>
                  <p className="text-sm font-black text-slate-950">
                    {title}
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    {session.tag ? `${session.tag} · ` : ""}{total || "-"}문항 완료
                  </p>
                </div>
                <span className="text-sm font-bold text-slate-600">
                  {score.toFixed(1)} / {total || "-"}
                </span>
                <span className="flex items-center justify-end gap-2">
                  {openingSessionId === session.id && (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  )}
                  <span className="text-lg font-black text-slate-800">{accuracy}%</span>
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function QuizStatsPanel({ statsQuery, range, onRangeChange, onOpenSession, openingSessionId }) {
  const data = statsQuery.data || {};
  const summary = data.summary || {};
  const wordStats = data.word_stats || [];
  const recentSessions = data.recent_sessions || [];
  const hasStats = Number(summary.attempt_count || 0) > 0;

  if (statsQuery.isPending) {
    return (
      <div className="animate-fadeIn space-y-5 select-none">
        <ReportHeader range={range} onRangeChange={onRangeChange} loading />
        <div className="flex justify-center rounded-lg border border-slate-200 bg-white p-8">
          <LoadingSpinner label="학습 통계를 불러오는 중" />
        </div>
      </div>
    );
  }

  if (statsQuery.error) {
    return (
      <div className="animate-fadeIn space-y-5 select-none">
        <ReportHeader range={range} onRangeChange={onRangeChange} loading={statsQuery.isFetching} />
        <div className="rounded-lg border border-rose-200 bg-rose-50/70 px-4 py-3 text-xs font-semibold text-rose-700">
          {statsQuery.error.message}
        </div>
      </div>
    );
  }

  if (!hasStats) {
    return (
      <div className="animate-fadeIn space-y-5 select-none">
        <ReportHeader range={range} onRangeChange={onRangeChange} loading={statsQuery.isFetching} />
        <EmptyState
          title="선택한 기간의 학습 통계가 없습니다"
          description="기간을 넓히거나 퀴즈를 풀고 채점하면 풀이 데이터를 볼 수 있습니다."
        />
      </div>
    );
  }

  const priorityWords = sortPriorityWords(wordStats);
  const missedWordChartData = priorityWords
    .filter((item) => Number(item.incorrect_count || 0) > 0)
    .slice(0, 8)
    .map((item) => ({
      word: item.word || "-",
      incorrect: Number(item.incorrect_count || 0),
    }));
  const highIncorrectRateData = [...wordStats]
    .filter((item) => Number(item.attempt_count || 0) > 0 && Number(item.incorrect_count || 0) > 0)
    .sort((a, b) => Number(b.incorrect_rate || 0) - Number(a.incorrect_rate || 0))
    .slice(0, 12)
    .map((item) => ({
      word: item.word || "-",
      attempts: Number(item.attempt_count || 0),
      incorrect: Number(item.incorrect_count || 0),
      incorrectRate: percent(item.incorrect_rate),
    }));

  return (
    <div className="animate-fadeIn space-y-5 select-none">
      <ReportHeader range={range} onRangeChange={onRangeChange} loading={statsQuery.isFetching} />

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="가장 많이 틀린 단어" description="오답 횟수가 높은 단어부터 보여줍니다.">
          <MostMissedWordsChart data={missedWordChartData} />
        </ChartCard>
        <ChartCard title="오답률 높은 단어" description="풀이 횟수 대비 자주 틀리는 단어입니다.">
          <HighIncorrectRateWordsChart data={highIncorrectRateData} />
        </ChartCard>
      </div>

      <Card className="overflow-hidden rounded-lg border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-black text-slate-950">단어별 통계</h3>
          </div>
        </div>

        <PriorityWordsDataTable items={priorityWords} />
      </Card>

      <RecentQuizHistory
        sessions={recentSessions}
        onOpenSession={onOpenSession}
        openingSessionId={openingSessionId}
      />
    </div>
  );
}
