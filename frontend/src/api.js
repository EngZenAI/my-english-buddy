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
  roleplayStart: () => jsonFetch("/api/roleplay/start", { method: "POST" }),
  roleplayContinue: (history, message) =>
    jsonFetch("/api/roleplay/continue", {
      method: "POST",
      body: JSON.stringify({ history, message }),
    }),
};

export const GOOGLE_LOGIN_URL = `${BACKEND_ORIGIN}/auth/google/login`;
