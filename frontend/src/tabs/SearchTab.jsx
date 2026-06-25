import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import AudioButton from "../components/AudioButton";
import { LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

const LabelChip = ({ children }) => (
  <span className="inline-flex items-center justify-center bg-brand-50 text-brand-600
                   text-[13px] font-semibold px-3 py-[5px] rounded-full whitespace-nowrap">
    {children}
  </span>
);

const SaveButton = ({ saved, onClick, disabled, loading }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`rounded-full text-[13px] font-medium px-3.5 h-8 border-[1.5px] transition-colors
      ${saved
        ? "text-slate-500 border-slate-200 bg-slate-50"
        : "text-brand-600 border-brand-200 bg-white hover:bg-brand-50"}
      disabled:opacity-60 disabled:cursor-not-allowed`}
  >
    {loading ? "저장 중…" : saved ? "✅ 저장됨" : "📥 단어장에 저장"}
  </button>
);

const ReadOnlyField = ({ label, value, rows = 3, loading }) => (
  <div className="mb-3">
    <label className="block text-sm text-slate-500 mb-1">{label}</label>
    {loading ? (
      <SkeletonBlock className={rows >= 4 ? "h-28" : "h-24"} />
    ) : (
    <textarea
      readOnly
      rows={rows}
      value={value || ""}
      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm
                 text-slate-800 resize-none whitespace-pre-wrap"
    />
    )}
  </div>
);

const DEBOUNCE_MS = 150;

