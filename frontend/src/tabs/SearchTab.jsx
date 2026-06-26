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

const SaveButton = ({ saved, onClick, disabled }) => (
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
    {saved ? "✅ 저장됨" : "📥 단어장에 저장"}
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

const DEBOUNCE_MS = 250;

export default function SearchTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const [eng, setEng] = useState("");
  const [kor, setKor] = useState("");
  const [engDef, setEngDef] = useState("");
  const [korDetail, setKorDetail] = useState("");
  const [example, setExample] = useState("");
  const [customExample, setCustomExample] = useState(""); // 내 맞춤 예문 (편집/저장 대상)
  const [phonetic, setPhonetic] = useState("");
  const [gate, setGate] = useState(""); // 비회원 기능 안내 (표시할 기능명, "" = 숨김)

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
  const [appliedKey, setAppliedKey] = useState(""); // 현재 입력에 반영된 검색 결과 key (검색 완료 판정용)
  // 가장 최근에 '완료된' 검색이 실제로 가리키는 영어 단어. 저장 대상(eng)과 일치할 때만 저장 허용.
  // (디바운스 중엔 searchRequest가 이전 단어를 가리켜 '완료'처럼 보이는 레이스를 막는다.)
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

  // 검색이 '현재 입력'에 대해 끝났는지 (로딩 중이거나 이전 결과면 false)
  const currentKey = searchRequest
    ? `${searchRequest.type}:${searchRequest.word}`
    : "";
  const searchSettled =
    !!searchRequest && !searchQuery.isFetching && appliedKey === currentKey;

  // 저장 여부는 '실제로 저장할 단어(eng)' 기준으로, 검색이 끝난 뒤에만 조회한다.
  const savedWord = eng.trim();
  const userId = user?.id || "";
  const savedQuery = useQuery({
    queryKey: queryKeys.wordSaved(userId, savedWord),
    queryFn: ({ signal }) => api.wordSaved(savedWord, signal),
    enabled: !!userId && !!savedWord && searchSettled,
    staleTime: 0, // 활성 단어가 바뀌면 항상 DB 저장여부를 재확인 (옛 false 캐시로 덮어쓰기 방지)
  });

  // 저장 여부는 savedQuery에서 '직접 파생'한다. (effect로 state에 복사하면 react-query의
  // structural sharing 때문에 같은 단어 재검색 시 참조가 안 바뀌어 갱신이 안 되는 버그가 있음.)
  const saved = savedQuery.data?.saved === true;

  const saveWordMutation = useMutation({
    mutationFn: (payload) => api.saveWord(payload),
    onSuccess: (res, payload) => {
      if (!res.saved) return;
      // 캐시를 true로 갱신 → saved가 파생적으로 true가 됨
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
      // 로딩 표시는 버튼에서만. 텍스트창엔 넣지 않음(편집/저장값 오염 방지) → 분석 중엔 창 숨김
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
      // 결과가 없어도(사전에 없는 단어) 사용자가 직접 적은 값으로 저장은 허용 → 저장 대상 단어를 확정.
      setSettledWord(searchRequest.type === "en" ? searchRequest.word : eng.trim());
      return;
    }
    applyCommon(r);
    if (searchRequest.type === "en") {
      lastSearched.current.ko = r.korean_word;
      setKor(r.korean_word);
      setSettledWord(searchRequest.word);
    } else {
      lastSearched.current.en = r.english_word;
      setEng(r.english_word);
      setSettledWord(r.english_word);
    }
  }, [searchQuery.data, searchRequest]);

  useEffect(() => {
    if (!searchQuery.isError || !searchRequest) return;
    resetResultState();
    const key = `${searchRequest.type}:${searchRequest.word}`;
    appliedSearchKey.current = key;
    setAppliedKey(key);
    // 검색 실패 시에도 사용자가 입력한 단어로 저장은 허용 (영어 입력 기준).
    setSettledWord(searchRequest.type === "en" ? searchRequest.word : eng.trim());
  }, [searchQuery.isError, searchRequest]);

  const runEnglish = (word) => {
    const w = word.trim();
    if (!w) return;
    lastSearched.current.en = w;
    reqSeq.current += 1;
    appliedSearchKey.current = "";
    setAppliedKey("");
    setSettledWord(""); // 새 검색 시작 → 완료 전까지 저장 잠금
    resetResultState();
    setSearchRequest({ type: "en", word: w });
  };

  const runKorean = (word) => {
    const w = word.trim();
    if (!w) return;
    lastSearched.current.ko = w;
    reqSeq.current += 1;
    appliedSearchKey.current = "";
    setAppliedKey("");
    setSettledWord(""); // 새 검색 시작 → 완료 전까지 저장 잠금
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

  // 저장 버튼은 (1)검색 완료 (2)회원이면 저장여부 확인 완료 (3)미저장 (4)eng 존재 일 때만 활성화.
  // 검색/확인이 끝나기 전 빠른 클릭으로 기존 단어를 덮어쓰는 레이스를 막는다.
  const savedCheckReady = !user || (savedQuery.isSuccess && !savedQuery.isFetching);
  // 완료된 검색이 '지금 저장하려는 단어(eng)'와 정확히 같을 때만 저장 허용.
  // 타이핑으로 단어가 바뀐 직후(디바운스 중)엔 이전 검색이 '완료'처럼 보여도 여기서 막힌다.
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
    if (!canSave) return; // 모든 체크가 끝나기 전엔 저장 금지 (덮어쓰기 레이스 방지)
    if (!user) {
      setGate("단어장 저장"); // 비회원 → 회원 기능 안내
      return;
    }
    saveWordMutation.mutate({
      word: eng.trim(),
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
    if (!user) {
      setGate("AI 슬랭 설명"); // 비회원 → 회원 기능 안내
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
  // 검색·저장여부 확인이 모두 끝나야 활성화 (canSave). 그 전엔 항상 비활성화.
  const saveDisabled = !canSave;

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
            disabled={saveDisabled}
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
            rows={10}
            value={slangText}
            onChange={(e) => setSlangText(e.target.value)}
            placeholder="AI 설명을 내 표현에 맞게 고쳐서 저장할 수 있어요"
            className="w-full mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2
                       text-sm text-slate-800 resize-none whitespace-pre-wrap
                       focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        )}
      </div>

      {gate && !user && (
        <div className="mt-3">
          <MemberNotice feature={gate} onRequireLogin={onRequireLogin} />
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
