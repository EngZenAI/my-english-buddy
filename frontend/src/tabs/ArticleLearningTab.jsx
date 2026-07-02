import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Highlighter,
  Loader2,
  PanelRightOpen,
  RefreshCw,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import AudioButton from "../components/AudioButton";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const TOPICS = [
  { value: "", label: "전체" },
  { value: "world", label: "World" },
  { value: "business", label: "Business" },
  { value: "entertainment", label: "Entertainment" },
  { value: "health", label: "Health" },
  { value: "education", label: "Education" },
  { value: "technology", label: "Tech" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "sports", label: "Sports" },
];

const FONT_STEPS = [
  { label: "작게", className: "text-sm leading-7" },
  { label: "보통", className: "text-base leading-8" },
  { label: "크게", className: "text-lg leading-9" },
];

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function shortHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function articleImageUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("ichef.bbci.co.uk")) {
      parsed.pathname = parsed.pathname.replace(/\/standard\/\d{2,4}\//, "/standard/976/");
      return parsed.toString();
    }
    if (parsed.hostname.endsWith("i.guim.co.uk") && parsed.searchParams.has("width")) {
      parsed.searchParams.set("width", "1000");
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function hasStudy(study) {
  return Array.isArray(study?.paragraphs) && study.paragraphs.length > 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, expressions, enabled }) {
  const words = expressions
    .map((item) => (item.word || "").trim())
    .filter((word) => word.length >= 3);

  if (!enabled || words.length === 0 || !text) return text;

  const pattern = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).map((part, index) => {
    const matched = words.some((word) => word.toLowerCase() === part.toLowerCase());
    if (!matched) return <span key={`${part}-${index}`}>{part}</span>;
    return (
      <mark key={`${part}-${index}`} className="rounded bg-amber-100 px-1 py-0.5 text-slate-950">
        {part}
      </mark>
    );
  });
}

