import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Database,
  Download,
  Home,
  Loader2,
  MessageSquare,
  Newspaper,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import DataTable, { SortableHeader } from "../components/DataTable";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const ADMIN_TOP_TABS = [
  { id: "learners", label: "사용자" },
  { id: "usage", label: "API 사용량" },
  { id: "articles", label: "뉴스 자료" },
  { id: "inquiries", label: "사용자 문의", disabled: true },
];

const ADMIN_TAB_ROUTES = {
  learners: "/admin/learners",
  usage: "/admin/api-usage",
  articles: "/admin/articles",
};

function getAdminTabFromPath(pathname) {
  if (pathname === "/admin" || pathname === "/admin/") return "learners";
  if (pathname.startsWith("/admin/api-usage")) return "usage";
  if (pathname.startsWith("/admin/learners")) return "learners";
  if (pathname.startsWith("/admin/articles")) return "articles";
  return null;
}

const FEATURE_COLORS = {
  dictionary: "#14b8a6",
  translate: "#ef4444",
  tts: "#f97316",
  slang: "#8b5cf6",
  quiz: "#eab308",
  roleplay: "#7c3aed",
  article: "#22c55e",
};

const FEATURE_LABELS = {
  dictionary: "단어 검색",
  translate: "번역",
  tts: "TTS",
  slang: "슬랭",
  quiz: "퀴즈",
  roleplay: "롤플레잉",
  article: "뉴스 분석",
};

const EMPTY_ARTICLE_FORM = {
  source: "",
  title: "",
  url: "",
  image_url: "",
  topic: "",
  level: "B1",
  description: "",
  content: "",
  is_published: false,
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function number(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function money(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function compactDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function nextDateString(value) {
  const date = parseDateOnly(value);
  return date ? formatDateOnly(addDays(date, 1)) : "";
}

function inclusiveDayCount(startValue, endValue) {
  const start = parseDateOnly(startValue);
  const end = parseDateOnly(endValue);
  if (!start || !end) return 1;
  const diff = Math.abs(end.getTime() - start.getTime());
  return Math.floor(diff / 86_400_000) + 1;
}

function DisabledAction({ children, icon: Icon }) {
  return (
    <Button type="button" variant="outline" disabled className="h-9 gap-2 text-xs">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </Button>
  );
}

function AdminGate({ user, onRequireLogin }) {
  if (!user) {
    return (
      <Card className="mx-auto mt-16 max-w-md rounded-md">
        <CardContent className="space-y-4 p-6 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-slate-400" />
          <div>
            <h2 className="text-lg font-bold text-slate-950">로그인이 필요합니다</h2>
            <p className="mt-1 text-sm text-slate-500">관리자 페이지는 로그인 후 접근할 수 있습니다.</p>
          </div>
          <Button type="button" onClick={onRequireLogin}>로그인</Button>
        </CardContent>
      </Card>
    );
  }
  if (!user.is_superuser) {
    return (
      <Card className="mx-auto mt-16 max-w-md rounded-md">
        <CardContent className="space-y-3 p-6 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
          <h2 className="text-lg font-bold text-slate-950">관리자 권한이 필요합니다</h2>
          <p className="text-sm text-slate-500">현재 계정에는 관리자 메뉴 접근 권한이 없습니다.</p>
        </CardContent>
      </Card>
    );
  }
  return null;
}

function AdminSideItem({ icon: Icon, label, active, count, danger, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-10 w-full items-center gap-2 border-l-2 px-3 text-left text-[13px] font-semibold transition-colors",
        active
          ? "border-[#0f8b83] bg-[#e7f3ef] text-[#08766e]"
          : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-950",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span className={cn("text-xs tabular-nums", danger ? "text-rose-500" : "text-slate-400")}>
          {count}
        </span>
      )}
    </button>
  );
}

function AdminSidebar({ tab, setTab, onExit }) {
  return (
    <aside className="flex h-full w-[214px] shrink-0 flex-col border-r border-slate-200 bg-[#fbfbfa]">
      <div className="border-b border-slate-200 px-4 py-4">
        <p className="text-base font-black tracking-normal text-slate-950">ADMIN PAGE</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">관리자 페이지</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <div className="px-3 pb-2 text-xs font-bold text-slate-400">주요 화면</div>
        <AdminSideItem icon={Users} label="사용자 관리" active={tab === "learners"} onClick={() => setTab("learners")} />
        <AdminSideItem icon={BarChart3} label="API 사용량 및 비용" active={tab === "usage"} onClick={() => setTab("usage")} />
        <AdminSideItem icon={Newspaper} label="뉴스 자료 관리" active={tab === "articles"} onClick={() => setTab("articles")} />
        <AdminSideItem icon={MessageSquare} label="사용자 문의" disabled />

        <div className="mt-5 border-t border-slate-200 pt-3">
          <div className="px-3 pb-2 text-xs font-bold text-slate-400">시스템</div>
          <AdminSideItem icon={Settings2} label="정책 / 권한" disabled />
        </div>
      </div>

      <div className="border-t border-slate-200 p-3">
        <Button type="button" variant="outline" onClick={onExit} className="h-9 w-full justify-start gap-2 rounded-md text-xs">
          <Home className="h-4 w-4" />
          학습앱으로 돌아가기
        </Button>
      </div>
    </aside>
  );
}

function MiniStat({ label, value, helper, tone = "default" }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={cn("mt-2 text-2xl font-black tracking-normal", tone === "danger" ? "text-rose-600" : "text-slate-950")}>
        {value}
      </p>
      {helper && <p className="mt-1 text-xs text-slate-400">{helper}</p>}
    </div>
  );
}

