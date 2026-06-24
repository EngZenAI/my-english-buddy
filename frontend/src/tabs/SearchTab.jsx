import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import AudioButton from "../components/AudioButton";

const LabelChip = ({ children }) => (
  <span className="inline-flex items-center justify-center bg-brand-50 text-brand-600
                   text-[13px] font-semibold px-3 py-[5px] rounded-full whitespace-nowrap">
    {children}
  </span>
);

const SaveButton = ({ saved, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full text-[13px] font-medium px-3.5 h-8 border-[1.5px] transition-colors
      ${saved
        ? "text-slate-500 border-slate-200 bg-slate-50"
        : "text-brand-600 border-brand-200 bg-white hover:bg-brand-50"}`}
  >
    {saved ? "✅ 저장됨" : "📥 단어장에 저장"}
  </button>
);

const ReadOnlyField = ({ label, value, rows = 3 }) => (
  <div className="mb-3">
    <label className="block text-sm text-slate-500 mb-1">{label}</label>
    <textarea
      readOnly
      rows={rows}
      value={value || ""}
      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm
                 text-slate-800 resize-none whitespace-pre-wrap"
    />
  </div>
);

const DEBOUNCE_MS = 150;

export default function SearchTab() {
  const [eng, setEng] = useState("");
  const [kor, setKor] = useState("");
  const [engDef, setEngDef] = useState("");
  const [korDetail, setKorDetail] = useState("");
  const [example, setExample] = useState("");          // 사전 제공 예문 (읽기 전용)
  const [customExample, setCustomExample] = useState(""); // 내 맞춤 예문 (편집/저장 대상)
  const [phonetic, setPhonetic] = useState("");
  const [saved, setSaved] = useState(false);

  // 태그(카테고리)
  const [labels, setLabels] = useState([]);
  const [label, setLabel] = useState("미지정"); // 현재 선택된 태그 (기본: 미지정)
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [labelError, setLabelError] = useState("");

  const [slangVisible, setSlangVisible] = useState(false);
  const [slangText, setSlangText] = useState("");
  const [slangLoading, setSlangLoading] = useState(false);

  const lastSearched = useRef({ en: "", ko: "" });
  const source = useRef(null);
  const reqSeq = useRef(0);
  const cache = useRef({});

  // 태그 목록 로드
  useEffect(() => {
    api.listLabels().then(({ labels }) => setLabels(labels)).catch(() => {});
  }, []);

  // 결과 영역(뜻/예문/발음)만 갱신. 맞춤 예문은 사전 예문으로 초기화.
  const applyCommon = (r) => {
    setEngDef(r.english_def);
    setKorDetail(r.korean_detail);
    setExample(r.example);
    setCustomExample(r.example); // 맞춤 예문 시작값 = 사전 예문 (이후 사용자가 편집)
    setPhonetic(r.phonetic || "");
    setSlangVisible(!!r.english_word);
    setSlangText("");
  };

  const refreshSaved = async (englishWord, myseq) => {
    if (!englishWord) {
      if (myseq === reqSeq.current) setSaved(false);
      return;
    }
    try {
      const { saved } = await api.wordSaved(englishWord);
      if (myseq !== reqSeq.current) return;
      setSaved(saved);
    } catch {
      /* 무시 */
    }
  };

  const runEnglish = async (word) => {
    const w = word.trim();
    if (!w) return;
    lastSearched.current.en = w;
    const myseq = ++reqSeq.current;

    const hit = cache.current["en:" + w];
    if (hit) {
      applyCommon(hit);
      lastSearched.current.ko = hit.korean_word;
      setKor(hit.korean_word);
      setSaved(false);
      refreshSaved(w, myseq);
      return;
    }
    try {
      const r = await api.searchEnglish(w);
      cache.current["en:" + w] = r;
      if (myseq !== reqSeq.current) return;
      applyCommon(r);
      lastSearched.current.ko = r.korean_word;
      setKor(r.korean_word);
      setSaved(false);
      refreshSaved(w, myseq);
    } catch {
      /* 무시 */
    }
  };

  const runKorean = async (word) => {
    const w = word.trim();
    if (!w) return;
    lastSearched.current.ko = w;
    const myseq = ++reqSeq.current;

    const hit = cache.current["ko:" + w];
    if (hit) {
      applyCommon(hit);
      lastSearched.current.en = hit.english_word;
      setEng(hit.english_word);
      setSaved(false);
      refreshSaved(hit.english_word, myseq);
      return;
    }
    try {
      const r = await api.searchKorean(w);
      cache.current["ko:" + w] = r;
      if (myseq !== reqSeq.current) return;
      applyCommon(r);
      lastSearched.current.en = r.english_word;
      setEng(r.english_word);
      setSaved(false);
      refreshSaved(r.english_word, myseq);
    } catch {
      /* 무시 */
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

  const handleSave = async () => {
    if (!eng.trim()) return;
    const res = await api.saveWord({
      word: eng,
      korean: kor,
      korean_detail: korDetail,
      english_def: engDef,
      example: customExample, // 내 맞춤 예문을 저장
      tag: label,              // 선택한 태그
      slang_def: slangText,
    });
    if (res.saved) setSaved(true);
  };

  const handleAddLabel = async () => {
    const name = newLabel.trim();
    if (!name) return;
    if (labels.length >= 20 && !labels.includes(name)) {
      setLabelError("태그는 최대 20개까지 추가할 수 있어요.");
      return;
    }
    try {
      const { labels: next, ok } = await api.addLabel(name);
      setLabels(next);
      if (ok) {
        setLabel(name); // 추가한 태그 바로 선택
        setNewLabel("");
        setAdding(false);
        setLabelError("");
      } else {
        setLabelError("태그는 최대 20개까지 추가할 수 있어요.");
      }
    } catch {
      /* 무시 */
    }
  };

  const handleSlang = async () => {
    if (!eng.trim()) {
      setSlangText("단어를 먼저 검색해주세요.");
      return;
    }
    setSlangLoading(true);
    setSlangText("AI가 의미를 분석 중입니다...");
    try {
      const { explanation } = await api.slang(eng, kor);
      setSlangText(explanation);
    } finally {
      setSlangLoading(false);
    }
  };

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
          <SaveButton saved={saved} onClick={handleSave} />
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
          <SaveButton saved={saved} onClick={handleSave} />
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
          <AudioButton word={kor} lang="ko" />
        </div>

        {slangVisible && (
          <button
            onClick={handleSlang}
            disabled={slangLoading}
            className="text-[11px] text-gray-400 underline hover:text-gray-600 mt-1"
          >
            원하는 뜻이 아닌가요? AI에게 물어보기
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

      <hr className="my-4 border-slate-200" />

      <ReadOnlyField label="📖 영어 뜻" value={engDef} rows={4} />
      <ReadOnlyField label="🇰🇷 한국어 뜻" value={korDetail} rows={3} />
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

      {/* 태그(카테고리) 선택 */}
      <div className="mb-3">
        <label className="block text-sm text-slate-500 mb-1">
          🏷️ 태그 (카테고리) — 단어장에서 태그별로 모아볼 수 있어요
        </label>
        <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}
