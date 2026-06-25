import { QueryClient } from "@tanstack/react-query";

export const queryKeys = {
  me: ["me"],
  labels: ["labels"],
  words: (tag = "") => ["words", tag || ""],
  search: (type, word) => ["search", type, word.trim().toLowerCase()],
  wordSaved: (userId, word) => ["word-saved", userId, word.trim().toLowerCase()],
  labelWordCount: (label) => ["label-word-count", label],
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