function TopicPill({ item, selected, onClick }) {
  return (
    <Button
      type="button"
      variant={selected ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className={cn(
        "rounded-full px-4 font-semibold",
        selected
          ? "border-brand-700 bg-brand-900 text-white hover:bg-brand-800"
          : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800"
      )}
    >
      {item.label}
    </Button>
  );
}

function ArticleListItem({ article, active, pending, onPreview, onStart }) {
  return (
    <Card
      className={cn(
        "group overflow-hidden rounded-md border bg-white shadow-none transition hover:border-brand-300 hover:shadow-sm",
        active && "border-brand-600 ring-2 ring-brand-100"
      )}
    >
      <div className="flex gap-3 p-3">
        <button
          type="button"
          onClick={onPreview}
          className="relative h-24 w-32 shrink-0 overflow-hidden rounded-md bg-slate-100 text-left"
          aria-label={`${article.title} 미리보기`}
        >
          {article.image_url ? (
            <img
              src={articleImageUrl(article.image_url)}
              alt=""
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-brand-50 text-brand-700">
              <BookOpen className="h-8 w-8" />
            </div>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {article.topic && <span className="text-xs font-semibold text-brand-700">{article.topic}</span>}
            <span className="shrink-0 text-xs text-slate-400">{formatDate(article.published_at || article.created_at)}</span>
          </div>
          <button type="button" onClick={onPreview} className="mt-1 block w-full text-left">
            <p className="line-clamp-2 text-sm font-bold leading-5 text-slate-950">{article.title}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{article.source || shortHost(article.url)}</p>
          </button>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" asChild className="h-8 flex-1 border-brand-200 text-brand-800 hover:bg-brand-50">
              <a href={article.url} target="_blank" rel="noreferrer">
                원문
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onStart}
              disabled={pending}
              className="h-8 flex-1 bg-brand-700 hover:bg-brand-800"
            >
              {pending ? "준비 중" : "학습"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AdminFeedPanel({
  sources,
  adminArticles,
  feedSourceKey,
  setFeedSourceKey,
  refreshFeeds,
  isRefreshRunning,
  refreshJob,
  refreshProgress,
  refreshCompleted,
  refreshTotal,
  refreshError,
  refreshStatusError,
  publishArticle,
  publishPending,
}) {
  return (
    <Card className="rounded-md border-brand-200 bg-brand-50/70 shadow-none">
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-brand-900">콘텐츠 업데이트</CardTitle>
            <CardDescription className="text-brand-700">
              언론사별 주요 뉴스를 가져와 학습 목록에 반영합니다.
            </CardDescription>
          </div>
          <Sparkles className="mt-0.5 h-5 w-5 text-brand-600" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <div className="flex flex-wrap gap-2">
          <select
            value={feedSourceKey}
            onChange={(event) => setFeedSourceKey(event.target.value)}
            className="h-10 min-w-[170px] rounded-md border border-brand-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">전체 언론사</option>
            {(sources || [])
              .filter((source) => source.license_status === "approved" && source.feed_url)
              .map((source) => (
                <option key={source.key} value={source.key}>
                  {source.name}
                </option>
              ))}
          </select>
          <Button type="button" onClick={refreshFeeds} disabled={isRefreshRunning} className="bg-brand-700 hover:bg-brand-800">
            {isRefreshRunning ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {isRefreshRunning ? "업데이트 중" : "업데이트"}
          </Button>
        </div>

        {refreshError && <p className="text-xs text-rose-600">업데이트 실패: {refreshError}</p>}
        {refreshStatusError && <p className="text-xs text-rose-600">업데이트 상태 확인 실패: {refreshStatusError}</p>}

        {refreshJob && (
          <div className="rounded-md bg-white p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700">
                {refreshJob.status === "completed"
                  ? "업데이트 완료"
                  : refreshJob.status === "failed"
                    ? "업데이트 실패"
                    : refreshJob.current_source || refreshJob.message || "업데이트 준비 중"}
              </span>
              <span className="shrink-0 text-slate-500">
                {refreshCompleted}/{refreshTotal || "-"} · 저장 {refreshJob.saved || 0}개
              </span>
            </div>
            <Progress
              value={refreshJob.status === "completed" ? 100 : refreshProgress}
              className={cn("mt-2 bg-brand-100", refreshJob.status === "failed" && "bg-rose-100")}
            />
            {refreshJob.message && <p className="mt-1.5 text-xs text-slate-500">{refreshJob.message}</p>}
            {refreshJob.results?.length > 0 && (
              <div className="mt-2 space-y-1">
                {refreshJob.results.map((item) => (
                  <p key={item.source_key} className={cn("text-xs", item.ok ? "text-emerald-700" : "text-rose-600")}>
                    {item.source}: {item.ok ? `${item.fetched}개 수집 · ${item.saved}개 저장` : item.error}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {adminArticles?.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {adminArticles.slice(0, 6).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-700">{item.title}</span>
                <button
                  type="button"
                  disabled={publishPending}
                  onClick={() => publishArticle({ id: item.id, isPublished: !item.is_published })}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-semibold",
                    item.is_published ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                  )}
                >
                  {item.is_published ? "공개" : "비공개"}
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReaderPlaceholder({ article, user, onStart, onRequireLogin }) {
  if (article) {
    return (
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        {article.image_url && (
          <div className="aspect-[16/7] overflow-hidden bg-slate-100" data-article-hero-image>
            <img
              src={articleImageUrl(article.image_url)}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        )}
        <div className="space-y-4 p-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{article.source || shortHost(article.url)}</span>
              {article.published_at && <span>· {formatDate(article.published_at)}</span>}
              {article.topic && <Badge variant="outline">{article.topic}</Badge>}
            </div>
            <h4 className="text-xl font-bold leading-8 text-slate-950">{article.title}</h4>
          </div>
          {article.description && (
            <p className="text-sm leading-7 text-slate-600">{article.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => (user ? onStart?.(article.id) : onRequireLogin?.())}
              className="bg-brand-700 hover:bg-brand-800"
            >
              {user ? "이 기사로 학습 시작" : "로그인하고 학습 시작"}
            </Button>
            {article.url && (
              <Button type="button" variant="outline" asChild>
                <a href={article.url} target="_blank" rel="noreferrer">
                  원문 보기 <ExternalLink />
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-white">
      <EmptyState
        title="학습할 기사를 선택하세요"
        description="기사 목록에서 읽을 기사를 고르면 본문과 저장할 표현을 확인할 수 있습니다."
      />
    </div>
  );
}

function StudyParagraph({ paragraph, index, chunk, fontClassName, showExplanations, showHighlights }) {
  const expressions = paragraph.key_expressions || [];
  return (
    <article className="group relative border-b border-slate-100 py-4 last:border-b-0">
      <div className="flex items-start gap-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("whitespace-pre-wrap text-slate-900", fontClassName)}>
            <HighlightedText text={chunk?.text || ""} expressions={expressions} enabled={showHighlights} />
          </p>
          {showExplanations && (
            <div className="mt-3 rounded-md border border-brand-100 bg-brand-50/60 p-3">
              <p className="text-sm leading-6 text-slate-700">{paragraph.explanation_ko}</p>
              {paragraph.check_question && (
                <div className="mt-3 border-t border-brand-100 pt-3 text-sm">
                  <p className="font-semibold text-slate-800">{paragraph.check_question}</p>
                  {paragraph.answer_ko && <p className="mt-1 text-slate-500">{paragraph.answer_ko}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ExpressionsPanel({
  expressions,
  selectedKeys,
  selectedCount,
  toggleExpression,
  saveSelected,
  savePending,
  saveResult,
}) {
  if (expressions.length === 0) return null;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950">표현 저장</h3>
          <p className="mt-1 text-xs text-slate-500">기사에서 뽑은 표현을 골라 단어장에 저장하세요.</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={saveSelected}
          disabled={!selectedCount || savePending}
          className="bg-brand-700 hover:bg-brand-800"
        >
          <Save />
          {savePending ? "저장 중" : `선택 ${selectedCount}개 저장`}
        </Button>
      </div>
      {saveResult && (
        <p className="mt-2 text-xs text-emerald-600">
          {saveResult.added || 0}개 저장, {saveResult.skipped || 0}개 건너뜀
        </p>
      )}
      <div className="mt-3 grid gap-2">
        {expressions.map((item) => {
          const selected = selectedKeys.has(item.key);
          return (
            <div
              key={item.key}
              onClick={() => toggleExpression(item.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleExpression(item.key);
                }
              }}
              role="button"
              tabIndex={0}
              className={cn(
                "cursor-pointer rounded-md border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-200",
                selected ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{item.word}</p>
                  {item.korean && <p className="mt-1 text-sm text-slate-600">{item.korean}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <AudioButton word={item.word} lang="en" />
                  </span>
                  <Checkbox checked={selected} aria-label={`${item.word} 선택`} />
                </div>
              </div>
              {item.english_def && <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{item.english_def}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ArticleLearningTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [viewMode, setViewMode] = useState("catalog");
  const [isExpressionsOpen, setExpressionsOpen] = useState(false);
  const [feedSourceKey, setFeedSourceKey] = useState("");
  const [refreshJobId, setRefreshJobId] = useState("");
  const [fontStep, setFontStep] = useState(1);
  const [showExplanations, setShowExplanations] = useState(true);
  const [showHighlights, setShowHighlights] = useState(true);

  const catalogQuery = useQuery({
    queryKey: queryKeys.articleCatalog(topic, "", q, 1),
    queryFn: () => api.articleCatalog({ topic, q, page: 1 }),
  });
  const articles = catalogQuery.data?.articles || [];

  const sessionQuery = useQuery({
    queryKey: queryKeys.articleSession(activeSessionId),
    queryFn: () => api.articleSession(activeSessionId),
    enabled: !!user && !!activeSessionId,
  });

  const adminStatusQuery = useQuery({
    queryKey: queryKeys.articleAdminStatus,
    queryFn: api.articleAdminStatus,
    enabled: !!user,
  });
  const isArticleAdmin = !!adminStatusQuery.data?.is_admin;
  const sourcesQuery = useQuery({
    queryKey: queryKeys.articleSources,
    queryFn: api.articleSources,
    enabled: !!user && isArticleAdmin,
  });
  const adminListQuery = useQuery({
    queryKey: queryKeys.articleAdminList,
    queryFn: api.articleAdminList,
    enabled: !!user && isArticleAdmin,
  });
  const refreshJobQuery = useQuery({
    queryKey: queryKeys.articleRefreshJob(refreshJobId),
    queryFn: () => api.articleAdminFeedRefreshStatus(refreshJobId),
    enabled: !!user && isArticleAdmin && !!refreshJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1000 : false;
    },
  });

  const studyMutation = useMutation({
    mutationFn: (id) => api.articleStudy(id),
    onSuccess: (data, id) => {
      queryClient.setQueryData(queryKeys.articleSession(id), (old) =>
        old ? { ...old, study_json: data.study, chunks: data.chunks } : old
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.articleSessions });
    },
  });

  const startMutation = useMutation({
    mutationFn: (articleId) => api.articleCreateSession(articleId),
    onSuccess: (data) => {
      setActiveSessionId(data.session_id);
      setSelectedKeys(new Set());
      setViewMode("reader");
      queryClient.invalidateQueries({ queryKey: queryKeys.articleSessions });
      studyMutation.mutate(data.session_id);
    },
  });

  const saveWordsMutation = useMutation({
    mutationFn: (items) => api.articleSaveWords(activeSessionId, items, "뉴스"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.words("") });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    },
  });

  const adminRefreshMutation = useMutation({
    mutationFn: (payload) => api.articleAdminFeedRefresh(payload),
    onSuccess: (data) => {
      if (data?.job_id) {
        queryClient.setQueryData(queryKeys.articleRefreshJob(data.job_id), data);
        setRefreshJobId(data.job_id);
      }
    },
  });
  const adminPublishMutation = useMutation({
    mutationFn: ({ id, isPublished }) => api.articleAdminPublish(id, isPublished),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.articleAdminList });
      queryClient.invalidateQueries({ queryKey: ["articles", "catalog"] });
    },
  });

  useEffect(() => {
    studyMutation.reset();
  }, [activeSessionId]);

  const sessionData = sessionQuery.data || null;
  const study = sessionData?.study_json || studyMutation.data?.study || {};
  const chunks = sessionData?.chunks || studyMutation.data?.chunks || [];
  const mutationRefreshJob =
    adminRefreshMutation.data?.job_id === refreshJobId ? adminRefreshMutation.data : null;
  const refreshJob = refreshJobQuery.isError
    ? null
    : refreshJobQuery.data || mutationRefreshJob || null;
  const isRefreshRunning =
    adminRefreshMutation.isPending ||
    (!refreshJobQuery.isError && (refreshJob?.status === "queued" || refreshJob?.status === "running"));
  const refreshTotal = Number(refreshJob?.total_sources || 0);
  const refreshCompleted = Number(refreshJob?.completed_sources || 0);
  const refreshProgress = refreshTotal > 0 ? Math.round((refreshCompleted / refreshTotal) * 100) : 0;
  const chunkMap = useMemo(
    () => Object.fromEntries(chunks.map((chunk) => [chunk.id, chunk])),
    [chunks]
  );

  useEffect(() => {
    if (!refreshJob || refreshJob.job_id !== refreshJobId) return;
    if (refreshJob.status !== "completed" && refreshJob.status !== "failed") return;
    queryClient.invalidateQueries({ queryKey: queryKeys.articleAdminList });
    queryClient.invalidateQueries({ queryKey: ["articles", "catalog"] });
  }, [refreshJob?.status, refreshJob?.job_id, refreshJobId, queryClient]);

  const expressions = useMemo(() => {
    const out = [];
    for (const paragraph of study?.paragraphs || []) {
      for (const [index, item] of (paragraph.key_expressions || []).entries()) {
        const word = (item.word || "").trim();
        if (!word) continue;
        out.push({
          ...item,
          key: `${paragraph.chunk_id}-${index}-${word}`,
          example: item.example || chunkMap[paragraph.chunk_id]?.text || "",
        });
      }
    }
    return out;
  }, [study, chunkMap]);

  const selectedExpressions = expressions.filter((item) => selectedKeys.has(item.key));
  const hasStudyData = hasStudy(study);
  const activeArticleId = sessionData?.article_id || sessionData?.id;
  const previewArticle = useMemo(
    () => articles.find((article) => article.id === selectedArticleId) || articles[0] || null,
    [articles, selectedArticleId]
  );
  const displayArticle = sessionData || previewArticle;

  const submitSearch = (event) => {
    event.preventDefault();
    setQ(qInput.trim());
  };

  const startArticle = (articleId) => {
    setSelectedArticleId(articleId);
    setViewMode("reader");
    if (!user) {
      onRequireLogin?.();
      return;
    }
    startMutation.mutate(articleId);
  };

  const toggleExpression = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const saveSelected = () => {
    if (!selectedExpressions.length || !activeSessionId) return;
    saveWordsMutation.mutate(selectedExpressions);
  };

  const refreshFeeds = () => {
    adminRefreshMutation.reset();
    setRefreshJobId("");
    adminRefreshMutation.mutate({
      source_key: feedSourceKey,
      publish: true,
      max_items: 1,
    });
  };

  const font = FONT_STEPS[fontStep];

  const renderArticleList = ({ framed = false } = {}) => (
    <section
      className={cn(
        "flex min-h-0 flex-col bg-white",
        framed && "min-h-[calc(100vh-13rem)] overflow-hidden rounded-md border border-slate-200 shadow-sm"
      )}
    >
      <div className="space-y-4 border-b border-slate-100 p-4">
        <form onSubmit={submitSearch} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            placeholder="뉴스 검색"
            className="h-10 pl-9 pr-10"
          />
          <Button type="submit" variant="ghost" size="icon" className="absolute right-0 top-0 h-10 w-10" aria-label="기사 검색">
            <Search className="h-4 w-4" />
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((item) => (
            <TopicPill
              key={item.value}
              item={item}
              selected={topic === item.value}
              onClick={() => setTopic(item.value)}
            />
          ))}
        </div>
      </div>

      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto p-4">
        {catalogQuery.isLoading && (
          <div className="space-y-3">
            <SkeletonBlock className="h-32 rounded-md" />
            <SkeletonBlock className="h-32 rounded-md" />
            <SkeletonBlock className="h-32 rounded-md" />
          </div>
        )}
        {catalogQuery.isError && <EmptyState title="기사 목록을 가져오지 못했어요" description="잠시 후 다시 시도해주세요." />}
        {!catalogQuery.isLoading && !catalogQuery.isError && articles.length === 0 && (
          <EmptyState title="공개된 기사가 없어요" description="운영자가 검증한 기사가 공개되면 여기에 표시됩니다." />
        )}
        {articles.length > 0 && (
          <div className="space-y-3">
            {articles.map((article) => (
              <ArticleListItem
                key={article.id}
                article={article}
                active={article.id === (activeArticleId || selectedArticleId || previewArticle?.id)}
                pending={startMutation.isPending}
                onPreview={() => {
                  setSelectedArticleId(article.id);
                  setActiveSessionId(null);
                  setSelectedKeys(new Set());
                  setViewMode("reader");
                }}
                onStart={() => startArticle(article.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  const renderReader = () => (
    <section className="min-h-[calc(100vh-13rem)] overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 md:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="line-clamp-3 font-serif text-3xl font-bold leading-tight text-slate-950 md:text-4xl">
              {displayArticle ? displayArticle.title : "본문 리딩"}
            </h3>
            {displayArticle && (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                <span>{displayArticle.source || shortHost(displayArticle.url)}</span>
                {displayArticle.published_at && <span>|</span>}
                {displayArticle.published_at && <span>{formatDate(displayArticle.published_at)}</span>}
                {displayArticle.topic && <Badge variant="outline">{displayArticle.topic}</Badge>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFontStep((value) => (value + 1) % FONT_STEPS.length)}
              aria-label="본문 글자 크기 변경"
            >
              Aa
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setShowHighlights((value) => !value)} aria-label="자동 하이라이트">
              <Highlighter />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowExplanations((value) => !value)}
              aria-label="본문 해설 표시 변경"
            >
              해설
            </Button>
            {displayArticle?.url && (
              <Button type="button" variant="ghost" size="icon" asChild aria-label="원문 보기">
                <a href={displayArticle.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-5 px-5 py-6 md:px-8">
        {!activeSessionId && (
          <ReaderPlaceholder
            article={previewArticle}
            user={user}
            onStart={startArticle}
            onRequireLogin={onRequireLogin}
          />
        )}

        {activeSessionId && sessionQuery.isLoading && (
          <div className="space-y-3">
            <SkeletonBlock className="h-64 rounded-md" />
            <SkeletonBlock className="h-32 rounded-md" />
            <SkeletonBlock className="h-32 rounded-md" />
          </div>
        )}

        {activeSessionId && sessionData && (
          <>
            {sessionData.image_url && (
              <div className="aspect-[16/7] overflow-hidden rounded-md bg-slate-100" data-article-hero-image>
                <img
                  src={articleImageUrl(sessionData.image_url)}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}
            {sessionData.description && (
              <p className="text-base leading-8 text-slate-700">{sessionData.description}</p>
            )}
            {studyMutation.isPending && !hasStudyData && <LoadingSpinner label="기사에서 핵심 표현을 분석하고 있습니다" />}
            {hasStudyData && (
              <div className="space-y-2">
                {study.paragraphs.map((paragraph, index) => (
                  <StudyParagraph
                    key={`${paragraph.chunk_id}-${index}`}
                    paragraph={paragraph}
                    index={index}
                    chunk={chunkMap[paragraph.chunk_id]}
                    fontClassName={font.className}
                    showExplanations={showExplanations}
                    showHighlights={showHighlights}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-normal text-slate-950">뉴스 리딩</h2>
          <p className="mt-1 text-sm text-slate-500">읽을 기사를 고르고 핵심 표현만 단어장에 저장하세요.</p>
        </div>
        {viewMode === "reader" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setViewMode("catalog")}>
              <ArrowLeft />
              목록으로
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setExpressionsOpen(true)}
            >
              <PanelRightOpen />
              표현 저장
              {expressions.length > 0 && (
                <Badge className="ml-1 bg-brand-50 text-brand-700 hover:bg-brand-50">{expressions.length}</Badge>
              )}
            </Button>
          </div>
        )}
      </div>

      {user && isArticleAdmin && (
        <AdminFeedPanel
          sources={sourcesQuery.data?.sources || []}
          adminArticles={adminListQuery.data?.articles || []}
          feedSourceKey={feedSourceKey}
          setFeedSourceKey={setFeedSourceKey}
          refreshFeeds={refreshFeeds}
          isRefreshRunning={isRefreshRunning}
          refreshJob={refreshJob}
          refreshProgress={refreshProgress}
          refreshCompleted={refreshCompleted}
          refreshTotal={refreshTotal}
          refreshError={adminRefreshMutation.error?.message}
          refreshStatusError={refreshJobQuery.error?.message}
          publishArticle={adminPublishMutation.mutate}
          publishPending={adminPublishMutation.isPending}
        />
      )}

      {viewMode === "catalog" ? renderArticleList({ framed: true }) : renderReader()}

      <Drawer open={isExpressionsOpen} onOpenChange={setExpressionsOpen} direction="right">
        <DrawerContent side="right" className="p-0">
          <DrawerHeader className="border-b border-slate-100 text-left">
            <DrawerTitle>저장할 표현</DrawerTitle>
            <DrawerDescription>기사에서 추출한 표현을 골라 단어장에 저장하세요.</DrawerDescription>
          </DrawerHeader>
          <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto p-4">
            {!activeSessionId && (
              <EmptyState title="학습 중인 기사가 없어요" description="기사 목록에서 학습을 시작하면 표현이 표시됩니다." />
            )}
            {activeSessionId && studyMutation.isPending && !hasStudyData && (
              <LoadingSpinner label="표현을 추출하고 있습니다" />
            )}
            {activeSessionId && !studyMutation.isPending && expressions.length === 0 && (
              <EmptyState title="저장할 표현이 없어요" description="본문 분석이 끝나면 핵심 표현이 여기에 표시됩니다." />
            )}
            {expressions.length > 0 && (
              <ExpressionsPanel
                expressions={expressions}
                selectedKeys={selectedKeys}
                selectedCount={selectedExpressions.length}
                toggleExpression={toggleExpression}
                saveSelected={saveSelected}
                savePending={saveWordsMutation.isPending}
                saveResult={saveWordsMutation.isSuccess ? saveWordsMutation.data : null}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
