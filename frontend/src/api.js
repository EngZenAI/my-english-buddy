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

  // ── 검색 ──
  searchEnglish: (word) =>
    jsonFetch(`/api/search/english?word=${encodeURIComponent(word)}`),
  searchKorean: (word) =>
    jsonFetch(`/api/search/korean?word=${encodeURIComponent(word)}`),

  // ── TTS ──
  tts: (word, lang = "en") =>
    jsonFetch(`/api/tts?word=${encodeURIComponent(word)}&lang=${lang}`),

  // ── 라벨(카테고리) ──
  listLabels: () => jsonFetch("/api/labels"),
  addLabel: (name) =>
    jsonFetch("/api/labels", { method: "POST", body: JSON.stringify({ name }) }),

  // ── 단어장 ──
  listWords: (tag) =>
    jsonFetch(`/api/words${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`),
  wordSaved: (word) =>
    jsonFetch(`/api/words/saved?word=${encodeURIComponent(word)}`),
  saveWord: (payload) =>
    jsonFetch("/api/words", { method: "POST", body: JSON.stringify(payload) }),

  // ── 슬랭 ──
  slang: (word, korean) =>
    jsonFetch("/api/slang", {
      method: "POST",
      body: JSON.stringify({ word, korean }),
    }),

  // ── 퀴즈 ──
  quizGenerate: () => jsonFetch("/api/quiz/generate", { method: "POST" }),
  quizGrade: (words, quizText, userAnswer) =>
    jsonFetch("/api/quiz/grade", {
      method: "POST",
      body: JSON.stringify({ words, quiz_text: quizText, user_answer: userAnswer }),
    }),

  // ── 롤플레잉 ──
  roleplayStart: () => jsonFetch("/api/roleplay/start", { method: "POST" }),
  roleplayContinue: (history, message) =>
    jsonFetch("/api/roleplay/continue", {
      method: "POST",
      body: JSON.stringify({ history, message }),
    }),
};

export const LOGOUT_URL = "/auth/logout";
export const GOOGLE_LOGIN_URL = "/auth/google/login";
