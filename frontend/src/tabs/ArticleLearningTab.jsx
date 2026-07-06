import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ExternalLink,
  Highlighter,
  Languages,
  Loader2,
  PanelRightOpen,
  Save,
  Search,
} from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import AudioButton from "../components/AudioButton";
import { EmptyState, SkeletonBlock } from "../components/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
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

function normalizeWord(value) {
  return (value || "").trim().toLowerCase();
}

function paginationRange(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage]);
  if (currentPage > 1) pages.add(currentPage - 1);
  if (currentPage < totalPages) pages.add(currentPage + 1);
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
  }
  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
  }

  const sorted = Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);

  return sorted.flatMap((page, index) => {
    const previous = sorted[index - 1];
    if (index > 0 && page - previous > 1) return ["ellipsis", page];
    return [page];
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, expressions, enabled, onExpressionClick }) {
  const words = expressions
    .map((item) => (item.word || "").trim())
    .filter((word) => word.length >= 3);

  if (!enabled || words.length === 0 || !text) return text;

  const pattern = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).map((part, index) => {
    const matchedExpression = expressions.find((item) => (item.word || "").trim().toLowerCase() === part.toLowerCase());
    if (!matchedExpression) return <span key={`${part}-${index}`}>{part}</span>;
    return (
      <mark
        key={`${part}-${index}`}
        role={onExpressionClick ? "button" : undefined}
        tabIndex={onExpressionClick ? 0 : undefined}
        title={matchedExpression.korean ? `${matchedExpression.word}: ${matchedExpression.korean}` : matchedExpression.word}
        onClick={() => onExpressionClick?.(matchedExpression)}
        onKeyDown={(event) => {
          if (!onExpressionClick) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onExpressionClick(matchedExpression);
          }
        }}
        className={cn(
          "rounded bg-amber-100 px-1 py-0.5 text-slate-950",
          onExpressionClick && "cursor-pointer transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300"
        )}
      >
        {part}
      </mark>
    );
  });
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
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" asChild className="h-8 w-16 border-brand-200 px-2 text-brand-800 hover:bg-brand-50">
              <a href={article.url} target="_blank" rel="noreferrer">
                원문
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onStart}
              disabled={pending}
              className="h-8 w-16 bg-brand-700 px-2 hover:bg-brand-800"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "읽기"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ReaderPlaceholder({ article, user, onStart, onRequireLogin, pending }) {
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
              disabled={pending}
              className="bg-brand-700 hover:bg-brand-800"
            >
              {pending ? "분석 준비 중" : user ? "AI로 기사 분석" : "로그인하고 AI 분석"}
            </Button>
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

function InlineSpinner() {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-brand-700" />
      <p className="text-sm font-medium text-slate-500">기사 내용을 AI가 분석 중입니다. 잠시만 기다려 주세요.</p>
    </div>
  );
}

