import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import MemberNotice from "../components/MemberNotice";
import SearchInput from "@/components/search/SearchInput";
import WordDetailCard from "@/components/search/WordDetailCard";
import { Card } from "@/components/ui/card";

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
  const [appliedKey, setAppliedKey] = useState(""); // 현재 입력에 반영된 검색 결과 key
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
    setSettledWord(searchRequest.type === "en" ? searchRequest.word : eng.trim());
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

  return (
    <div className="flex flex-col gap-6 md:grid md:grid-cols-12 md:gap-6 h-full items-start">
      {/* 좌측 Column (검색 입력) */}
      <div className="w-full md:col-span-5 space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight dark:text-slate-100">단어 검색</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            영어 또는 한국어로 모르는 표현을 찾아보세요!
          </p>
        </div>

        <SearchInput
          eng={eng}
          setEng={setEng}
          kor={kor}
          setKor={setKor}
          onSearchEng={runEnglish}
          onSearchKor={runKorean}
          phonetic={phonetic}
          searchQuery={searchQuery}
          slangVisible={slangVisible}
          slangPending={slangMutation.isPending}
          onSlang={handleSlang}
          sourceRef={source}
        />

        {gate && !user && (
          <div className="animate-fadeIn">
            <MemberNotice feature={gate} onRequireLogin={onRequireLogin} />
          </div>
        )}
      </div>

      {/* 우측 Column (상세 카드) */}
      <div className="w-full md:col-span-7 h-full flex flex-col">
        {hasSearch ? (
          <WordDetailCard
            engDef={engDef}
            korDetail={korDetail}
            customExample={customExample}
            setCustomExample={setCustomExample}
            searchLoading={searchLoading}
            saved={saved}
            saveDisabled={saveDisabled}
            onSave={handleSave}
            user={user}
            labels={labels}
            labelsLoading={labelsQuery.isPending}
            selectedLabel={label}
            setSelectedLabel={setLabel}
            newLabel={newLabel}
            setNewLabel={setNewLabel}
            adding={adding}
            setAdding={setAdding}
            onAddLabel={handleAddLabel}
            labelError={labelError}
            slangText={slangText}
            setSlangText={setSlangText}
          />
        ) : (
          <Card className="h-full border-dashed border-slate-200 bg-slate-50/20 rounded-2xl flex flex-col items-center justify-center p-8 text-center min-h-[250px] md:min-h-[400px] flex-1">
            <div className="max-w-xs space-y-3">
              <div className="mx-auto w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center">
                <span className="text-xl">🔍</span>
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-slate-700 text-sm dark:text-slate-300">검색 결과가 비어있습니다</h3>
                <p className="text-xs text-slate-400 leading-normal">
                  영단어나 한국어 뜻을 입력하여 검색하면 자세한 정의와 예문이 이곳에 표시됩니다.
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

