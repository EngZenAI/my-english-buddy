import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Tags,
  X,
} from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import AudioButton from "../components/AudioButton";
import { LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

const DEBOUNCE_MS = 250;
const RECENT_SEARCHES_KEY = "englishBuddy.recentSearches.v1";
const MAX_RECENT_SEARCHES = 12;

const isKoreanQuery = (value) => /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value);

const loadRecentSearches = () => {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_SEARCHES) : [];
  } catch {
    return [];
  }
};

const persistRecentSearches = (items) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items));
  } catch {
    // Local browser history is best-effort only.
  }
};

const getRecentKey = (entry) =>
  `${entry.type}:${(entry.query || entry.word || "").trim().toLowerCase()}`;

const IconButton = ({ children, className = "", ...props }) => (
  <button
    type="button"
    className={`inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

const SaveButton = ({ saved, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex h-9 min-w-[104px] items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors
      ${
        saved
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-[#b7dcd3] bg-[#e7f3ef] text-[#286d65] hover:bg-[#d7ebe5]"
      }
      disabled:cursor-not-allowed disabled:opacity-60`}
  >
    {saved ? (
      <>
        <CheckCircle2 className="h-4 w-4" />
        저장됨
      </>
    ) : (
      <>
        <Bookmark className="h-4 w-4" />
        단어장에 저장
      </>
    )}
  </button>
);

const SECTION_CARD_CLASS = "rounded-md border border-slate-200 bg-white p-4";
const SECTION_LABEL_CLASS = "text-sm font-semibold text-slate-800";

const ReadOnlyField = ({ label, value, rows = 3, loading }) => (
  <div className={SECTION_CARD_CLASS}>
    <label className={`mb-3 block ${SECTION_LABEL_CLASS}`}>{label}</label>
    {loading ? (
      <SkeletonBlock className={rows >= 4 ? "h-28" : "h-24"} />
    ) : (
      <textarea
        readOnly
        rows={rows}
        value={value || ""}
        className="w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none"
      />
    )}
  </div>
);

const SearchInputRow = ({
  label,
  value,
  onChange,
  onSearch,
  placeholder,
  audio,
}) => (
  <div className={SECTION_CARD_CLASS}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className={SECTION_LABEL_CLASS}>{label}</span>
      {audio}
    </div>
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={onChange}
        onKeyDown={(e) => e.key === "Enter" && onSearch()}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#5ba79a] focus:ring-2 focus:ring-[#d7ebe5]"
      />
      <IconButton onClick={onSearch} aria-label={`${label} 검색`}>
        <Search className="h-4 w-4" />
      </IconButton>
    </div>
  </div>
);

