// 백엔드 REST API 클라이언트.
// dev 환경에서는 Vite 프록시가 /api·/auth를 백엔드로 넘긴다.

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

const DEFAULT_DEV_BACKEND_ORIGIN =
  typeof window === "undefined"
    ? "http://localhost:8000"
    : `${window.location.protocol}//${window.location.hostname}:8000`;

const BACKEND_ORIGIN =
  import.meta.env.VITE_BACKEND_ORIGIN ||
  (import.meta.env.DEV ? DEFAULT_DEV_BACKEND_ORIGIN : "");

export const api = {
  // ── 인증 상태 ──
  me: () => jsonFetch("/api/me"),
  myPageOverview: () => jsonFetch("/api/mypage/overview"),
  myPageLearning: () => jsonFetch("/api/mypage/learning"),
  myPageActivity: () => jsonFetch("/api/mypage/activity"),
  accountStatus: () => jsonFetch("/api/account/status"),
  updateAccountPassword: (currentPassword, newPassword) =>
    jsonFetch("/api/account/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    }),
  disconnectOAuth: (provider) =>
    jsonFetch(`/api/account/oauth/${encodeURIComponent(provider)}`, {
      method: "DELETE",
    }),

  login: async (email, password) => {
    const form = new URLSearchParams();
    form.append("username", email.trim());
    form.append("password", password);
    const res = await fetch("/auth/cookie/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      credentials: "same-origin",
    });
    return res.ok;
  },

  logout: async () => {
    const res = await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    return res.ok;
  },

  register: async (email, password) => {
    const res = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
      credentials: "same-origin",
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, detail: data.detail };
  },

  requestPasswordReset: async (email) => {
    const res = await fetch("/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, ...data };
    return { ok: false, detail: data.detail };
  },

  confirmPasswordReset: async (email, code, password) => {
    const res = await fetch("/auth/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), code: code.trim(), password }),
      credentials: "same-origin",
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, detail: data.detail };
  },

  verifyPasswordResetCode: async (email, code) => {
    const res = await fetch("/auth/password-reset/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      credentials: "same-origin",
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, detail: data.detail };
  },

  // ── 검색 (signal: react-query가 입력이 바뀌면 이전 요청을 취소) ──
  searchEnglish: (word, signal) =>
    jsonFetch(`/api/search/english?word=${encodeURIComponent(word)}`, { signal }),
  searchKorean: (word, signal) =>
    jsonFetch(`/api/search/korean?word=${encodeURIComponent(word)}`, { signal }),

  // ── TTS ──
  tts: (word, lang = "en") =>
    jsonFetch(`/api/tts?word=${encodeURIComponent(word)}&lang=${lang}`),

  // ── 라벨(카테고리) ──
  listLabels: () => jsonFetch("/api/labels"),
  addLabel: (name) =>
    jsonFetch("/api/labels", { method: "POST", body: JSON.stringify({ name }) }),
  renameLabel: (oldName, newName) =>
    jsonFetch("/api/labels/rename", {
      method: "POST",
      body: JSON.stringify({ old_name: oldName, new_name: newName }),
    }),
  labelWordCount: (tag) =>
    jsonFetch(`/api/labels/word-count?tag=${encodeURIComponent(tag)}`),
  deleteLabel: (name) =>
    jsonFetch(`/api/labels?name=${encodeURIComponent(name)}`, { method: "DELETE" }),

  // ── 단어장 ──
  listWords: (tag) =>
    jsonFetch(`/api/words${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`),
  wordSaved: (word, signal) =>
    jsonFetch(`/api/words/saved?word=${encodeURIComponent(word)}`, { signal }),
  saveWord: (payload) =>
    jsonFetch("/api/words", { method: "POST", body: JSON.stringify(payload) }),
  updateWord: (id, payload) =>
    jsonFetch(`/api/words/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteWord: (id) =>
    jsonFetch(`/api/words/${id}`, { method: "DELETE" }),
  bulkUpdateWords: (items) =>
    jsonFetch("/api/words/bulk-update", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  bulkDeleteWords: (ids) =>
    jsonFetch("/api/words/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  reorderWords: (ids) =>
    jsonFetch("/api/words/reorder", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  importPreview: async (file) => {
    const form = new FormData();
    form.append("file", file);
    // multipart라 Content-Type은 브라우저가 boundary와 함께 자동 설정 (수동 지정 금지)
    const res = await fetch("/api/words/import/preview", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${text}`);
    }
    return res.json();
  },
  importCommit: (items, overwrite = false) =>
    jsonFetch("/api/words/import/commit", {
      method: "POST",
      body: JSON.stringify({ items, overwrite }),
    }),

  // ── 슬랭 ──
  slang: (word, korean) =>
    jsonFetch("/api/slang", {
      method: "POST",
      body: JSON.stringify({ word, korean }),
    }),

  // ── 퀴즈 ──
  quizGenerate: (payload) =>
    jsonFetch("/api/quiz/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  quizGrade: (answerToken, answers) =>
    jsonFetch("/api/quiz/grade", {
      method: "POST",
      body: JSON.stringify({ answer_token: answerToken, answers }),
    }),
  quizApplyReviewSchedule: (sessionId, incorrectInterval = "1d") =>
    jsonFetch("/api/quiz/review-schedule/apply", {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionId,
        incorrect_interval: incorrectInterval,
      }),
    }),
  quizStats: () => jsonFetch("/api/quiz/stats"),

  // ── 롤플레잉 ──
  // opts: { level, scenario, tag, situation } — 세션 설정. 매 턴 함께 전달해 일관 유지.
  roleplayStart: (opts = {}) =>
    jsonFetch("/api/roleplay/start", {
      method: "POST",
      body: JSON.stringify({
        level: opts.level ?? "intermediate",
        scenario: opts.scenario ?? "general",
        tag: opts.tag ?? null,
        situation: opts.situation ?? "",
      }),
    }),
  roleplayContinue: (history, message, opts = {}) =>
    jsonFetch("/api/roleplay/continue", {
      method: "POST",
      body: JSON.stringify({
        history,
        message,
        level: opts.level ?? "intermediate",
        scenario: opts.scenario ?? "general",
        tag: opts.tag ?? null,
        situation: opts.situation ?? "",
        wrap_up: opts.wrapUp ?? false,
      }),
    }),
  // 대화 종료 후 정리: 요약 + 유용 표현 + 유용 어휘 추출
  roleplaySummary: (history, opts = {}) =>
    jsonFetch("/api/roleplay/summary", {
      method: "POST",
      body: JSON.stringify({
        history,
        level: opts.level ?? "intermediate",
        scenario: opts.scenario ?? "general",
        tag: opts.tag ?? null,
        situation: opts.situation ?? "",
        title: opts.title ?? "",
      }),
    }),
  // 정리 페이지에서 선택한 어휘를 단어장에 저장
  roleplaySaveWords: (items, tag = null) =>
    jsonFetch("/api/roleplay/save-words", {
      method: "POST",
      body: JSON.stringify({ items, tag }),
    }),
  // 학습노트: 저장된 롤플레잉
  roleplaySessions: () => jsonFetch("/api/roleplay/sessions"),
  roleplayDeleteSession: (id) =>
    jsonFetch(`/api/roleplay/sessions/${id}`, { method: "DELETE" }),

  // ── 기사 학습 ──
  articleCatalog: ({ topic = "", level = "", q = "", page = 1 } = {}) => {
    const params = new URLSearchParams();
    if (topic) params.set("topic", topic);
    if (level) params.set("level", level);
    if (q) params.set("q", q);
    params.set("page", String(page));
    return jsonFetch(`/api/articles?${params.toString()}`);
  },
  articleSources: () => jsonFetch("/api/article-sources"),
  articleAdminStatus: () => jsonFetch("/api/article-admin/status"),
  articleAdminList: () => jsonFetch("/api/admin/articles"),
  articleDetail: (id) => jsonFetch(`/api/articles/${id}`),
  articleCreateSession: (articleId) =>
    jsonFetch(`/api/articles/${articleId}/sessions`, { method: "POST" }),
  articleSession: (id) => jsonFetch(`/api/article-sessions/${id}`),
  articleSessions: () => jsonFetch("/api/article-sessions"),
  articleStudy: (id) =>
    jsonFetch(`/api/article-sessions/${id}/study`, { method: "POST" }),
  articleAsk: (id, question) =>
    jsonFetch(`/api/article-sessions/${id}/ask`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
  articleComplete: (id) =>
    jsonFetch(`/api/article-sessions/${id}/complete`, { method: "POST" }),
  articleSaveWords: (sessionId, items, tag = "뉴스") =>
    jsonFetch(`/api/article-sessions/${sessionId}/save-words`, {
      method: "POST",
      body: JSON.stringify({ items, tag }),
    }),
  articleDeleteSession: (id) =>
    jsonFetch(`/api/article-sessions/${id}`, { method: "DELETE" }),
  articleAdminFeedRefresh: (payload = {}) =>
    jsonFetch("/api/admin/article-feeds/refresh", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  articleAdminFeedRefreshStatus: (jobId) =>
    jsonFetch(`/api/admin/article-feeds/refresh/${encodeURIComponent(jobId)}`),
  articleAdminPublish: (id, isPublished = true) =>
    jsonFetch(`/api/admin/articles/${id}/publish`, {
      method: "PATCH",
      body: JSON.stringify({ is_published: isPublished }),
    }),
};

export const GOOGLE_LOGIN_URL = `${BACKEND_ORIGIN}/auth/google/login`;
