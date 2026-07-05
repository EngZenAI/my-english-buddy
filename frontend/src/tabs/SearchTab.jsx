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

const SaveButton = ({ saved, onClick, disabled, full = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center justify-center gap-1.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60
      ${
        full
          ? `h-12 w-full rounded-xl text-sm shadow-sm active:scale-[0.99] ${
              saved
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "bg-brand-600 text-white hover:bg-brand-700"
            }`
          : `h-9 min-w-[104px] rounded-full border px-3.5 text-sm ${
              saved
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
            }`
      }`}
  >
    {saved ? (
      <>
        <CheckCircle2 className="h-4 w-4 animate-save-pop" />
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
    ) : value ? (
      <div
        className={`w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-800 ${
          rows >= 4 ? "min-h-[7rem] max-h-64" : "min-h-[5.5rem] max-h-48"
        }`}
      >
        {value}
      </div>
    ) : (
      <div
        className={`flex items-center rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-400 ${
          rows >= 4 ? "min-h-[7rem]" : "min-h-[5.5rem]"
        }`}
      >
        검색하면 여기에 표시돼요
      </div>
    )}
  </div>
);

const SearchInputRow = ({
  label,
  badge,
  value,
  onChange,
  onSearch,
  placeholder,
  audio,
  emphasize = false,
}) => {
  const textareaRef = useRef(null);
  // 내용에 맞춰 높이를 자동으로 늘림(최대 ~5줄), 넘치면 그 안에서 스크롤
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);
  // 문장이 길어지면 큰 볼드체가 무거워 보이므로 폰트를 한 단계 낮춤
  const long = (value || "").length > 22;
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md focus-within:border-brand-400 focus-within:shadow-md focus-within:ring-4 focus-within:ring-brand-100/50">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          {badge && (
            <span className="inline-flex h-5 items-center rounded-full bg-brand-50 px-2 text-[10px] font-bold tracking-wider text-brand-600">
              {badge}
            </span>
          )}
          {label}
        </span>
        {audio}
      </div>
      <div className="flex items-end gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-1 transition focus-within:border-brand-400 focus-within:bg-white">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={(e) => {
            // Enter=검색, Shift+Enter=줄바꿈
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSearch();
            }
          }}
          placeholder={placeholder}
          rows={1}
          className={`max-h-[120px] min-h-[2.5rem] min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 leading-6 text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 ${
            emphasize
              ? long
                ? "text-base font-semibold"
                : "text-lg font-bold tracking-tight"
              : "text-base font-medium"
          }`}
        />
        <button
          type="button"
          onClick={onSearch}
          aria-label={`${label} 검색`}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm transition hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

function RecentSearchChips({ items, onSelect, onRemove }) {
  if (items.length === 0) return null;

  return (
    <div className="flex items-start gap-2 pt-2">
      <span className="shrink-0 pt-1.5 text-xs font-semibold text-slate-500">최근 검색</span>
      <div className="flex max-h-[5.5rem] min-w-0 flex-1 flex-wrap items-start gap-2 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
      {items.map((item) => {
        const title = item.word || item.query;
        const subtitle = item.korean || "";
        return (
          <span
            key={getRecentKey(item)}
            className="group inline-flex max-w-[220px] items-center overflow-hidden rounded-full border border-slate-200 bg-white text-xs shadow-sm transition hover:border-brand-200 hover:bg-brand-50"
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

  // 이미 기록된(엔터로 추가된) 항목의 번역/단어만 보강. 없으면 아무것도 추가하지 않음
  // → 실시간 검색이 새 항목을 만들지 않고, 엔터로 남긴 항목만 예쁘게 채워짐.
  const enrichRecent = (type, query, patch) => {
    const key = `${type}:${(query || "").trim().toLowerCase()}`;
    setRecentSearches((prev) => {
      if (!prev.some((item) => getRecentKey(item) === key)) return prev;
      const next = prev.map((item) =>
        getRecentKey(item) === key ? { ...item, ...patch } : item
      );
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
      setSlangVisible(true);
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
    setSlangVisible(false);
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
      return;
    }
    applyCommon(r);
    if (searchRequest.type === "en") {
      lastSearched.current.ko = r.korean_word;
      setKor(r.korean_word);
      setSettledWord(searchRequest.word);
      // 엔터로 이미 남긴 항목이면 번역만 채워줌(없으면 추가 안 함)
      enrichRecent("en", searchRequest.word, { korean: r.korean_word });
    } else {
      lastSearched.current.en = r.english_word;
      setEng(r.english_word);
      setSettledWord(r.english_word);
      enrichRecent("ko", searchRequest.word, {
        word: r.english_word || searchRequest.word,
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

  // 엔터/검색 버튼을 누르면 결과를 기다리지 않고 즉시 최근 검색에 기록한 뒤 검색 실행
  const commitSearch = (type) => {
    const q = (type === "en" ? eng : kor).trim();
    if (!q) return;
    rememberSearch({
      type,
      query: q,
      word: q,
      korean: type === "ko" ? q : kor.trim(),
    });
    if (type === "en") runEnglish(eng);
    else runKorean(kor);
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
      setSlangVisible(true);
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
      <RecentSearchChips
        items={recentSearches}
        onSelect={selectRecentSearch}
        onRemove={removeRecentSearch}
      />

      {gate && !user && (
        <MemberNotice feature={gate} onRequireLogin={onRequireLogin} />
      )}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex min-h-[3.5rem] flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <p className="min-w-0 text-sm font-medium text-slate-500">
              영어 단어, 한국어 뜻, 예문을 함께 정리하여 단어장에 추가해 보세요.
            </p>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {isSearching ? (
                <LoadingSpinner label="검색 중" />
              ) : searchQuery.isError ? (
                <span className="text-sm font-medium text-rose-500">검색 실패</span>
              ) : null}
              {hasSearch && (
                <SaveButton
                  saved={saved}
                  onClick={handleSave}
                  disabled={saveDisabled}
                />
              )}
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2">
            <SearchInputRow
              label="영어 단어"
              badge="EN"
              value={eng}
              emphasize
              onChange={(e) => {
                source.current = "en";
                setEng(e.target.value);
              }}
              onSearch={() => commitSearch("en")}
              placeholder="예: cardiovascular"
              audio={<AudioButton word={eng} lang="en" phonetic={phonetic} />}
            />
            <SearchInputRow
              label="한국어 뜻"
              badge="KO"
              value={kor}
              onChange={(e) => {
                source.current = "ko";
                setKor(e.target.value);
              }}
              onSearch={() => commitSearch("ko")}
              placeholder="예: 심혈관"
              audio={<AudioButton word={kor} lang="ko" />}
            />
          </div>

          {eng.trim() && kor.trim() ? (
            <div className="px-5 pb-5">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      원하는 뜻이 아닌가요?
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      문맥에 맞는 의미를 AI에게 물어보고 저장 내용에 반영할 수 있습니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSlang}
                    disabled={slangMutation.isPending || !eng.trim()}
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-brand-200 bg-white px-3 text-xs font-semibold text-brand-700 shadow-sm transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {slangMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    AI에게 물어보기
                  </button>
                </div>
                {(slangVisible || slangText) && (
                  <textarea
                    rows={slangText ? 7 : 4}
                    value={slangText}
                    onChange={(e) => setSlangText(e.target.value)}
                    placeholder="AI가 분석한 의미를 확인한 뒤 필요하면 고쳐서 저장할 수 있어요"
                    className="mt-3 w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="px-5 pb-5">
              <div className="border-t border-slate-200" />
            </div>
          )}

          <div className="space-y-4 p-5 pt-0">
            <div className={`grid gap-4 ${user ? "md:grid-cols-2" : ""}`}>
              {/* 예문 편집 */}
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
                  rows={2}
                  value={customExample}
                  onChange={(e) => setCustomExample(e.target.value)}
                  placeholder="내 상황에 맞는 예문을 직접 적어보세요"
                  className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
                {example && customExample !== example && (
                  <button
                    type="button"
                    onClick={() => setCustomExample(example)}
                    className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900"
                  >
                    사전 예문으로 되돌리기
                  </button>
                )}
              </div>

              {/* 태그 (예문 편집 오른쪽) */}
              {user && (
                <div className={SECTION_CARD_CLASS}>
                  <div className="mb-3 flex items-center gap-2">
                    <Tags className="h-4 w-4 text-brand-600" />
                    <span className={SECTION_LABEL_CLASS}>태그</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {labelsQuery.isPending ? (
                      <span className="text-xs text-slate-400">태그 불러오는 중…</span>
                    ) : (
                      labels.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setLabel(name)}
                          className={`h-8 rounded-full border px-3 text-[13px] font-medium transition-colors ${
                            label === name
                              ? "border-brand-600 bg-brand-600 text-white"
                              : "border-slate-300 bg-white text-slate-600 hover:bg-brand-50"
                          }`}
                        >
                          {name}
                        </button>
                      ))
                    )}

                    {adding ? (
                      <span className="inline-flex items-center gap-1">
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
                          className="h-8 w-24 rounded-full border border-slate-300 px-3 text-[13px] outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                        />
                        <button
                          type="button"
                          onClick={handleAddLabel}
                          disabled={addLabelMutation.isPending}
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-3 text-[13px] font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          추가
                        </button>
                      </span>
                    ) : labels.length < 20 ? (
                      <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 text-[13px] font-medium text-slate-500 transition hover:bg-slate-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
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
          </div>
        </section>
    </div>
  );
}