function StudyParagraph({
  paragraph,
  index,
  chunk,
  fontClassName,
  showExplanations,
  showTranslations,
  showHighlights,
  onExpressionClick,
}) {
  const expressions = (paragraph.key_expressions || []).map((item, expressionIndex) => {
    const word = (item.word || "").trim();
    return {
      ...item,
      key: `${paragraph.chunk_id}-${expressionIndex}-${word}`,
      example: item.example || chunk?.text || "",
    };
  });
  return (
    <article className="group relative border-b border-slate-100 py-4 last:border-b-0">
      <div className="flex items-start gap-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("whitespace-pre-wrap text-slate-900", fontClassName)}>
            <HighlightedText
              text={chunk?.text || ""}
              expressions={expressions}
              enabled={showHighlights}
              onExpressionClick={onExpressionClick}
            />
          </p>
          {showTranslations && paragraph.translation_ko && (
            <div className="mt-4 border-l-2 border-slate-300 pl-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">직역</p>
              <p className="mt-1 text-sm leading-7 text-slate-600">{paragraph.translation_ko}</p>
            </div>
          )}
          {showExplanations && (
            <div className="mt-3 rounded-md border border-brand-100 bg-brand-50/60 p-3">
              <p className="text-sm leading-6 text-slate-700">{paragraph.explanation_ko}</p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ExpressionsPanel({
  expressions,
  savedWords,
  selectedKeys,
  selectedCount,
  toggleExpression,
  saveSelected,
  savePending,
  saveResult,
  labels,
  tag,
  onTagChange,
  itemTags,
  onItemTagChange,
}) {
  if (expressions.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-950">표현 저장</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">기사에서 뽑은 표현을 골라 단어장에 저장하세요.</p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={saveSelected}
            disabled={!selectedCount || savePending}
            className="shrink-0 bg-brand-700 hover:bg-brand-800"
          >
            <Save />
            {savePending ? "저장 중" : `${selectedCount}개 저장`}
          </Button>
        </div>
        {labels.length > 0 && (
          <label className="mt-3 grid gap-1.5 text-xs font-semibold text-slate-500">
            선택 항목 전체 태그
            <select
              value={tag}
              onChange={(event) => onTagChange(event.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 outline-none focus:border-brand-400"
            >
              {labels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
              {!labels.includes("뉴스") && <option value="뉴스">뉴스</option>}
            </select>
          </label>
        )}
      </div>
      {saveResult && (
        <p className="text-xs font-medium text-emerald-600">
          {saveResult.added || 0}개 저장
          {Number(saveResult.skipped || 0) > 0 && `, ${saveResult.skipped}개 건너뜀`}
        </p>
      )}
      <div className="space-y-2">
        {expressions.map((item) => {
          const saved = savedWords.has(normalizeWord(item.word));
          const selected = !saved && selectedKeys.has(item.key);
          return (
            <div
              key={item.key}
              onClick={() => {
                if (!saved) toggleExpression(item.key);
              }}
              onKeyDown={(event) => {
                if (saved) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleExpression(item.key);
                }
              }}
              role="button"
              tabIndex={0}
              className={cn(
                "cursor-pointer rounded-md border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-200",
                saved
                  ? "cursor-default border-emerald-200 bg-emerald-50/60"
                  : selected
                    ? "border-brand-500 bg-brand-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
              )}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold leading-5 text-slate-900">{item.word}</p>
                  {item.korean && <p className="mt-1 break-words text-sm leading-5 text-slate-600">{item.korean}</p>}
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  {saved && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">저장됨</Badge>}
                  <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <AudioButton word={item.word} lang="en" />
                  </span>
                  {!saved && <Checkbox checked={selected} aria-label={`${item.word} 선택`} />}
                </div>
              </div>
              {!saved && selected && labels.length > 0 && (
                <label
                  className="mt-3 grid gap-1.5 rounded-md border border-brand-100 bg-white/70 p-2 text-xs font-semibold text-slate-500"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  이 표현 태그
                  <select
                    value={itemTags[item.key] || tag}
                    onChange={(event) => onItemTagChange(item.key, event.target.value)}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 outline-none focus:border-brand-400"
                  >
                    {labels.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                    {!labels.includes("뉴스") && <option value="뉴스">뉴스</option>}
                  </select>
                </label>
              )}
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
  const [catalogPage, setCatalogPage] = useState(1);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [savedExpressionWords, setSavedExpressionWords] = useState(() => new Set());
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [viewMode, setViewMode] = useState("catalog");
  const [isExpressionsOpen, setExpressionsOpen] = useState(false);
  const [fontStep, setFontStep] = useState(1);
  const [showExplanations, setShowExplanations] = useState(true);
  const [showTranslations, setShowTranslations] = useState(true);
  const [showHighlights, setShowHighlights] = useState(true);
  const [wordTag, setWordTag] = useState("뉴스");
  const [expressionTags, setExpressionTags] = useState({});
  const readerHistoryPushedRef = useRef(false);
  const viewModeRef = useRef(viewMode);

  const catalogQuery = useQuery({
    queryKey: queryKeys.articleCatalog(topic, "", q, catalogPage),
    queryFn: () => api.articleCatalog({ topic, q, page: catalogPage }),
  });
  const articles = catalogQuery.data?.articles || [];
  const catalogPageSize = Number(catalogQuery.data?.page_size || 12);
  const catalogTotal = Number(catalogQuery.data?.total || 0);
  const catalogTotalPages = Math.max(1, Math.ceil(catalogTotal / catalogPageSize));

  const sessionQuery = useQuery({
    queryKey: queryKeys.articleSession(activeSessionId),
    queryFn: () => api.articleSession(activeSessionId),
    enabled: !!user && !!activeSessionId,
  });

  const wordsQuery = useQuery({
    queryKey: queryKeys.words(""),
    queryFn: () => api.listWords(""),
    enabled: !!user,
  });
  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: !!user,
    staleTime: 5 * 60_000,
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
      studyMutation.reset();
      setActiveSessionId(data.session_id);
      setSelectedKeys(new Set());
      setExpressionTags({});
      setViewMode("reader");
      queryClient.invalidateQueries({ queryKey: queryKeys.articleSessions });
      studyMutation.mutate(data.session_id);
    },
  });

  const saveWordsMutation = useMutation({
    mutationFn: (items) => api.articleSaveWords(activeSessionId, items, wordTag || "뉴스"),
    onSuccess: (_data, items) => {
      setSavedExpressionWords((prev) => {
        const next = new Set(prev);
        for (const item of items || []) {
          const word = normalizeWord(item.word);
          if (word) next.add(word);
        }
        return next;
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.words("") });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    },
  });

  useEffect(() => {
    if (!catalogQuery.data) return;
    if (catalogPage > catalogTotalPages) setCatalogPage(catalogTotalPages);
  }, [catalogQuery.data, catalogPage, catalogTotalPages]);

  useEffect(() => {
    viewModeRef.current = viewMode;
    if (viewMode === "reader" && !readerHistoryPushedRef.current) {
      window.history.pushState({ englishBuddyArticleReader: true }, "");
      readerHistoryPushedRef.current = true;
    }
    if (viewMode === "catalog") {
      readerHistoryPushedRef.current = false;
    }
  }, [viewMode]);

  useEffect(() => {
    const onPopState = () => {
      if (viewModeRef.current !== "reader") return;
      setViewMode("catalog");
      readerHistoryPushedRef.current = false;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const sessionData = sessionQuery.data || null;
  const study = sessionData?.study_json || studyMutation.data?.study || {};
  const chunks = sessionData?.chunks || studyMutation.data?.chunks || [];
  const chunkMap = useMemo(
    () => Object.fromEntries(chunks.map((chunk) => [chunk.id, chunk])),
    [chunks]
  );

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

  const savedWords = useMemo(() => {
    const out = new Set(savedExpressionWords);
    for (const item of wordsQuery.data?.words || []) {
      const word = normalizeWord(item.word);
      if (word) out.add(word);
    }
    return out;
  }, [wordsQuery.data, savedExpressionWords]);

  const selectedExpressions = expressions.filter(
    (item) => selectedKeys.has(item.key) && !savedWords.has(normalizeWord(item.word))
  ).map((item) => ({ ...item, tag: expressionTags[item.key] || wordTag || "뉴스" }));
  const hasStudyData = hasStudy(study);
  const activeArticleId = sessionData?.article_id || sessionData?.id;
  const visibleSelectedArticleId = useMemo(
    () => (articles.some((article) => article.id === selectedArticleId) ? selectedArticleId : null),
    [articles, selectedArticleId]
  );
  const previewArticle = useMemo(
    () => articles.find((article) => article.id === visibleSelectedArticleId) || articles[0] || null,
    [articles, visibleSelectedArticleId]
  );
  const displayArticle = sessionData || previewArticle;

  const submitSearch = (event) => {
    event.preventDefault();
    setCatalogPage(1);
    setSelectedArticleId(null);
    setQ(qInput.trim());
  };

  const startArticle = (articleId) => {
    if (startMutation.isPending) return;
    setSelectedArticleId(articleId);
    if (!user) {
      setViewMode("reader");
      onRequireLogin?.();
      return;
    }
    startMutation.mutate(articleId);
  };

  const openArticle = (articleId) => {
    setSelectedArticleId(articleId);
    setActiveSessionId(null);
    setSelectedKeys(new Set());
    setExpressionTags({});
    studyMutation.reset();
    setViewMode("reader");
  };

  const toggleExpression = (key) => {
    const item = expressions.find((expression) => expression.key === key);
    if (item && savedWords.has(normalizeWord(item.word))) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const setBulkExpressionTag = (tag) => {
    setWordTag(tag);
    setExpressionTags(() => {
      const next = {};
      for (const item of expressions) {
        if (!savedWords.has(normalizeWord(item.word))) {
          next[item.key] = tag;
        }
      }
      return next;
    });
  };

  const setExpressionTag = (key, tag) => {
    setExpressionTags((prev) => ({ ...prev, [key]: tag }));
  };

  const saveSelected = () => {
    if (!selectedExpressions.length || !activeSessionId) return;
    saveWordsMutation.mutate(selectedExpressions);
  };

  const openExpressionPanel = (item) => {
    if (item?.key) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.add(item.key);
        return next;
      });
    }
    setExpressionsOpen(true);
  };

  const font = FONT_STEPS[fontStep];
  const catalogPages = paginationRange(catalogPage, catalogTotalPages);
  const labels = labelsQuery.data?.labels || [];

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
                active={article.id === (activeArticleId || visibleSelectedArticleId || previewArticle?.id)}
                pending={false}
                onPreview={() => openArticle(article.id)}
                onStart={() => openArticle(article.id)}
              />
            ))}
          </div>
        )}
      </div>

      {!catalogQuery.isLoading && !catalogQuery.isError && (
        <div className="border-t border-slate-100 px-4 py-3">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  disabled={catalogPage <= 1}
                  onClick={(event) => {
                    event.preventDefault();
                    setSelectedArticleId(null);
                    setCatalogPage((page) => Math.max(1, page - 1));
                  }}
                />
              </PaginationItem>
              {catalogPages.map((page, index) =>
                page === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={page}>
                    <PaginationLink
                      href="#"
                      isActive={page === catalogPage}
                      onClick={(event) => {
                        event.preventDefault();
                        setSelectedArticleId(null);
                        setCatalogPage(page);
                      }}
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  disabled={catalogPage >= catalogTotalPages}
                  onClick={(event) => {
                    event.preventDefault();
                    setSelectedArticleId(null);
                    setCatalogPage((page) => Math.min(catalogTotalPages, page + 1));
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </section>
  );

  const renderReader = () => (
    <section className="min-h-[calc(100vh-13rem)] overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 md:px-8">
        <div className="min-w-0">
          <h3 className="font-serif text-3xl font-bold leading-tight text-slate-950 md:text-4xl">
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
          {displayArticle?.url && (
            <div className="mt-5 flex">
              <Button
                type="button"
                asChild
                className="h-11 shrink-0 bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800"
              >
                <a href={displayArticle.url} target="_blank" rel="noreferrer">
                  원문 사이트에서 보기 <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-5 px-5 py-6 md:px-8">
        {!activeSessionId && (
          <ReaderPlaceholder
            article={previewArticle}
            user={user}
            onStart={startArticle}
            onRequireLogin={onRequireLogin}
            pending={startMutation.isPending}
          />
        )}

        {activeSessionId && sessionQuery.isLoading && !studyMutation.isPending && (
          <div className="space-y-3">
            <SkeletonBlock className="h-64 rounded-md" />
            <SkeletonBlock className="h-32 rounded-md" />
            <SkeletonBlock className="h-32 rounded-md" />
          </div>
        )}

        {activeSessionId && (sessionData || studyMutation.isPending) && (
          <>
            {displayArticle?.image_url && (
              <div className="aspect-[16/7] overflow-hidden rounded-md bg-slate-100" data-article-hero-image>
                <img
                  src={articleImageUrl(displayArticle.image_url)}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}
            {displayArticle?.description && (
              <p className="text-base leading-8 text-slate-700">{displayArticle.description}</p>
            )}
            {studyMutation.isPending && !hasStudyData && (
              <InlineSpinner />
            )}
            {hasStudyData && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="text-xs font-semibold text-slate-500">AI 분석 결과</span>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFontStep((value) => (value + 1) % FONT_STEPS.length)}
                      aria-label="분석 본문 글자 크기 변경"
                    >
                      Aa
                    </Button>
                    <Button
                      type="button"
                      variant={showHighlights ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setShowHighlights((value) => !value)}
                      aria-label="자동 하이라이트 표시 변경"
                    >
                      <Highlighter />
                      하이라이트
                    </Button>
                    <Button
                      type="button"
                      variant={showTranslations ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setShowTranslations((value) => !value)}
                      aria-label="문단 번역 표시 변경"
                    >
                      <Languages />
                      번역
                    </Button>
                    <Button
                      type="button"
                      variant={showExplanations ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setShowExplanations((value) => !value)}
                      aria-label="본문 해설 표시 변경"
                    >
                      해설
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {study.paragraphs.map((paragraph, index) => (
                    <StudyParagraph
                      key={`${paragraph.chunk_id}-${index}`}
                      paragraph={paragraph}
                      index={index}
                      chunk={chunkMap[paragraph.chunk_id]}
                      fontClassName={font.className}
                      showExplanations={showExplanations}
                      showTranslations={showTranslations}
                      showHighlights={showHighlights}
                      onExpressionClick={openExpressionPanel}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );

  return (
    <div className="-mx-4 -mt-6 w-auto space-y-4 md:-mx-8">
      <div className="sticky -top-6 z-30 shrink-0 border-b border-slate-800/60 bg-[#10171b] px-3 py-2 text-white shadow-[0_10px_26px_rgba(15,23,42,0.18)] md:px-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:max-w-md">
            <label className="grid grid-cols-[2rem_1fr] items-center gap-2 text-xs text-slate-300">
              <span>주제</span>
              <span className="relative min-w-0">
                <select
                  value={topic}
                  onChange={(event) => {
                    setCatalogPage(1);
                    setSelectedArticleId(null);
                    setTopic(event.target.value);
                    setViewMode("catalog");
                  }}
                  className="h-9 w-full appearance-none rounded-md border border-white/10 bg-white/10 px-3 pr-9 text-sm font-semibold text-white outline-none ring-offset-[#10171b] transition hover:bg-white/20 focus:ring-2 focus:ring-brand-400"
                >
                  {TOPICS.map((item) => (
                    <option key={item.value} value={item.value} className="text-slate-900">
                      {item.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              </span>
            </label>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewMode("catalog")}
              className="h-9 border-white/20 bg-white/10 px-3 text-white hover:bg-white/20 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>목록보기</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setExpressionsOpen(true)}
              className="h-9 border border-brand-500 bg-brand-600 px-3 text-white hover:bg-brand-500"
            >
              <PanelRightOpen className="h-4 w-4" />
              <span>저장할 단어</span>
              {expressions.length > 0 && (
                <Badge className="ml-1 bg-white/90 text-brand-800 hover:bg-white">{expressions.length}</Badge>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-8">
        {viewMode === "catalog" ? renderArticleList({ framed: true }) : renderReader()}
      </div>

      <Drawer open={isExpressionsOpen} onOpenChange={setExpressionsOpen} direction="right">
        <DrawerContent side="right" className="w-[min(94vw,520px)] p-0">
          <DrawerHeader className="border-b border-slate-100 text-left">
            <DrawerTitle>저장할 표현</DrawerTitle>
            <DrawerDescription>기사에서 추출한 표현을 골라 단어장에 저장하세요.</DrawerDescription>
          </DrawerHeader>
          <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto p-4">
            {!activeSessionId && (
              <EmptyState title="학습 중인 기사가 없어요" description="기사 목록에서 학습을 시작하면 표현이 표시됩니다." />
            )}
            {activeSessionId && studyMutation.isPending && !hasStudyData && (
              <InlineSpinner />
            )}
            {activeSessionId && !studyMutation.isPending && expressions.length === 0 && (
              <EmptyState title="저장할 표현이 없어요" description="본문 분석이 끝나면 핵심 표현이 여기에 표시됩니다." />
            )}
            {expressions.length > 0 && (
              <ExpressionsPanel
                expressions={expressions}
                savedWords={savedWords}
                selectedKeys={selectedKeys}
                selectedCount={selectedExpressions.length}
                toggleExpression={toggleExpression}
                saveSelected={saveSelected}
                savePending={saveWordsMutation.isPending}
                saveResult={saveWordsMutation.isSuccess ? saveWordsMutation.data : null}
                labels={labels}
                tag={wordTag}
                onTagChange={setBulkExpressionTag}
                itemTags={expressionTags}
                onItemTagChange={setExpressionTag}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