function RecentSearchChips({ items, onSelect, onRemove }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <span className="mr-1 text-xs font-semibold text-slate-500">최근 검색</span>
      {items.map((item) => {
        const title = item.word || item.query;
        const subtitle = item.korean || "";
        return (
          <span
            key={getRecentKey(item)}
            className="group inline-flex max-w-full items-center overflow-hidden rounded-full border border-slate-200 bg-white text-xs shadow-sm transition hover:border-[#b7dcd3] hover:bg-[#f4faf8]"
          >
            <button
              type="button"
              onClick={() => onSelect(item)}
              className="inline-flex min-w-0 items-center gap-2 py-1.5 pl-3 pr-1 text-left"
            >
              <span className="min-w-0 truncate font-semibold text-slate-800">
                {title}
              </span>
              {subtitle && (
                <span className="hidden max-w-24 truncate text-slate-400 sm:inline">
                  {subtitle}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label={`${title} 최근 검색 삭제`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item);
              }}
              className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

export default function SearchTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const [quickQuery, setQuickQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
  const [eng, setEng] = useState("");
  const [kor, setKor] = useState("");
  const [engDef, setEngDef] = useState("");
  const [korDetail, setKorDetail] = useState("");
  const [example, setExample] = useState("");
  const [customExample, setCustomExample] = useState("");
  const [phonetic, setPhonetic] = useState("");
  const [gate, setGate] = useState("");

  const [label, setLabel] = useState("미지정");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [labelError, setLabelError] = useState("");

  const [slangVisible, setSlangVisible] = useState(false);
  const [slangText, setSlangText] = useState("");

  const lastSearched = useRef({ en: "", ko: "" });
  const source = useRef(null);
  const reqSeq = useRef(0);
  const appliedSearchKey = useRef("");
  const [searchRequest, setSearchRequest] = useState(null);
  const [appliedKey, setAppliedKey] = useState("");
  const [settledWord, setSettledWord] = useState("");

  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const labels = labelsQuery.data?.labels || [];

  const searchQuery = useQuery({
    queryKey: searchRequest
      ? queryKeys.search(searchRequest.type, searchRequest.word)
      : ["search", "idle"],
    queryFn: ({ signal }) =>
      searchRequest.type === "en"
        ? api.searchEnglish(searchRequest.word, signal)
        : api.searchKorean(searchRequest.word, signal),
    enabled: !!searchRequest?.word,
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });

  const currentKey = searchRequest
    ? `${searchRequest.type}:${searchRequest.word}`
    : "";
  const searchSettled =
    !!searchRequest && !searchQuery.isFetching && appliedKey === currentKey;

  const savedWord = eng.trim();
  const userId = user?.id || "";
  const savedQuery = useQuery({
    queryKey: queryKeys.wordSaved(userId, savedWord),
    queryFn: ({ signal }) => api.wordSaved(savedWord, signal),
    enabled: !!userId && !!savedWord && searchSettled,
    staleTime: 0,
  });

  const saved = savedQuery.data?.saved === true;

  const rememberSearch = (entry) => {
    const query = (entry.query || entry.word || "").trim();
    if (!query) return;
    const normalized = {
      type: entry.type,
      query,
      word: (entry.word || query).trim(),
      korean: (entry.korean || "").trim(),
      createdAt: Date.now(),
    };
    setRecentSearches((prev) => {
      const key = getRecentKey(normalized);
      const next = [
        normalized,
        ...prev.filter((item) => getRecentKey(item) !== key),
      ].slice(0, MAX_RECENT_SEARCHES);
      persistRecentSearches(next);
      return next;
    });
  };

  const removeRecentSearch = (entry) => {
    const key = getRecentKey(entry);
    setRecentSearches((prev) => {
      const next = prev.filter((item) => getRecentKey(item) !== key);
      persistRecentSearches(next);
      return next;
    });
  };

  const saveWordMutation = useMutation({
    mutationFn: (payload) => api.saveWord(payload),
    onSuccess: (res, payload) => {
      if (!res.saved) return;
      queryClient.setQueryData(queryKeys.wordSaved(userId, payload.word), { saved: true });
      queryClient.invalidateQueries({ queryKey: ["words"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
      queryClient.invalidateQueries({ queryKey: ["label-word-count"] });
    },
  });

  const addLabelMutation = useMutation({
    mutationFn: api.addLabel,
    onSuccess: ({ labels: next, ok }, name) => {
      queryClient.setQueryData(queryKeys.labels, { labels: next });
      if (ok) {
        setLabel(name);
        setNewLabel("");
        setAdding(false);
        setLabelError("");
      } else {
        setLabelError("태그는 최대 20개까지 추가할 수 있어요.");
      }
    },
  });

  const slangMutation = useMutation({
    mutationFn: ({ engWord, korWord }) => api.slang(engWord, korWord),
    onMutate: () => {
      setSlangText("");
    },
    onSuccess: ({ explanation }, { engWord, korWord }) => {
      if (eng.trim() !== engWord || kor.trim() !== korWord) return;
      setSlangText(explanation);
    },
    onError: (_error, { engWord, korWord }) => {
      if (eng.trim() !== engWord || kor.trim() !== korWord) return;
      setSlangText("AI 의미 분석에 실패했습니다. 잠시 후 다시 시도해주세요.");
    },
  });

  const applyCommon = (r) => {
    setEngDef(r.english_def);
    setKorDetail(r.korean_detail);
    setExample(r.example);
    setCustomExample(r.example);
    setPhonetic(r.phonetic || "");
    setSlangVisible(!!r.english_word);
    setSlangText("");
  };

  const resetResultState = () => {
    setEngDef("");
    setKorDetail("");
    setExample("");
    setCustomExample("");
    setPhonetic("");
    setSlangVisible(false);
    setSlangText("");
  };

  useEffect(() => {
    const r = searchQuery.data;
    if (!r || !searchRequest) return;
    const key = `${searchRequest.type}:${searchRequest.word}`;
    if (appliedSearchKey.current === key) return;
    appliedSearchKey.current = key;
    setAppliedKey(key);
    if (!r.english_word && !r.korean_word && !r.english_def && !r.korean_detail) {
      resetResultState();
      const nextWord = searchRequest.type === "en" ? searchRequest.word : eng.trim();
      setSettledWord(nextWord);
      rememberSearch({
        type: searchRequest.type,
        query: searchRequest.word,
        word: nextWord || searchRequest.word,
        korean: searchRequest.type === "ko" ? searchRequest.word : kor.trim(),
      });
      return;
    }
    applyCommon(r);
    if (searchRequest.type === "en") {
      lastSearched.current.ko = r.korean_word;
      setKor(r.korean_word);
      setSettledWord(searchRequest.word);
      rememberSearch({
        type: "en",
        query: searchRequest.word,
        word: searchRequest.word,
        korean: r.korean_word,
      });
    } else {
      lastSearched.current.en = r.english_word;
      setEng(r.english_word);
      setSettledWord(r.english_word);
      rememberSearch({
        type: "ko",
        query: searchRequest.word,
        word: r.english_word || searchRequest.word,
        korean: searchRequest.word,
      });
    }
  }, [searchQuery.data, searchRequest]);

  useEffect(() => {
    if (!searchQuery.isError || !searchRequest) return;
    resetResultState();
    const key = `${searchRequest.type}:${searchRequest.word}`;
    appliedSearchKey.current = key;
    setAppliedKey(key);
    const nextWord = searchRequest.type === "en" ? searchRequest.word : eng.trim();
    setSettledWord(nextWord);
    rememberSearch({
      type: searchRequest.type,
      query: searchRequest.word,
      word: nextWord || searchRequest.word,
      korean: searchRequest.type === "ko" ? searchRequest.word : kor.trim(),
    });
  }, [searchQuery.isError, searchRequest]);

  const runEnglish = (word) => {
    const w = word.trim();
    if (!w) return;
    lastSearched.current.en = w;
    reqSeq.current += 1;
    appliedSearchKey.current = "";
    setAppliedKey("");
    setSettledWord("");
    resetResultState();
    setQuickQuery(w);
    setSearchRequest({ type: "en", word: w });
  };

  const runKorean = (word) => {
    const w = word.trim();
    if (!w) return;
    lastSearched.current.ko = w;
    reqSeq.current += 1;
    appliedSearchKey.current = "";
    setAppliedKey("");
    setSettledWord("");
    resetResultState();
    setQuickQuery(w);
    setSearchRequest({ type: "ko", word: w });
  };

  const runSmartSearch = (value = quickQuery) => {
    const q = value.trim();
    if (!q) return;
    if (isKoreanQuery(q)) {
      source.current = "ko";
      setKor(q);
      runKorean(q);
    } else {
      source.current = "en";
      setEng(q);
      runEnglish(q);
    }
  };

  const selectRecentSearch = (item) => {
    const q = item.query || item.word;
    if (!q) return;
    if (item.type === "ko") {
      source.current = "ko";
      setKor(q);
      runKorean(q);
    } else {
      source.current = "en";
      setEng(item.word || q);
      runEnglish(item.word || q);
    }
  };

  useEffect(() => {
    if (source.current !== "en") return;
    if (!eng.trim() || eng.trim() === lastSearched.current.en) return;
    const t = setTimeout(() => runEnglish(eng), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [eng]);

  useEffect(() => {
    if (source.current !== "ko") return;
    if (!kor.trim() || kor.trim() === lastSearched.current.ko) return;
    const t = setTimeout(() => runKorean(kor), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [kor]);

  const savedCheckReady = !user || (savedQuery.isSuccess && !savedQuery.isFetching);
  const resultMatchesInput =
    !!settledWord.trim() &&
    settledWord.trim().toLowerCase() === eng.trim().toLowerCase();
  const canSave =
    !!eng.trim() &&
    !saved &&
    !saveWordMutation.isPending &&
    searchSettled &&
    resultMatchesInput &&
    savedCheckReady;

  const handleSave = async () => {
    if (!canSave) return;
    if (!user) {
      setGate("단어장 저장");
      return;
    }
    saveWordMutation.mutate({
      word: eng.trim(),
      korean: kor,
      korean_detail: korDetail,
      english_def: engDef,
      example: customExample,
      tag: label || "미지정",
      slang_def: slangText,
    });
  };

  const handleAddLabel = async () => {
    const name = newLabel.trim();
    if (!name) return;
    if (labels.length >= 20 && !labels.includes(name)) {
      setLabelError("태그는 최대 20개까지 추가할 수 있어요.");
      return;
    }
    addLabelMutation.mutate(name);
  };

  const handleSlang = async () => {
    const engWord = eng.trim();
    const korWord = kor.trim();
    if (!user) {
      setGate("AI 슬랭 설명");
      return;
    }
    if (!engWord) {
      setSlangText("단어를 먼저 검색해주세요.");
      return;
    }
    slangMutation.mutate({ engWord, korWord });
  };

  const hasSearch = !!searchRequest;
  const searchLoading = searchQuery.isFetching && !searchQuery.data;
  const saveDisabled = !canSave;
  const isSearching = searchQuery.isFetching;

  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSmartSearch();
        }}
        className="space-y-2"
      >
        <div className="relative flex h-14 items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-[#5ba79a] focus-within:ring-2 focus-within:ring-[#d7ebe5]">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#2f7d73]" />
          <input
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            placeholder="Type word, sentence, or Korean meaning"
            className="h-full min-w-0 flex-1 bg-transparent pl-11 pr-3 text-base text-slate-950 outline-none placeholder:text-slate-400"
            style={{ paddingLeft: "2.75rem" }}
          />
          {quickQuery && (
            <button
              type="button"
              onClick={() => {
                setQuickQuery("");
              }}
              className="hidden h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 sm:inline-flex"
              aria-label="검색어 지우기"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            className="inline-flex h-full items-center gap-2 border-l border-[#d7ebe5] bg-[#2f7d73] px-5 text-sm font-semibold text-white transition hover:bg-[#286d65] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!quickQuery.trim()}
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            검색
          </button>
        </div>
        <RecentSearchChips
          items={recentSearches}
          onSelect={selectRecentSearch}
          onRemove={removeRecentSearch}
        />
      </form>

      {gate && !user && (
        <MemberNotice feature={gate} onRequireLogin={onRequireLogin} />
      )}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div
            className="border-b border-slate-100 px-5 py-5"
            style={{
              alignItems: "flex-start",
              display: "flex",
              flexWrap: "wrap",
              gap: "1rem",
              justifyContent: "space-between",
            }}
          >
            <div className="min-w-0 flex-1">
              {eng.trim() && (
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-bold tracking-normal text-slate-950">
                    {eng.trim()}
                  </h2>
                  <AudioButton word={eng} lang="en" phonetic={phonetic} />
                </div>
              )}
              {phonetic && (
                <p className="mt-1 text-sm text-slate-400">{phonetic}</p>
              )}
              {kor && (
                <div className={eng.trim() || phonetic ? "mt-3" : ""}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    한국어 뜻
                  </p>
                  <p className="mt-1 text-lg font-semibold leading-7 text-slate-900">
                    {kor}
                  </p>
                </div>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {searchQuery.isFetching ? (
                <LoadingSpinner label="검색 중" />
              ) : searchQuery.isError ? (
                <span className="text-sm font-medium text-rose-500">검색 실패</span>
              ) : null}
              <SaveButton
                saved={saved}
                onClick={handleSave}
                disabled={saveDisabled}
              />
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2">
            <SearchInputRow
              label="영어 단어"
              value={eng}
              onChange={(e) => {
                source.current = "en";
                setEng(e.target.value);
              }}
              onSearch={() => runEnglish(eng)}
              placeholder="예: cardiovascular"
              audio={<AudioButton word={eng} lang="en" phonetic={phonetic} />}
            />
            <SearchInputRow
              label="한국어 뜻"
              value={kor}
              onChange={(e) => {
                source.current = "ko";
                setKor(e.target.value);
              }}
              onSearch={() => runKorean(kor)}
              placeholder="예: 심혈관"
              audio={<AudioButton word={kor} lang="ko" />}
            />
          </div>

          {!hasSearch && (
            <div className="mx-5 mb-5 rounded-md border border-slate-200 bg-white px-4 py-4 text-sm font-medium text-slate-600">
              영어 단어나 한국어 뜻을 입력하면 사전 정의, 번역, 예문, 저장 옵션이 표시됩니다.
            </div>
          )}

          <div className="space-y-5 border-t border-slate-100 p-5">
            <div className={SECTION_CARD_CLASS}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <label className={SECTION_LABEL_CLASS}>
                  예문 편집
                </label>
                <span className="text-xs font-medium text-slate-500">
                  {customExample.length}/200
                </span>
              </div>
              <textarea
                rows={4}
                value={customExample}
                onChange={(e) => setCustomExample(e.target.value)}
                placeholder="내 상황에 맞는 예문을 직접 적어보세요"
                className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none transition focus:border-[#5ba79a] focus:ring-2 focus:ring-[#d7ebe5]"
              />
              {example && customExample !== example && (
                <button
                  type="button"
                  onClick={() => setCustomExample(example)}
                  className="mt-2 text-xs font-medium text-[#286d65] hover:text-[#184843]"
                >
                  사전 예문으로 되돌리기
                </button>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <ReadOnlyField
                label="사전 정의"
                value={engDef}
                rows={5}
                loading={searchLoading}
              />
              <ReadOnlyField
                label="한국어 상세"
                value={korDetail}
                rows={5}
                loading={searchLoading}
              />
            </div>

            <div className={SECTION_CARD_CLASS}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  <span className={SECTION_LABEL_CLASS}>AI 의미 분석</span>
                </div>
                <button
                  type="button"
                  onClick={handleSlang}
                  disabled={slangMutation.isPending || !eng.trim()}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {slangMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  AI에게 물어보기
                </button>
              </div>
              {slangVisible || slangText ? (
                <textarea
                  rows={slangText ? 8 : 4}
                  value={slangText}
                  onChange={(e) => setSlangText(e.target.value)}
                  placeholder="AI 답변을 받은 뒤 내 표현에 맞게 고쳐서 저장할 수 있어요"
                  className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none transition focus:border-[#5ba79a] focus:ring-2 focus:ring-[#d7ebe5]"
                />
              ) : (
                <p className="text-sm font-medium leading-6 text-slate-600">
                  검색 결과가 의도한 뜻과 다르면 AI 설명을 받아 저장 내용에 반영할 수 있습니다.
                </p>
              )}
            </div>

            {user && (
              <div className={SECTION_CARD_CLASS}>
                <div className="mb-3 flex items-center gap-2">
                  <Tags className="h-4 w-4 text-[#2f7d73]" />
                  <span className={SECTION_LABEL_CLASS}>태그</span>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <select
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="h-11 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#5ba79a] focus:ring-2 focus:ring-[#d7ebe5] md:w-56"
                  >
                    {labelsQuery.isPending && <option value="미지정">태그 불러오는 중</option>}
                    {!labelsQuery.isPending &&
                      labels.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                  </select>

                  {adding ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        autoFocus
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddLabel();
                          if (e.key === "Escape") {
                            setAdding(false);
                            setNewLabel("");
                          }
                        }}
                        placeholder="새 태그"
                        className="h-11 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none transition focus:border-[#5ba79a] focus:ring-2 focus:ring-[#d7ebe5]"
                      />
                      <button
                        type="button"
                        onClick={handleAddLabel}
                        disabled={addLabelMutation.isPending}
                        className="inline-flex h-11 items-center gap-2 rounded-md border border-[#b7dcd3] bg-[#e7f3ef] px-3 text-sm font-semibold text-[#286d65] transition hover:bg-[#d7ebe5] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                        추가
                      </button>
                    </div>
                  ) : labels.length < 20 ? (
                    <button
                      type="button"
                      onClick={() => setAdding(true)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      <Plus className="h-4 w-4" />
                      태그 추가
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">태그 최대 20개</span>
                  )}
                </div>
                {labelError && (
                  <p className="mt-2 text-xs text-rose-500">{labelError}</p>
                )}
              </div>
            )}

          </div>
        </section>
    </div>
  );
}