export default function SearchTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const [eng, setEng] = useState("");
  const [kor, setKor] = useState("");
  const [engDef, setEngDef] = useState("");
  const [korDetail, setKorDetail] = useState("");
  const [example, setExample] = useState("");
  const [customExample, setCustomExample] = useState(""); // 내 맞춤 예문 (편집/저장 대상)
  const [phonetic, setPhonetic] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveGate, setSaveGate] = useState(false); // 비회원 저장 시도 안내

  // 태그(카테고리)
  const [label, setLabel] = useState("미지정"); // 현재 선택된 태그 (기본: 미지정)
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
    queryFn: () =>
      searchRequest.type === "en"
        ? api.searchEnglish(searchRequest.word)
        : api.searchKorean(searchRequest.word),
    enabled: !!searchRequest?.word,
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });

  const savedWord = (searchQuery.data?.english_word || "").trim();
  const userId = user?.id || "";
  const savedQuery = useQuery({
    queryKey: queryKeys.wordSaved(userId, savedWord),
    queryFn: () => api.wordSaved(savedWord),
    enabled: !!userId && !!savedWord,
    staleTime: 30_000,
  });

  const saveWordMutation = useMutation({
    mutationFn: (payload) => api.saveWord(payload),
    onSuccess: (res, payload) => {
      if (!res.saved) return;
      setSaved(true);
      queryClient.setQueryData(queryKeys.wordSaved(userId, payload.word), { saved: true });
      queryClient.invalidateQueries({ queryKey: ["words"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
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
      setSlangText("AI가 의미를 분석 중입니다...");
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
    setCustomExample(r.example); // 맞춤 예문 시작값 = 사전 예문
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
    setSaved(false);
    setSlangVisible(false);
    setSlangText("");
  };

  useEffect(() => {
    const r = searchQuery.data;
    if (!r || !searchRequest) return;
    const key = `${searchRequest.type}:${searchRequest.word}`;
    if (appliedSearchKey.current === key) return;
    appliedSearchKey.current = key;
    if (!r.english_word && !r.korean_word && !r.english_def && !r.korean_detail) {
      resetResultState();
      return;
    }
    applyCommon(r);
    if (searchRequest.type === "en") {
      lastSearched.current.ko = r.korean_word;
      setKor(r.korean_word);
    } else {
      lastSearched.current.en = r.english_word;
      setEng(r.english_word);
    }
    setSaved(false);
  }, [searchQuery.data, searchRequest]);

  useEffect(() => {
    if (!searchQuery.isError || !searchRequest) return;
    resetResultState();
  }, [searchQuery.isError, searchRequest]);

  useEffect(() => {
    if (!user) {
      setSaved(false);
      return;
    }
    if (savedQuery.data) setSaved(savedQuery.data.saved);
  }, [savedQuery.data, user]);

  const runEnglish = (word) => {
    const w = word.trim();
    if (!w) return;
    lastSearched.current.en = w;
    reqSeq.current += 1;
    appliedSearchKey.current = "";
    resetResultState();
    setSearchRequest({ type: "en", word: w });
  };

  const runKorean = (word) => {
    const w = word.trim();
    if (!w) return;
    lastSearched.current.ko = w;
    reqSeq.current += 1;
    appliedSearchKey.current = "";
    resetResultState();
    setSearchRequest({ type: "ko", word: w });
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

  const handleSave = async () => {
    if (!user) {
      setSaveGate(true); // 비회원 → 회원 기능 안내
      return;
    }
    if (!eng.trim()) return;
    saveWordMutation.mutate({
      word: eng,
      korean: kor,
      korean_detail: korDetail,
      english_def: engDef,
      example: customExample,
      tag: label,
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
    if (!engWord) {
      setSlangText("단어를 먼저 검색해주세요.");
      return;
    }
    slangMutation.mutate({ engWord, korWord });
  };

  const hasSearch = !!searchRequest;
  const searchLoading = searchQuery.isFetching && !searchQuery.data;
  const saveLoading = saveWordMutation.isPending || savedQuery.isFetching;

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">
        모르는 단어를 검색하고 단어장에 저장하세요!
      </h3>

      {/* 검색 카드 */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3">
        {/* 영어 헤더 */}
        <div className="flex items-center justify-between min-h-[40px]">
          <LabelChip>🇺🇸 영어</LabelChip>
          <SaveButton
            saved={saved}
            onClick={handleSave}
            disabled={saveWordMutation.isPending}
            loading={saveLoading && !!user}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            value={eng}
            onChange={(e) => {
              source.current = "en";
              setEng(e.target.value);
            }}
            onKeyDown={(e) => e.key === "Enter" && runEnglish(eng)}
            placeholder="예: cardiovascular"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            onClick={() => runEnglish(eng)}
            className="w-12 h-10 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
          >
            🔍
          </button>
        </div>
        <div className="h-[30px] flex items-center">
          <AudioButton word={eng} lang="en" phonetic={phonetic} />
        </div>

        {/* 한국어 헤더 */}
        <div className="flex items-center justify-between min-h-[40px] mt-2 pt-2 border-t border-slate-100">
          <LabelChip>🇰🇷 한국어</LabelChip>
          <SaveButton
            saved={saved}
            onClick={handleSave}
            disabled={saveWordMutation.isPending}
            loading={saveLoading && !!user}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            value={kor}
            onChange={(e) => {
              source.current = "ko";
              setKor(e.target.value);
            }}
            onKeyDown={(e) => e.key === "Enter" && runKorean(kor)}
            placeholder="예: 심혈관"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            onClick={() => runKorean(kor)}
            className="w-12 h-10 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
          >
            🔍
          </button>
        </div>
        <div className="h-[30px] flex items-center">
          {searchQuery.isFetching ? (
            <LoadingSpinner label="검색 결과를 가져오는 중" />
          ) : searchQuery.isError ? (
            <span className="text-sm text-rose-500">검색 결과를 불러오지 못했습니다.</span>
          ) : (
            <AudioButton word={kor} lang="ko" />
          )}
        </div>

        {slangVisible && (
          <button
            onClick={handleSlang}
            disabled={slangMutation.isPending}
            className="text-[11px] text-gray-400 underline hover:text-gray-600 mt-1"
          >
            {slangMutation.isPending
              ? "AI가 의미를 분석 중입니다..."
              : "원하는 뜻이 아닌가요? AI에게 물어보기"}
          </button>
        )}
        {slangText && (
          <textarea
            readOnly
            rows={10}
            value={slangText}
            className="w-full mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2
                       text-sm text-slate-800 resize-none whitespace-pre-wrap"
          />
        )}
      </div>

      {saveGate && !user && (
        <div className="mt-3">
          <MemberNotice feature="단어장 저장" onRequireLogin={onRequireLogin} />
        </div>
      )}

      <hr className="my-4 border-slate-200" />

      {!hasSearch && (
        <p className="mb-3 text-sm text-slate-400">
          영어 또는 한국어 단어를 입력하면 뜻과 예문이 여기에 표시됩니다.
        </p>
      )}
      <ReadOnlyField label="📖 영어 뜻" value={engDef} rows={4} loading={searchLoading} />
      <ReadOnlyField label="🇰🇷 한국어 뜻" value={korDetail} rows={3} loading={searchLoading} />

      {/* 편집 가능한 내 맞춤 예문 */}
      <div className="mb-3">
        <label className="block text-sm text-slate-500 mb-1">
          ✏️ 예문 — 사전 예문이 기본으로 들어가요. 클릭해서 내 상황에 맞게 고칠 수 있어요
        </label>
        <textarea
          rows={3}
          value={customExample}
          onChange={(e) => setCustomExample(e.target.value)}
          placeholder="내 상황에 맞는 예문을 직접 적어보세요"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
                     resize-none whitespace-pre-wrap
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      {/* 태그(카테고리) 선택 — 회원만 (저장 기능과 연결됨) */}
      {user && (
        <div className="mb-3">
          <label className="block text-sm text-slate-500 mb-1">
            🏷️ 태그 (카테고리) — 단어장에서 태그별로 모아볼 수 있어요
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {labelsQuery.isPending && (
              <>
                <SkeletonBlock className="h-8 w-16 rounded-full" />
                <SkeletonBlock className="h-8 w-20 rounded-full" />
              </>
            )}
            {labels.map((name) => {
              const active = label === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setLabel(active ? "" : name)}
                  className={`rounded-full text-[13px] font-medium px-3 h-8 border transition-colors
                    ${active
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}
                >
                  {name}
                </button>
              );
            })}

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
                  className="w-24 rounded-full border border-slate-300 px-3 h-8 text-[13px]
                             focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
                <button
                  type="button"
                  onClick={handleAddLabel}
                  className="rounded-full text-[13px] font-medium px-3 h-8 bg-brand-50
                             text-brand-600 border border-brand-200 hover:bg-brand-100"
                >
                  추가
                </button>
              </span>
            ) : labels.length < 20 ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="rounded-full text-[13px] font-medium px-3 h-8 border border-dashed
                           border-slate-300 text-slate-500 hover:bg-slate-50"
              >
                + 태그 추가
              </button>
            ) : (
              <span className="text-[11px] text-slate-400">태그 최대 20개</span>
            )}
          </div>
          {labelError && (
            <p className="text-[11px] text-rose-500 mt-1">{labelError}</p>
          )}
        </div>
      )}
    </div>
  );
}