function UsageChart({ rows, groupBy = "hour", startDate = "", endDate = "" }) {
  const buckets = useMemo(() => {
    const out = new Map();
    const ensureBucket = (bucket) => {
      if (!out.has(bucket)) out.set(bucket, { bucket, total: 0, items: [] });
      return out.get(bucket);
    };
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (start && end && start < end) {
      if (groupBy === "hour") {
        for (let hour = 0; hour < 24; hour += 1) {
          ensureBucket(`${formatDateOnly(start)} ${String(hour).padStart(2, "0")}:00`);
        }
      } else if (groupBy === "month") {
        for (let cursor = new Date(start.getFullYear(), start.getMonth(), 1); cursor < end; cursor = addMonths(cursor, 1)) {
          ensureBucket(`${formatDateOnly(cursor)} 00:00`);
        }
      } else {
        for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) {
          ensureBucket(`${formatDateOnly(cursor)} 00:00`);
        }
      }
    }
    for (const row of rows || []) {
      const bucket = row.bucket || "";
      const entry = ensureBucket(bucket);
      const count = Number(row.request_count || 0);
      entry.total += count;
      entry.items.push({ feature: row.feature, count });
    }
    return [...out.values()];
  }, [rows, groupBy, startDate, endDate]);

  const max = Math.max(1, ...buckets.map((item) => item.total));
  if (buckets.length === 0) {
    return <EmptyState title="사용량 데이터가 없습니다" description="선택한 기간에 기록된 API 사용량이 없습니다." />;
  }
  const bucketLabel = (bucket) => {
    if (groupBy === "hour") return bucket.slice(11, 16) || bucket;
    if (groupBy === "month") return bucket.slice(0, 7) || bucket;
    return bucket.slice(5, 10) || bucket;
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-950">기간별 API 사용량</h3>
          <p className="mt-1 text-xs text-slate-500">요청 수 기준, 기능별 누적 막대</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {Object.entries(FEATURE_LABELS).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: FEATURE_COLORS[key] || "#64748b" }} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex h-56 items-end gap-2 overflow-x-auto border-b border-slate-200 pb-3">
        {buckets.map((bucket) => (
          <div key={bucket.bucket} className="flex min-w-8 flex-1 flex-col items-center gap-2">
            <div className="flex h-44 w-full items-end">
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm border border-slate-200 bg-slate-50"
                style={{ height: `${Math.max(5, (bucket.total / max) * 100)}%` }}
                title={`${bucket.bucket} · ${number(bucket.total)}건`}
              >
                {bucket.items.map((item) => (
                  <div
                    key={`${bucket.bucket}-${item.feature}`}
                    style={{
                      height: `${bucket.total ? (item.count / bucket.total) * 100 : 0}%`,
                      backgroundColor: FEATURE_COLORS[item.feature] || "#64748b",
                    }}
                  />
                ))}
                {bucket.total === 0 && <div className="h-full bg-slate-100" />}
              </div>
            </div>
            <span className="text-[10px] text-slate-400">{bucketLabel(bucket.bucket)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiUsageTab({ enabled }) {
  const today = todayString();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [range, setRange] = useState("day");
  const selectedDays = inclusiveDayCount(startDate, endDate);
  const groupBy = selectedDays <= 1 ? "hour" : selectedDays > 120 ? "month" : "day";
  const usageQuery = useQuery({
    queryKey: queryKeys.adminApiUsage("", startDate, endDate, groupBy, range),
    queryFn: () => api.adminApiUsage({ startDate, endDate, groupBy, range }),
    enabled,
  });
  const data = usageQuery.data || {};
  const rows = data.rows || [];
  const anomalies = data.anomalies || [];
  const summary = data.summary || {};
  const rangeOptions = [
    ["day", "1일"],
    ["week", "1주"],
    ["month", "1달"],
    ["year", "1년"],
  ];
  const usageColumns = useMemo(() => [
    {
      accessorKey: "label",
      header: ({ column }) => <SortableHeader column={column}>기능</SortableHeader>,
      cell: ({ row }) => <span className="font-semibold text-slate-800">{row.original.label}</span>,
    },
    {
      id: "provider_model",
      accessorFn: (row) => `${row.provider || ""} ${row.model || ""}`,
      header: ({ column }) => <SortableHeader column={column}>모델 / 외부 API</SortableHeader>,
      cell: ({ row }) => (
        <span className="text-slate-500">
          {row.original.provider || "-"} {row.original.model ? `/ ${row.original.model}` : ""}
        </span>
      ),
    },
    {
      accessorKey: "request_count",
      header: ({ column }) => <div className="text-right"><SortableHeader column={column} align="right">요청 수</SortableHeader></div>,
      cell: ({ row }) => <div className="text-right tabular-nums">{number(row.original.request_count)}</div>,
    },
    {
      accessorKey: "total_tokens",
      header: ({ column }) => <div className="text-right"><SortableHeader column={column} align="right">토큰</SortableHeader></div>,
      cell: ({ row }) => <div className="text-right tabular-nums">{number(row.original.total_tokens)}</div>,
    },
    {
      accessorKey: "failure_rate",
      header: ({ column }) => <div className="text-right"><SortableHeader column={column} align="right">실패율</SortableHeader></div>,
      cell: ({ row }) => (
        <div className={cn("text-right tabular-nums", row.original.failure_rate > 0 ? "text-rose-600" : "text-slate-500")}>
          {percent(row.original.failure_rate)}
        </div>
      ),
    },
    {
      accessorKey: "estimated_cost_usd",
      header: ({ column }) => <div className="text-right"><SortableHeader column={column} align="right">비용(USD)</SortableHeader></div>,
      cell: ({ row }) => <div className="text-right tabular-nums">{money(row.original.estimated_cost_usd)}</div>,
    },
    {
      id: "status",
      accessorFn: (row) => (row.failure_rate > 0 ? "주의" : "정상"),
      header: "상태",
      cell: ({ row }) => (
        <div className="text-center">
          <Badge className={cn("border", row.original.failure_rate > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
            {row.original.failure_rate > 0 ? "주의" : "정상"}
          </Badge>
        </div>
      ),
    },
  ], []);
  const applyQuickRange = (value) => {
    const end = parseDateOnly(endDate) || parseDateOnly(todayString());
    const days = {
      day: 1,
      week: 7,
      month: 30,
      year: 365,
    }[value] || 1;
    setRange(value);
    setStartDate(formatDateOnly(addDays(end, -(days - 1))));
    setEndDate(formatDateOnly(end));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black tracking-normal text-slate-950">API 사용량 및 비용</h2>
            <p className="mt-1 text-sm text-slate-500">기능별 호출량, 실패율, 추정 비용을 확인합니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-slate-200 bg-white p-1">
              {rangeOptions.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => applyQuickRange(value)}
                  className={cn(
                    "h-8 rounded px-3 text-xs font-bold transition-colors",
                    range === value ? "bg-[#168f86] text-white" : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  {label}
                </button>
              ))}
              {range === "custom" && (
                <span className="inline-flex h-8 items-center rounded bg-slate-100 px-3 text-xs font-bold text-slate-600">
                  사용자 지정
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
              시작일
              <Input
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setRange("custom");
                }}
                className="h-10 w-40"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
              종료일
              <Input
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setRange("custom");
                }}
                className="h-10 w-40"
              />
            </label>
            <Button type="button" variant="outline" onClick={() => usageQuery.refetch()} disabled={usageQuery.isFetching}>
              {usageQuery.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              새로고침
            </Button>
          </div>
        </div>

        {usageQuery.isError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            API 사용량을 불러오지 못했습니다: {usageQuery.error.message}
          </div>
        )}
        {data.used_latest_available && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            선택한 날짜({data.requested_date})에 기록이 없어, 실제 최신 기록일({data.date}) 데이터를 표시합니다.
          </div>
        )}
        {data.start_date && data.end_date && (
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            조회 기간: {data.start_date}부터 {data.end_date_inclusive || endDate}까지
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <MiniStat label="선택 기간 요청 수" value={number(summary.request_count)} helper="로그인 사용자 기준 기록" />
          <MiniStat label="실패 요청" value={number(summary.failed_count)} helper="success=false 이벤트" tone={summary.failed_count ? "danger" : "default"} />
          <MiniStat label="추정 비용" value={money(summary.estimated_cost_usd)} helper="토큰/문자 기반 임시 산식" />
        </div>

        {usageQuery.isPending ? (
          <SkeletonBlock className="h-80 rounded-md" />
        ) : (
          <UsageChart
            rows={data.hourly || []}
            groupBy={data.group_by || groupBy}
            startDate={data.start_date || startDate}
            endDate={data.end_date || nextDateString(endDate)}
          />
        )}

        <div className="rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-extrabold text-slate-950">API 비용 및 사용 내역</h3>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled>
                <Download className="h-4 w-4" />
                CSV 다운로드
              </Button>
            </div>
          </div>
          <div className="p-4">
            <DataTable
              columns={usageColumns}
              data={rows}
              loading={usageQuery.isPending}
              emptyTitle="사용 내역이 없습니다"
              emptyDescription="선택한 기간에 저장된 API 이벤트가 없습니다."
              enablePagination
              pageSize={10}
              minWidth="min-w-[960px]"
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-extrabold text-slate-950">이상 징후 감지</h3>
            <div className="mt-3 space-y-2">
              {anomalies.map((item) => (
                <div key={`${item.feature}-${item.operation}-${item.provider}`} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 py-2 text-sm last:border-0">
                  <span className="font-semibold text-slate-700">{item.label}</span>
                  <span className="text-rose-600">{number(item.failed_count)}건 실패</span>
                </div>
              ))}
              {anomalies.length === 0 && <p className="py-4 text-sm text-slate-400">감지된 실패 이벤트가 없습니다.</p>}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-extrabold text-slate-950">기능별 라우팅 - 제공자 매핑</h3>
            <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
              {[
                ["단어 검색", "Dictionary API", "-"],
                ["퀴즈 생성/채점", "WatsonX", "Ollama fallback"],
                ["롤플레잉", "WatsonX", "Ollama fallback"],
                ["뉴스 분석", "WatsonX", "-"],
                ["TTS", "Gemini TTS", "브라우저 음성 fallback"],
                ["번역", "Google Translate", "-"],
              ].map((item) => (
                <div key={item[0]} className="grid grid-cols-3 border-b border-slate-100 px-3 py-2 text-xs last:border-0">
                  <span className="font-semibold text-slate-700">{item[0]}</span>
                  <span className="text-slate-500">{item[1]}</span>
                  <span className="text-slate-400">{item[2]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className="rounded-md border border-slate-200 bg-white p-4 xl:sticky xl:top-4 xl:h-fit">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-[#168f86]" />
          <h3 className="text-sm font-extrabold text-slate-950">쿼터 / 정책 현황</h3>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          정책 조회/저장 API가 아직 연결되지 않았습니다. 혼동을 막기 위해 임의 쿼터 수치는 표시하지 않습니다.
        </div>
        <Button type="button" disabled className="mt-4 w-full bg-[#168f86]">
          변경 사항 저장
        </Button>
        <p className="mt-2 text-xs text-slate-400">현재는 정책 수치가 고정되어 있습니다.</p>
      </aside>
    </div>
  );
}

function LearnersTab({ enabled }) {
  const pageSize = 20;
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const learnersQuery = useQuery({
    queryKey: queryKeys.adminLearners(q, "", page, pageSize),
    queryFn: () => api.adminLearners({ q, page, pageSize }),
    enabled,
  });
  const learners = learnersQuery.data?.learners || [];

  useEffect(() => {
    if (learners.length === 0) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (!selectedId || !learners.some((learner) => learner.learner_ref === selectedId)) {
      setSelectedId(learners[0].learner_ref);
    }
  }, [learners, selectedId]);

  const detailQuery = useQuery({
    queryKey: queryKeys.adminLearnerDetail(selectedId),
    queryFn: () => api.adminLearnerDetail(selectedId),
    enabled: enabled && !!selectedId,
  });
  const selected = learners.find((item) => item.learner_ref === selectedId) || learners[0];
  const detail = detailQuery.data || {};
  const apiUsage = detail.api_usage || {};
  const apiUsageSummary = apiUsage.summary || {};
  const learnerColumns = useMemo(() => [
    {
      accessorKey: "email",
      header: ({ column }) => <SortableHeader column={column}>이메일</SortableHeader>,
      cell: ({ row }) => <span className="font-bold text-slate-900">{row.original.email}</span>,
    },
    {
      id: "status",
      accessorFn: (row) => (row.is_superuser ? "관리자" : row.is_active ? "활성" : "비활성"),
      header: ({ column }) => <SortableHeader column={column}>상태</SortableHeader>,
      cell: ({ row }) => (
        <Badge className={cn(
          "border",
          row.original.is_superuser
            ? "border-sky-200 bg-sky-50 text-sky-700"
            : row.original.is_active
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-500"
        )}>
          {row.original.is_superuser ? "관리자" : row.original.is_active ? "활성" : "비활성"}
        </Badge>
      ),
    },
    {
      accessorKey: "last_seen_at",
      header: ({ column }) => <SortableHeader column={column}>마지막 활동</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-500">{compactDate(row.original.last_seen_at)}</span>,
    },
    {
      accessorKey: "word_count",
      header: ({ column }) => <div className="text-right"><SortableHeader column={column} align="right">저장 단어</SortableHeader></div>,
      cell: ({ row }) => <div className="text-right tabular-nums">{number(row.original.word_count)}</div>,
    },
    {
      accessorKey: "total_api_calls",
      header: ({ column }) => <div className="text-right"><SortableHeader column={column} align="right">총 API 호출</SortableHeader></div>,
      cell: ({ row }) => <div className="text-right tabular-nums">{number(row.original.total_api_calls)}</div>,
    },
    {
      accessorKey: "today_api_calls",
      header: ({ column }) => <div className="text-right"><SortableHeader column={column} align="right">오늘 API 호출</SortableHeader></div>,
      cell: ({ row }) => <div className="text-right tabular-nums">{number(row.original.today_api_calls)}</div>,
    },
    {
      accessorKey: "week_api_calls",
      header: ({ column }) => <div className="text-right"><SortableHeader column={column} align="right">이번 주 API 호출</SortableHeader></div>,
      cell: ({ row }) => <div className="text-right tabular-nums">{number(row.original.week_api_calls)}</div>,
    },
    {
      accessorKey: "last_api_at",
      header: ({ column }) => <SortableHeader column={column}>마지막 API</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-500">{compactDate(row.original.last_api_at)}</span>,
    },
  ], []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <div>
          <h2 className="text-2xl font-black tracking-normal text-slate-950">학습자 관리</h2>
          <p className="mt-1 text-sm text-slate-500">사용자별 학습 활동과 API 사용량을 실제 DB 집계 기준으로 확인합니다.</p>
        </div>

        {learnersQuery.isError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            학습자 목록을 불러오지 못했습니다: {learnersQuery.error.message}
          </div>
        )}

        <div className="rounded-md border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <span className="text-sm font-bold text-slate-600">총 {number(learnersQuery.data?.total)}명</span>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setQ(qInput.trim());
                setPage(1);
              }}
              className="relative w-full sm:w-80"
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={qInput} onChange={(event) => setQInput(event.target.value)} placeholder="이메일 검색" className="h-10 pl-9" />
            </form>
          </div>
          <div className="p-4">
            <DataTable
              columns={learnerColumns}
              data={learners}
              loading={learnersQuery.isPending}
              emptyTitle="학습자가 없습니다"
              emptyDescription="검색 조건에 맞는 학습자가 없습니다."
              minWidth="min-w-[1040px]"
              onRowClick={(learner) => setSelectedId(learner.learner_ref)}
              rowClassName={(learner) => selectedId === learner.learner_ref && "bg-[#e7f3ef]/60"}
            />
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
            <span>
              {number(learnersQuery.data?.total)}명 중{" "}
              {learners.length > 0 ? number((page - 1) * pageSize + 1) : 0}-
              {number((page - 1) * pageSize + learners.length)} 표시
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1 || learnersQuery.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}>이전</Button>
              <span>{page}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!learnersQuery.data || page * pageSize >= learnersQuery.data.total || learnersQuery.isFetching}
                onClick={() => setPage((value) => value + 1)}
              >
                다음
              </Button>
            </div>
          </div>
        </div>
      </div>

      <aside className="rounded-md border border-slate-200 bg-white xl:sticky xl:top-4 xl:h-fit">
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-black text-slate-950">{selected?.email || "학습자 선택"}</h3>
            <p className="mt-1 text-xs text-slate-400">{selected ? "학습자 상세" : "행을 선택하면 상세가 표시됩니다."}</p>
          </div>
          <UserCog className="h-5 w-5 text-slate-400" />
        </div>
        {!selected ? (
          <div className="p-4">
            <EmptyState title="선택된 학습자가 없습니다" />
          </div>
        ) : (
          <div className="space-y-5 p-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-400">저장 단어 수</p>
                <p className="mt-1 text-lg font-black">{number(selected.word_count)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">총 API 호출</p>
                <p className="mt-1 text-lg font-black">{number(selected.total_api_calls)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">오늘 API 호출</p>
                <p className="mt-1 text-lg font-black">{number(selected.today_api_calls)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">이번 주 API 호출</p>
                <p className="mt-1 text-lg font-black">{number(selected.week_api_calls)}</p>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h4 className="text-sm font-extrabold text-slate-950">API 사용량</h4>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="text-slate-400">오늘</p>
                  <p className="mt-1 text-base font-black text-slate-900">{number(apiUsageSummary.today_count)}</p>
                </div>
                <div>
                  <p className="text-slate-400">7일</p>
                  <p className="mt-1 text-base font-black text-slate-900">{number(apiUsageSummary.week_count)}</p>
                </div>
                <div>
                  <p className="text-slate-400">30일</p>
                  <p className="mt-1 text-base font-black text-slate-900">{number(apiUsageSummary.month_count)}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(apiUsage.by_feature || []).slice(0, 5).map((item) => (
                  <div key={item.feature} className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">{item.label}</span>
                    <span className="tabular-nums text-slate-500">{number(item.request_count)}</span>
                  </div>
                ))}
                {!detailQuery.isPending && (!apiUsage.by_feature || apiUsage.by_feature.length === 0) && (
                  <p className="text-xs text-slate-400">최근 30일 API 사용 기록이 없습니다.</p>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-400">마지막 사용: {compactDate(apiUsageSummary.last_used_at)}</p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-extrabold text-slate-950">태그</h4>
                <Button type="button" variant="ghost" size="icon" disabled className="h-7 w-7">
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(detail.tags || []).map((tag) => (
                  <Badge key={tag.tag || "미지정"} variant="outline" className="bg-slate-50">
                    {tag.tag || "미지정"} {tag.count}
                  </Badge>
                ))}
                {!detailQuery.isPending && (!detail.tags || detail.tags.length === 0) && <span className="text-sm text-slate-400">태그 없음</span>}
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-extrabold text-slate-950">이벤트 히스토리</h4>
              <div className="space-y-2">
                {detailQuery.isPending && <LoadingSpinner />}
                {(detail.events || []).slice(0, 8).map((event, index) => (
                  <div key={`${event.type}-${index}`} className="grid grid-cols-[68px_1fr] gap-3 text-xs">
                    <span className="text-slate-400">{compactDate(event.created_at)}</span>
                    <div>
                      <p className="font-bold text-slate-700">{event.type}</p>
                      <p className="truncate text-slate-500">{event.title} {event.detail ? `· ${event.detail}` : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <DisabledAction icon={Send}>알림 보내기</DisabledAction>
              <DisabledAction icon={RotateCcw}>복습 리셋</DisabledAction>
              <DisabledAction icon={UserCog}>계정 확인</DisabledAction>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function ArticlesTab({ enabled }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [feedSourceKey, setFeedSourceKey] = useState("");
  const [refreshJobId, setRefreshJobId] = useState("");
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [articleForm, setArticleForm] = useState(EMPTY_ARTICLE_FORM);
  const [editArticleId, setEditArticleId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_ARTICLE_FORM);
  const editHydrationRef = useRef({ articleId: null, hydrated: false, dirty: false });

  const articlesQuery = useQuery({
    queryKey: queryKeys.articleAdminList(page),
    queryFn: () => api.articleAdminList(page),
    enabled,
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.articleSources,
    queryFn: api.articleSources,
    enabled,
  });
  const editDetailQuery = useQuery({
    queryKey: queryKeys.articleAdminDetail(editArticleId || ""),
    queryFn: () => api.articleAdminDetail(editArticleId),
    enabled: enabled && !!editArticleId,
  });
  const refreshJobQuery = useQuery({
    queryKey: queryKeys.articleRefreshJob(refreshJobId),
    queryFn: () => api.articleAdminFeedRefreshStatus(refreshJobId),
    enabled: enabled && !!refreshJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1000 : false;
    },
  });
  const refreshMutation = useMutation({
    mutationFn: (payload) => api.articleAdminFeedRefresh(payload),
    onSuccess: (data) => {
      if (data?.job_id) {
        setRefreshJobId(data.job_id);
        queryClient.setQueryData(queryKeys.articleRefreshJob(data.job_id), data);
      }
    },
  });
  const publishMutation = useMutation({
    mutationFn: ({ id, isPublished }) => api.articleAdminPublish(id, isPublished),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles", "admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["articles", "catalog"] });
    },
  });
  const createMutation = useMutation({
    mutationFn: (payload) => api.articleAdminCreate(payload),
    onSuccess: () => {
      setCreateOpen(false);
      setArticleForm(EMPTY_ARTICLE_FORM);
      setDetailOpen(false);
      setEditArticleId(null);
      setEditForm(EMPTY_ARTICLE_FORM);
      editHydrationRef.current = { articleId: null, hydrated: false, dirty: false };
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["articles", "admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["articles", "catalog"] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => api.articleAdminUpdate(id, payload),
    onSuccess: () => {
      setEditArticleId(null);
      setEditForm(EMPTY_ARTICLE_FORM);
      editHydrationRef.current = { articleId: null, hydrated: false, dirty: false };
      queryClient.invalidateQueries({ queryKey: ["articles", "admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["articles", "admin-detail"] });
      queryClient.invalidateQueries({ queryKey: ["articles", "catalog"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.articleSessions });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => api.articleAdminDelete(id),
    onSuccess: () => {
      setSelectedId(null);
      setDetailOpen(false);
      setEditArticleId(null);
      setEditForm(EMPTY_ARTICLE_FORM);
      editHydrationRef.current = { articleId: null, hydrated: false, dirty: false };
      queryClient.invalidateQueries({ queryKey: ["articles", "admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["articles", "admin-detail"] });
      queryClient.invalidateQueries({ queryKey: ["articles", "catalog"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.articleSessions });
    },
  });

  const articles = articlesQuery.data?.articles || [];
  const selected = articles.find((item) => item.id === selectedId) || null;
  const job = refreshJobQuery.data || refreshMutation.data;
  const progress = job?.total_sources ? Math.round((Number(job.completed_sources || 0) / Number(job.total_sources || 1)) * 100) : 0;

  useEffect(() => {
    const visibleIds = new Set(articles.map((article) => article.id));
    if (selectedId && !visibleIds.has(selectedId)) {
      setSelectedId(null);
      setDetailOpen(false);
    }
  }, [articles, selectedId]);

  useEffect(() => {
    const detail = editDetailQuery.data;
    if (!detail || !editArticleId) return;
    if (editHydrationRef.current.articleId !== editArticleId) {
      editHydrationRef.current = { articleId: editArticleId, hydrated: false, dirty: false };
    }
    if (editHydrationRef.current.hydrated || editHydrationRef.current.dirty) return;
    setEditForm({
      source: detail.source || "",
      title: detail.title || "",
      url: detail.url || "",
      image_url: detail.image_url || "",
      topic: detail.topic || "",
      level: detail.level || "B1",
      description: detail.description || "",
      content: (detail.chunks || []).map((chunk) => chunk.text).join("\n\n") || detail.content_snippet || "",
      is_published: Boolean(detail.is_published),
    });
    editHydrationRef.current.hydrated = true;
  }, [editDetailQuery.data, editArticleId]);

  useEffect(() => {
    if (!job || (job.status !== "completed" && job.status !== "failed")) return;
    queryClient.invalidateQueries({ queryKey: ["articles", "admin-list"] });
    queryClient.invalidateQueries({ queryKey: ["articles", "catalog"] });
  }, [job?.status, job?.job_id, queryClient]);

  const refreshSourceOptions = (sourcesQuery.data?.sources || []).filter((source) => source.license_status === "approved" && source.feed_url);
  const selectedRefreshSource = refreshSourceOptions.find((source) => source.key === feedSourceKey);
  const canCreateArticle = Boolean(
    articleForm.source.trim() &&
    articleForm.title.trim() &&
    articleForm.url.trim() &&
    articleForm.content.trim()
  );
  const updateArticleForm = (key, value) => {
    setArticleForm((form) => ({ ...form, [key]: value }));
  };
  const updateEditForm = (key, value) => {
    editHydrationRef.current.dirty = true;
    setEditForm((form) => ({ ...form, [key]: value }));
  };
  const submitArticleCreate = (event) => {
    event.preventDefault();
    if (!canCreateArticle || createMutation.isPending) return;
    createMutation.mutate({
      ...articleForm,
      topic: articleForm.topic.trim() || "General",
    });
  };
  const canUpdateArticle = Boolean(
    editForm.source.trim() &&
    editForm.title.trim() &&
    editForm.url.trim() &&
    editForm.content.trim()
  );
  const submitArticleUpdate = (event) => {
    event.preventDefault();
    if (!editArticleId || !canUpdateArticle || updateMutation.isPending) return;
    updateMutation.mutate({ id: editArticleId, payload: editForm });
  };
  const openEditArticle = (article) => {
    if (!article?.id) return;
    setCreateOpen(false);
    setDetailOpen(false);
    setSelectedId(article.id);
    setEditArticleId(article.id);
    editHydrationRef.current = { articleId: article.id, hydrated: false, dirty: false };
    setEditForm({
      source: article.source || "",
      title: article.title || "",
      url: article.url || "",
      image_url: article.image_url || "",
      topic: article.topic || "",
      level: article.level || "B1",
      description: article.description || "",
      content: article.content_snippet || article.description || "",
      is_published: Boolean(article.is_published),
    });
  };
  const openArticleDetail = (article) => {
    if (!article?.id) return;
    setCreateOpen(false);
    setEditArticleId(null);
    setEditForm(EMPTY_ARTICLE_FORM);
    editHydrationRef.current = { articleId: null, hydrated: false, dirty: false };
    setSelectedId(article.id);
    setDetailOpen(true);
  };
  const requestDeleteArticle = (article) => {
    if (!article?.id || deleteMutation.isPending) return;
    if (window.confirm("이 뉴스 자료와 관련 학습 세션을 삭제할까요?")) {
      deleteMutation.mutate(article.id);
    }
  };
  const startArticleRefresh = () => {
    setRefreshConfirmOpen(false);
    refreshMutation.mutate({ source_key: feedSourceKey, publish: true, max_items: 1 });
  };
  const articleColumns = useMemo(() => [
    {
      accessorKey: "title",
      header: ({ column }) => <SortableHeader column={column}>제목</SortableHeader>,
      cell: ({ row }) => (
        <span className="block max-w-[360px] truncate font-bold text-slate-900">
          {row.original.title}
        </span>
      ),
    },
    {
      id: "source",
      accessorFn: (row) => row.source || row.source_key || "",
      header: ({ column }) => <SortableHeader column={column}>출처</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-600">{row.original.source || row.original.source_key || "-"}</span>,
    },
    {
      accessorKey: "topic",
      header: ({ column }) => <SortableHeader column={column}>주제</SortableHeader>,
      cell: ({ row }) => <Badge variant="outline">{row.original.topic || "-"}</Badge>,
    },
    {
      accessorKey: "level",
      header: ({ column }) => <SortableHeader column={column}>레벨</SortableHeader>,
      cell: ({ row }) => <span>{row.original.level || "-"}</span>,
    },
    {
      accessorKey: "is_published",
      header: "공개 여부",
      cell: ({ row }) => (
        <div className="text-center">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              publishMutation.mutate({ id: row.original.id, isPublished: !row.original.is_published });
            }}
            disabled={publishMutation.isPending}
            className={cn(
              "inline-flex h-6 w-12 items-center rounded-full border p-0.5 transition",
              row.original.is_published ? "justify-end border-emerald-200 bg-emerald-500" : "justify-start border-slate-200 bg-slate-200"
            )}
            aria-label="공개 상태 변경"
          >
            <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
          </button>
        </div>
      ),
    },
    {
      accessorKey: "updated_at",
      header: ({ column }) => <SortableHeader column={column}>최종 업데이트</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-500">{compactDate(row.original.updated_at)}</span>,
    },
    {
      id: "status",
      accessorFn: (row) => row.extraction_status || row.collection_method || "",
      header: ({ column }) => <SortableHeader column={column}>상태</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-500">{row.original.extraction_status || row.original.collection_method || "-"}</span>,
    },
    {
      id: "actions",
      header: () => <div className="text-right">작업</div>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="편집"
            aria-label={`${row.original.title} 편집`}
            onClick={(event) => {
              event.stopPropagation();
              openEditArticle(row.original);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            title="삭제"
            aria-label={`${row.original.title} 삭제`}
            disabled={deleteMutation.isPending}
            onClick={(event) => {
              event.stopPropagation();
              requestDeleteArticle(row.original);
            }}
          >
            {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      ),
    },
  ], [deleteMutation.isPending, publishMutation.isPending]);

  return (
    <div className="grid gap-4">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black tracking-normal text-slate-950">뉴스 자료</h2>
            <p className="mt-1 text-sm text-slate-500">수집된 뉴스 리딩 자료를 검수하고 공개 상태를 관리합니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={feedSourceKey} onChange={(event) => setFeedSourceKey(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
              <option value="">전체 소스</option>
              {refreshSourceOptions.map((source) => (
                <option key={source.key} value={source.key}>{source.name}</option>
              ))}
            </select>
            <Button type="button" onClick={() => setRefreshConfirmOpen(true)} disabled={refreshMutation.isPending}>
              {refreshMutation.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              뉴스 자료 가져오기
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreateOpen((open) => {
                  const next = !open;
                  if (next) {
                    setDetailOpen(false);
                    setEditArticleId(null);
                    setEditForm(EMPTY_ARTICLE_FORM);
                    editHydrationRef.current = { articleId: null, hydrated: false, dirty: false };
                  }
                  return next;
                });
              }}
            >
              + 새 자료 추가
            </Button>
          </div>
        </div>

        {refreshConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div className="w-full max-w-md rounded-md border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-base font-black text-slate-950">뉴스 자료 가져오기</h3>
                <p className="mt-1 text-sm text-slate-500">선택한 RSS 소스에서 새 뉴스 리딩 자료를 수집합니다.</p>
              </div>
              <div className="space-y-3 px-5 py-4 text-sm text-slate-600">
                <div className="rounded-md bg-slate-50 p-3">
                  <p><span className="font-bold text-slate-800">대상 소스:</span> {selectedRefreshSource?.name || "전체 승인된 소스"}</p>
                  <p className="mt-1"><span className="font-bold text-slate-800">가져올 개수:</span> 소스별 최대 1개</p>
                  <p className="mt-1"><span className="font-bold text-slate-800">공개 상태:</span> 가져온 자료는 공개 상태로 저장</p>
                </div>
                <p>확인을 누르면 백그라운드 작업이 시작되고, 진행률은 목록 위 상태 영역에 표시됩니다.</p>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
                <Button type="button" variant="outline" onClick={() => setRefreshConfirmOpen(false)}>
                  취소
                </Button>
                <Button type="button" className="bg-[#168f86]" onClick={startArticleRefresh} disabled={refreshMutation.isPending}>
                  {refreshMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  확인
                </Button>
              </div>
            </div>
          </div>
        )}

        {createOpen && (
          <form onSubmit={submitArticleCreate} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-slate-950">새 뉴스 자료 추가</h3>
                <p className="mt-1 text-sm text-slate-500">직접 확보한 기사 본문을 뉴스 리딩 자료로 등록합니다.</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCreateOpen(false);
                  setArticleForm(EMPTY_ARTICLE_FORM);
                }}
              >
                닫기
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-bold text-slate-700">
                <span>소스</span>
                <Input value={articleForm.source} onChange={(event) => updateArticleForm("source", event.target.value)} placeholder="예: BBC, CNN, 직접 작성" required />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700">
                <span>레벨</span>
                <Input value={articleForm.level} onChange={(event) => updateArticleForm("level", event.target.value)} placeholder="예: A2, B1, Intermediate" />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700 md:col-span-2">
                <span>제목</span>
                <Input value={articleForm.title} onChange={(event) => updateArticleForm("title", event.target.value)} required />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700 md:col-span-2">
                <span>원본 URL</span>
                <Input type="url" value={articleForm.url} onChange={(event) => updateArticleForm("url", event.target.value)} required />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700">
                <span>주제</span>
                <Input value={articleForm.topic} onChange={(event) => updateArticleForm("topic", event.target.value)} placeholder="예: Business" />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700">
                <span>이미지 URL</span>
                <Input type="url" value={articleForm.image_url} onChange={(event) => updateArticleForm("image_url", event.target.value)} />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700 md:col-span-2">
                <span>요약</span>
                <Textarea value={articleForm.description} onChange={(event) => updateArticleForm("description", event.target.value)} className="min-h-20" />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700 md:col-span-2">
                <span>본문</span>
                <Textarea value={articleForm.content} onChange={(event) => updateArticleForm("content", event.target.value)} className="min-h-40" required />
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={articleForm.is_published}
                  onChange={(event) => updateArticleForm("is_published", event.target.checked)}
                />
                저장 후 바로 공개
              </label>
            </div>

            {createMutation.isError && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                자료 저장 실패: {createMutation.error.message}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setArticleForm(EMPTY_ARTICLE_FORM)}
                disabled={createMutation.isPending}
              >
                초기화
              </Button>
              <Button type="submit" disabled={!canCreateArticle || createMutation.isPending} className="bg-[#168f86]">
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                저장
              </Button>
            </div>
          </form>
        )}

        {editArticleId && (
          <form onSubmit={submitArticleUpdate} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-slate-950">뉴스 자료 편집</h3>
                <p className="mt-1 text-sm text-slate-500">선택한 자료의 메타데이터와 본문을 수정합니다.</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditArticleId(null);
                  setEditForm(EMPTY_ARTICLE_FORM);
                  editHydrationRef.current = { articleId: null, hydrated: false, dirty: false };
                }}
              >
                닫기
              </Button>
            </div>

            {editDetailQuery.isPending && (
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                상세 본문을 불러오는 중입니다.
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-bold text-slate-700">
                <span>소스</span>
                <Input value={editForm.source} onChange={(event) => updateEditForm("source", event.target.value)} required />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700">
                <span>레벨</span>
                <Input value={editForm.level} onChange={(event) => updateEditForm("level", event.target.value)} placeholder="예: A2, B1, Intermediate" />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700 md:col-span-2">
                <span>제목</span>
                <Input value={editForm.title} onChange={(event) => updateEditForm("title", event.target.value)} required />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700 md:col-span-2">
                <span>원본 URL</span>
                <Input type="url" value={editForm.url} onChange={(event) => updateEditForm("url", event.target.value)} required />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700">
                <span>주제</span>
                <Input value={editForm.topic} onChange={(event) => updateEditForm("topic", event.target.value)} />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700">
                <span>이미지 URL</span>
                <Input type="url" value={editForm.image_url} onChange={(event) => updateEditForm("image_url", event.target.value)} />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700 md:col-span-2">
                <span>요약</span>
                <Textarea value={editForm.description} onChange={(event) => updateEditForm("description", event.target.value)} className="min-h-20" />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700 md:col-span-2">
                <span>본문</span>
                <Textarea value={editForm.content} onChange={(event) => updateEditForm("content", event.target.value)} className="min-h-40" required />
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={editForm.is_published}
                  onChange={(event) => updateEditForm("is_published", event.target.checked)}
                />
                공개
              </label>
            </div>

            {updateMutation.isError && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                자료 수정 실패: {updateMutation.error.message}
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                disabled={deleteMutation.isPending || updateMutation.isPending}
                onClick={() => requestDeleteArticle({ id: editArticleId })}
              >
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                삭제
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openEditArticle(selected)}
                  disabled={!selected || updateMutation.isPending || editDetailQuery.isPending}
                >
                  되돌리기
                </Button>
                <Button type="submit" disabled={!canUpdateArticle || updateMutation.isPending} className="bg-[#168f86]">
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  저장
                </Button>
              </div>
            </div>

            {deleteMutation.isError && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                자료 삭제 실패: {deleteMutation.error.message}
              </div>
            )}
          </form>
        )}

        {job && (
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-bold text-slate-800">
                {job.status === "completed" ? "업데이트 완료" : job.status === "failed" ? "업데이트 실패" : job.message || "업데이트 진행 중"}
              </span>
              <span className="text-slate-500">{number(job.completed_sources)} / {number(job.total_sources)} · 저장 {number(job.saved)}</span>
            </div>
            <Progress value={job.status === "completed" ? 100 : progress} />
            {job.error && <p className="mt-2 text-xs text-rose-600">{job.error}</p>}
          </div>
        )}

        <div className="rounded-md border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <span className="text-sm font-bold text-slate-600">자료 목록</span>
            <span className="text-xs text-slate-400">공개 상태는 행의 토글로 변경합니다.</span>
          </div>
          <div className="p-4">
            <DataTable
              columns={articleColumns}
              data={articles}
              loading={articlesQuery.isPending}
              emptyTitle="뉴스 자료가 없습니다"
              minWidth="min-w-[1120px]"
              onRowClick={openArticleDetail}
              rowClassName={(article) => selected?.id === article.id && "bg-[#e7f3ef]/60"}
            />
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
            <span>{number(articlesQuery.data?.total)}개 중 {number((page - 1) * 30 + 1)}-{number((page - 1) * 30 + articles.length)} 표시</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>이전</Button>
              <span>{page}</span>
              <Button type="button" variant="outline" size="sm" disabled={!articlesQuery.data || page * 30 >= articlesQuery.data.total} onClick={() => setPage((value) => value + 1)}>다음</Button>
            </div>
          </div>
        </div>

        <Drawer open={detailOpen && !!selected} onOpenChange={setDetailOpen} direction="right">
          <DrawerContent side="right" className="w-[min(92vw,520px)]">
            {selected && (
              <>
                <DrawerHeader className="border-b border-slate-200 text-left">
                  <DrawerTitle className="leading-6">{selected.title}</DrawerTitle>
                  <DrawerDescription>
                    {selected.source || selected.source_key || "-"} · {selected.topic || "-"} · {selected.level || "-"}
                  </DrawerDescription>
                </DrawerHeader>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="grid grid-cols-[92px_1fr] gap-y-3 text-sm">
                    <p className="text-slate-400">원본 URL</p>
                    <a href={selected.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[#08766e] hover:underline">{selected.url}</a>
                    <p className="text-slate-400">공개 상태</p>
                    <p>{selected.is_published ? "공개" : "비공개"}</p>
                    <p className="text-slate-400">수집 방법</p>
                    <p>{selected.collection_method || "-"}</p>
                    <p className="text-slate-400">언어/상태</p>
                    <p>{selected.license_status || "-"} / {selected.extraction_status || "-"}</p>
                    <p className="text-slate-400">요약</p>
                    <p className="leading-6 text-slate-600">{selected.description || "요약 정보가 없습니다."}</p>
                  </div>

                  <div className="mt-6">
                    <div className="mb-2 flex items-center gap-2">
                      <Database className="h-4 w-4 text-[#168f86]" />
                      <h3 className="text-sm font-extrabold text-slate-950">업데이트 히스토리</h3>
                    </div>
                    <div className="overflow-hidden rounded-md border border-slate-200 text-xs">
                      {[
                        ["내용 갱신", compactDate(selected.updated_at), selected.extraction_status || "정상"],
                        ["초기 수집", compactDate(selected.created_at), selected.collection_method || "manual"],
                        ["공개 상태", compactDate(selected.updated_at), selected.is_published ? "공개됨" : "비공개"],
                      ].map((item) => (
                        <div key={item[0]} className="grid grid-cols-[92px_1fr_88px] border-b border-slate-100 px-3 py-2 last:border-0">
                          <span className="font-bold text-slate-700">{item[0]}</span>
                          <span className="text-slate-500">{item[1]}</span>
                          <span className="text-slate-500">{item[2]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DrawerFooter className="border-t border-slate-200">
                  <div className="grid grid-cols-3 gap-2">
                    <Button type="button" className="col-span-1 bg-[#168f86]" onClick={() => openEditArticle(selected)}>
                      <Pencil className="h-4 w-4" />
                      편집
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="col-span-1 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      disabled={deleteMutation.isPending}
                      onClick={() => requestDeleteArticle(selected)}
                    >
                      {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      삭제
                    </Button>
                    <DrawerClose asChild>
                      <Button type="button" variant="outline" className="col-span-1">닫기</Button>
                    </DrawerClose>
                  </div>
                </DrawerFooter>
              </>
            )}
          </DrawerContent>
        </Drawer>
      </div>

    </div>
  );
}

export default function AdminPage({ user, onRequireLogin, onExit }) {
  const location = useLocation();
  const navigate = useNavigate();
  const resolvedTab = getAdminTabFromPath(location.pathname);
  const tab = resolvedTab || "learners";
  const enabled = Boolean(user?.is_superuser);
  const setTab = (nextTab) => {
    const nextPath = ADMIN_TAB_ROUTES[nextTab];
    if (nextPath) navigate(nextPath);
  };

  useEffect(() => {
    if (location.pathname === "/admin" || location.pathname === "/admin/" || !resolvedTab) {
      navigate("/admin/learners", { replace: true });
    }
  }, [location.pathname, navigate, resolvedTab]);

  if (!enabled) return <AdminGate user={user} onRequireLogin={onRequireLogin} />;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white text-slate-900">
      <AdminSidebar tab={tab} setTab={setTab} onExit={onExit} />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          <nav className="flex h-full items-center gap-7">
            {ADMIN_TOP_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => !item.disabled && setTab(item.id)}
                className={cn(
                  "relative h-full text-[15px] font-black transition-colors",
                  tab === item.id ? "text-slate-950" : "text-slate-500 hover:text-slate-800",
                  item.disabled && "cursor-not-allowed opacity-40"
                )}
              >
                {item.label}
                {tab === item.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0f8b83]" />
                )}
              </button>
            ))}
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
          {tab === "usage" && <ApiUsageTab enabled={enabled} />}
          {tab === "learners" && <LearnersTab enabled={enabled} />}
          {tab === "articles" && <ArticlesTab enabled={enabled} />}
        </div>
      </section>
    </div>
  );
}
