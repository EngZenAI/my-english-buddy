import { QueryClient } from "@tanstack/react-query";

export const queryKeys = {
  me: ["me"],
  myPageOverview: ["mypage", "overview"],
  myPageLearning: ["mypage", "learning"],
  myPageActivity: ["mypage", "activity"],
  accountStatus: ["account", "status"],
  labels: ["labels"],
  words: (tag = "") => ["words", tag || ""],
  search: (type, word) => ["search", type, word.trim().toLowerCase()],
  wordSaved: (userId, word) => ["word-saved", userId, word.trim().toLowerCase()],
  labelWordCount: (userId, label) => ["label-word-count", userId, label],
  roleplaySessions: ["roleplay-sessions"],
  articleCatalog: (topic = "", level = "", q = "", page = 1) => [
    "articles",
    "catalog",
    topic,
    level,
    q.trim().toLowerCase(),
    page,
  ],
  articleSources: ["articles", "sources"],
  articleAdminStatus: ["articles", "admin-status"],
  articleAdminList: ["articles", "admin-list"],
  articleSession: (id) => ["articles", "session", id],
  articleSessions: ["articles", "sessions"],
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});
