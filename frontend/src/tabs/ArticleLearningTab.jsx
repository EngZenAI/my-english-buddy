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
  { value: "technology", label: "Tech" },
  { value: "science", label: "Science" },
  { value: "health", label: "Health" },
  { value: "culture", label: "Culture" },
];

const LEVELS = [
  { value: "", label: "전체 난이도" },
  { value: "easy", label: "쉬움" },
  { value: "medium", label: "보통" },
  { value: "hard", label: "어려움" },
];

const LEVEL_LABELS = { easy: "쉬움", medium: "보통", hard: "어려움" };

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

function hasStudy(study) {
  return Array.isArray(study?.paragraphs) && study.paragraphs.length > 0;
}

export default function ArticleLearningTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [question, setQuestion] = useState("");
  const [adminUrl, setAdminUrl] = useState("");
  const [adminTopic, setAdminTopic] = useState("science");
  const [adminPublish, setAdminPublish] = useState(true);

  const catalogQuery = useQuery({
    queryKey: queryKeys.articleCatalog(topic, level, q, 1),
    queryFn: () => api.articleCatalog({ topic, level, q, page: 1 }),
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
  const adminListQuery = useQuery({
    queryKey: queryKeys.articleAdminList,
    queryFn: api.articleAdminList,
    enabled: !!user && isArticleAdmin,
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
  const adminIngestMutation = useMutation({
    mutationFn: (payload) => api.articleAdminIngest(payload),
    onSuccess: () => {
      setAdminUrl("");
      queryClient.invalidateQueries({ queryKey: queryKeys.articleAdminList });
      queryClient.invalidateQueries({ queryKey: ["articles", "catalog"] });
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

  const submitAdminIngest = (event) => {
    event.preventDefault();
    const url = adminUrl.trim();
    if (!url) return;
    adminIngestMutation.mutate({
      url,
      topic: adminTopic,
      publish: adminPublish,
    });
  };

  return (
    <div className="grid min-h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[390px_minmax(0,1fr)]">
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">영어 기사 학습</h3>
          <p className="text-sm text-slate-500">
            검증된 영어 기사만 골라 문단별 독해 수업으로 제공합니다.
          </p>
        </div>

        {!user && <MemberNotice feature="기사 학습" onRequireLogin={onRequireLogin} />}

        {user && isArticleAdmin && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
            <div className="mb-2">
              <h4 className="text-sm font-bold text-indigo-950">기사 운영자 등록</h4>
              <p className="text-xs text-indigo-700">
                지원 소스 URL을 넣으면 제목, 이미지, 본문을 추출해 피드에 공개합니다.
              </p>
            </div>
            <form onSubmit={submitAdminIngest} className="space-y-2">
              <input
                value={adminUrl}
                onChange={(event) => setAdminUrl(event.target.value)}
                placeholder="https://www.nasa.gov/..."
                className="h-10 w-full rounded-lg border border-indigo-200 bg-white px-3 text-sm outline-none focus:border-indigo-500"
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={adminTopic}
                  onChange={(event) => setAdminTopic(event.target.value)}
                  className="h-9 rounded-lg border border-indigo-200 bg-white px-2 text-xs text-slate-700"
                >
                  {TOPICS.filter((item) => item.value).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={adminPublish}
                    onChange={(event) => setAdminPublish(event.target.checked)}
                  />
                  바로 공개
                </label>
                <button
                  type="submit"
                  disabled={adminIngestMutation.isPending || !adminUrl.trim()}
                  className="h-9 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-50"
                >
                  {adminIngestMutation.isPending ? "등록 중" : "등록"}
                </button>
              </div>
            </form>
            {adminIngestMutation.isError && (
              <p className="mt-2 text-xs text-rose-600">
                등록 실패: {adminIngestMutation.error?.message || "확인 필요"}
              </p>
            )}
            {adminIngestMutation.isSuccess && (
              <p className="mt-2 text-xs text-emerald-700">
                등록 완료. 공개 상태: {adminIngestMutation.data?.published ? "공개" : "비공개"} · 문단 {adminIngestMutation.data?.chunk_count || 0}개
              </p>
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

        <div className="flex flex-wrap gap-1.5">
          {LEVELS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setLevel(item.value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                level === item.value
                  ? "border-slate-900 bg-slate-900 text-white"
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
            <button
              key={article.id}
              type="button"
              onClick={() => startArticle(article.id)}
              disabled={startMutation.isPending}
              className="group w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-brand-300 hover:shadow-sm disabled:opacity-60"
            >
              {article.image_url && (
                <img
                  src={article.image_url}
                  alt=""
                  className="h-36 w-full object-cover transition group-hover:scale-[1.01]"
                  loading="lazy"
                />
              )}
              <div className="p-3">
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span>{article.source || shortHost(article.url)}</span>
                  {article.topic && <span className="rounded-full bg-slate-100 px-2 py-0.5">{article.topic}</span>}
                  {article.level && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                      {LEVEL_LABELS[article.level] || article.level}
                    </span>
                  )}
                  {article.estimated_minutes && <span>{article.estimated_minutes}분</span>}
                </div>
                <p className="line-clamp-2 text-sm font-bold leading-5 text-slate-950">{article.title}</p>
                {article.description && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{article.description}</p>
                )}
                <div className="mt-2 text-[11px] text-slate-400">
                  {formatDate(article.published_at || article.created_at)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
        {!activeSessionId && (
          <div className="flex min-h-[460px] items-center justify-center">
            <EmptyState
              title="학습할 기사를 선택하세요"
              description="기사 카드를 클릭하면 문단별 AI 튜터가 바로 생성됩니다."
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
                <img src={sessionData.image_url} alt="" className="h-56 w-full object-cover" />
              )}
              <div className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{sessionData.source || shortHost(sessionData.url)}</span>
                  {sessionData.published_at && <span>· {formatDate(sessionData.published_at)}</span>}
                  {(study?.level || sessionData.level) && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                      {LEVEL_LABELS[study.level || sessionData.level] || study.level || sessionData.level}
                    </span>
                  )}
                  {(study?.estimated_minutes || sessionData.estimated_minutes) && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      {study.estimated_minutes || sessionData.estimated_minutes}분
                    </span>
                  )}
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
              <LoadingSpinner label="기사 문단을 분석하고 있습니다" />
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
                        <p className="text-xs font-semibold text-slate-500">문단 코칭</p>
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
                    {saveWordsMutation.isPending ? "저장 중" : `뉴스 태그로 저장 (${selectedExpressions.length})`}
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
                  기사에 질문
                </h5>
                <div className="mt-3 flex gap-2">
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") ask();
                    }}
                    placeholder="기사 내용에 대해 질문"
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
                {askMutation.isPending && <LoadingSpinner className="mt-3" label="근거 문단을 찾고 있습니다" />}
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
                  {completeMutation.isPending ? "정리 중" : "요약·퀴즈 만들기"}
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
          <h4 className="text-sm font-bold text-slate-900">최근 기사 학습노트</h4>
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
