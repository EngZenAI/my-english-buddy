import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import MemberNotice from "../components/MemberNotice";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";

const TOPICS = [
  { value: "", label: "전체" },
  { value: "world", label: "World" },
  { value: "business", label: "Business" },
  { value: "entertainment", label: "Entertainment" },
  { value: "health", label: "Health" },
  { value: "education", label: "Education" },
  { value: "technology", label: "Tech" },
  { value: "opinion", label: "Opinion" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "sports", label: "Sports" },
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

export default function ArticleLearningTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [question, setQuestion] = useState("");
  const [feedSourceKey, setFeedSourceKey] = useState("");
  const [refreshJobId, setRefreshJobId] = useState("");

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

  const sessionsQuery = useQuery({
    queryKey: queryKeys.articleSessions,
    queryFn: api.articleSessions,
    enabled: !!user,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.articleSessions });
      studyMutation.mutate(data.session_id);
    },
  });

  const askMutation = useMutation({
    mutationFn: ({ id, text }) => api.articleAsk(id, text),
  });

  const completeMutation = useMutation({
    mutationFn: (id) => api.articleComplete(id),
    onSuccess: (data, id) => {
      queryClient.setQueryData(queryKeys.articleSession(id), (old) =>
        old ? { ...old, completion_json: data.completion, status: "completed" } : old
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.articleSessions });
    },
  });

  const saveWordsMutation = useMutation({
    mutationFn: (items) => api.articleSaveWords(activeSessionId, items, "뉴스"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.words("") });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.articleDeleteSession,
    onSuccess: (_data, id) => {
      if (activeSessionId === id) setActiveSessionId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.articleSessions });
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

  // Reset mutation state when active session changes
  useEffect(() => {
    studyMutation.reset();
    askMutation.reset();
    completeMutation.reset();
  }, [activeSessionId]);

  const sessionData = sessionQuery.data || null;
  const study = sessionData?.study_json || studyMutation.data?.study || {};
  const completion = sessionData?.completion_json || completeMutation.data?.completion || {};
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

  const submitSearch = (event) => {
    event.preventDefault();
    setQ(qInput.trim());
  };

  const startArticle = (articleId) => {
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

  const ask = () => {
    if (!activeSessionId || !question.trim()) return;
    askMutation.mutate({ id: activeSessionId, text: question.trim() });
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

  return (
    <div className="grid min-h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[390px_minmax(0,1fr)]">
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">뉴스 리딩</h3>
          <p className="text-sm text-slate-500">
            짧은 뉴스 문장에서 핵심 표현을 익히고 단어장에 저장하세요.
          </p>
        </div>

        {!user && <MemberNotice feature="뉴스 리딩" onRequireLogin={onRequireLogin} />}

        {user && isArticleAdmin && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
            <div className="mb-2">
              <h4 className="text-sm font-bold text-indigo-950">콘텐츠 업데이트</h4>
              <p className="text-xs text-indigo-700">
                언론사별 주요 뉴스를 가져와 학습 목록에 반영합니다.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <select
                  value={feedSourceKey}
                  onChange={(event) => setFeedSourceKey(event.target.value)}
                  className="h-9 min-w-[150px] rounded-lg border border-indigo-200 bg-white px-2 text-xs text-slate-700"
                >
                  <option value="">전체 언론사</option>
                  {(sourcesQuery.data?.sources || [])
                    .filter((source) => source.license_status === "approved" && source.feed_url)
                    .map((source) => (
                      <option key={source.key} value={source.key}>
                        {source.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={refreshFeeds}
                  disabled={isRefreshRunning}
                  className="h-9 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-50"
                >
                  {isRefreshRunning ? "업데이트 중" : "업데이트"}
                </button>
              </div>
            </div>
            {adminRefreshMutation.isError && (
              <p className="mt-2 text-xs text-rose-600">
                업데이트 실패: {adminRefreshMutation.error?.message || "확인 필요"}
              </p>
            )}
            {refreshJobQuery.isError && (
              <p className="mt-2 text-xs text-rose-600">
                업데이트 상태 확인 실패: {refreshJobQuery.error?.message || "확인 필요"}
              </p>
            )}
            {refreshJob && (
              <div className="mt-3 rounded-lg bg-white p-2">
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
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      refreshJob.status === "failed" ? "bg-rose-500" : "bg-indigo-600"
                    }`}
                    style={{ width: `${refreshJob.status === "completed" ? 100 : refreshProgress}%` }}
                  />
                </div>
                {refreshJob.message && (
                  <p className="mt-1.5 text-xs text-slate-500">{refreshJob.message}</p>
                )}
                {refreshJob.results?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {refreshJob.results.map((item) => (
                      <p
                        key={item.source_key}
                        className={`text-xs ${item.ok ? "text-emerald-700" : "text-rose-600"}`}
                      >
                        {item.source}: {item.ok ? `${item.fetched}개 수집 · ${item.saved}개 저장` : item.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {adminListQuery.data?.articles?.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {adminListQuery.data.articles.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate text-slate-700">{item.title}</span>
                    <button
                      type="button"
                      disabled={adminPublishMutation.isPending}
                      onClick={() =>
                        adminPublishMutation.mutate({
                          id: item.id,
                          isPublished: !item.is_published,
                        })
                      }
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        item.is_published
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {item.is_published ? "공개" : "비공개"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <form onSubmit={submitSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={qInput}
              onChange={(event) => setQInput(event.target.value)}
              placeholder="기사 검색"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <button className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white" type="submit">
            검색
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {TOPICS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTopic(item.value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                topic === item.value
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {catalogQuery.isLoading && (
            <>
              <SkeletonBlock className="h-40 rounded-lg" />
              <SkeletonBlock className="h-40 rounded-lg" />
            </>
          )}
          {catalogQuery.isError && (
            <EmptyState title="기사 목록을 가져오지 못했어요" description="잠시 후 다시 시도해주세요." />
          )}
          {!catalogQuery.isLoading && !catalogQuery.isError && articles.length === 0 && (
            <EmptyState title="공개된 기사가 없어요" description="운영자가 검증한 기사가 공개되면 여기에 표시됩니다." />
          )}
          {articles.map((article) => (
            <div
              key={article.id}
              className="group w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-brand-300 hover:shadow-sm"
            >
              {article.image_url && (
                <img
                  src={articleImageUrl(article.image_url)}
                  alt=""
                  className="h-36 w-full object-cover transition group-hover:scale-[1.01]"
                  loading="lazy"
                />
              )}
              <div className="p-3">
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span>{article.source || shortHost(article.url)}</span>
                  {article.topic && <span className="rounded-full bg-slate-100 px-2 py-0.5">{article.topic}</span>}
                </div>
                <p className="line-clamp-2 text-sm font-bold leading-5 text-slate-950">{article.title}</p>
                {article.description && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{article.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    {formatDate(article.published_at || article.created_at)}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      원문 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => startArticle(article.id)}
                      disabled={startMutation.isPending}
                      className="h-8 rounded-lg bg-brand-600 px-2.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      학습
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
        {!activeSessionId && (
          <div className="flex min-h-[460px] items-center justify-center">
            <EmptyState
              title="학습할 기사를 선택하세요"
              description="기사 카드의 원문을 먼저 확인하고, 짧은 리드문으로 핵심 표현을 학습하세요."
            />
          </div>
        )}

        {activeSessionId && sessionQuery.isLoading && (
          <div className="space-y-3">
            <SkeletonBlock className="h-52 rounded-lg" />
            <SkeletonBlock className="h-32 rounded-lg" />
            <SkeletonBlock className="h-32 rounded-lg" />
          </div>
        )}

        {activeSessionId && sessionData && (
          <div className="space-y-5">
            <header className="overflow-hidden rounded-lg border border-slate-200">
              {sessionData.image_url && (
                <div className="bg-slate-100">
                  <img
                    src={articleImageUrl(sessionData.image_url)}
                    alt=""
                    className="mx-auto max-h-[420px] w-auto max-w-full"
                  />
                </div>
              )}
              <div className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{sessionData.source || shortHost(sessionData.url)}</span>
                  {sessionData.published_at && <span>· {formatDate(sessionData.published_at)}</span>}
                </div>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <h4 className="text-xl font-bold leading-snug text-slate-950">
                    {study?.headline_ko || sessionData.title}
                  </h4>
                  <a
                    href={sessionData.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    원문 <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                {sessionData.description && (
                  <p className="mt-2 text-sm leading-6 text-slate-500">{sessionData.description}</p>
                )}
              </div>
            </header>

            {studyMutation.isPending && !hasStudy(study) && (
              <LoadingSpinner label="리드문에서 핵심 표현을 분석하고 있습니다" />
            )}

            {hasStudy(study) && (
              <div className="space-y-4">
                {study.paragraphs.map((paragraph, index) => {
                  const chunk = chunkMap[paragraph.chunk_id];
                  return (
                    <article key={`${paragraph.chunk_id}-${index}`} className="rounded-lg border border-slate-200 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                          {index + 1}
                        </span>
                        <p className="text-xs font-semibold text-slate-500">리드문 코칭</p>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{chunk?.text || ""}</p>
                      <div className="mt-3 rounded-lg bg-slate-50 p-3">
                        <p className="text-sm leading-6 text-slate-700">{paragraph.explanation_ko}</p>
                        {paragraph.check_question && (
                          <div className="mt-3 border-t border-slate-200 pt-3 text-sm">
                            <p className="font-semibold text-slate-700">{paragraph.check_question}</p>
                            {paragraph.answer_ko && <p className="mt-1 text-slate-500">{paragraph.answer_ko}</p>}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {expressions.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-bold text-slate-900">저장할 표현</h5>
                    <p className="text-xs text-slate-500">기사 문장에서 바로 복습할 표현을 고르세요.</p>
                  </div>
                  <button
                    type="button"
                    onClick={saveSelected}
                    disabled={!selectedExpressions.length || saveWordsMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {saveWordsMutation.isPending ? "저장 중" : `선택 ${selectedExpressions.length}개 저장`}
                  </button>
                </div>
                {saveWordsMutation.isSuccess && (
                  <p className="mt-2 text-xs text-emerald-600">
                    {saveWordsMutation.data?.added || 0}개 저장, {saveWordsMutation.data?.skipped || 0}개 건너뜀
                  </p>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {expressions.map((item) => {
                    const selected = selectedKeys.has(item.key);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => toggleExpression(item.key)}
                        className={`rounded-lg border p-3 text-left text-sm ${
                          selected ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-slate-900">{item.word}</span>
                          {selected && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                        </div>
                        {item.korean && <p className="mt-1 text-slate-600">{item.korean}</p>}
                        {item.english_def && <p className="mt-1 text-xs text-slate-500">{item.english_def}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-4">
                <h5 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <MessageSquare className="h-4 w-4" />
                  리드문에 질문
                </h5>
                <div className="mt-3 flex gap-2">
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") ask();
                    }}
                    placeholder="리드문 내용에 대해 질문"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-500"
                  />
                  <button
                    type="button"
                    onClick={ask}
                    disabled={askMutation.isPending || !question.trim()}
                    className="rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    질문
                  </button>
                </div>
                {askMutation.isPending && <LoadingSpinner className="mt-3" label="리드문 근거를 확인하고 있습니다" />}
                {askMutation.data?.answer && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="whitespace-pre-wrap text-slate-700">{askMutation.data.answer.answer_ko}</p>
                    {askMutation.data.answer.answer_en && (
                      <p className="mt-2 text-slate-500">{askMutation.data.answer.answer_en}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <h5 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <BookOpen className="h-4 w-4" />
                  학습 마무리
                </h5>
                <button
                  type="button"
                  onClick={() => completeMutation.mutate(activeSessionId)}
                  disabled={completeMutation.isPending || !hasStudy(study)}
                  className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {completeMutation.isPending ? "정리 중" : "리드문 요약·퀴즈 만들기"}
                </button>
                {completion?.summary_ko && (
                  <div className="mt-3 space-y-3 text-sm">
                    <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-700">
                      {completion.summary_ko}
                    </p>
                    {Array.isArray(completion.quiz) && completion.quiz.length > 0 && (
                      <ul className="space-y-2">
                        {completion.quiz.map((item, index) => (
                          <li key={index} className="rounded-lg border border-slate-100 p-2">
                            <p className="font-semibold text-slate-800">{item.question}</p>
                            <p className="mt-1 text-slate-500">{item.answer}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {sessionsQuery.data?.sessions?.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h4 className="text-sm font-bold text-slate-900">최근 뉴스 리딩 노트</h4>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {sessionsQuery.data.sessions.slice(0, 6).map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 p-3">
                <button type="button" onClick={() => setActiveSessionId(item.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold text-slate-800">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {item.source || shortHost(item.url)} · {formatDate(item.created_at)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(item.id)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                  aria-label="삭제"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
