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

export default function SearchTab() {
  const [eng, setEng] = useState("");
  const [kor, setKor] = useState("");
  const [engDef, setEngDef] = useState("");
  const [korDetail, setKorDetail] = useState("");
  const [example, setExample] = useState("");
  const [phonetic, setPhonetic] = useState("");
  const [context, setContext] = useState("");
  const [saved, setSaved] = useState(false);

  const [slangVisible, setSlangVisible] = useState(false);
  const [slangText, setSlangText] = useState("");
  const [slangLoading, setSlangLoading] = useState(false);

  // 검색을 트리거한 입력 방향을 추적해 디바운스 무한 루프 방지
  const lastSearched = useRef({ en: "", ko: "" });
  const source = useRef(null); // "en" | "ko" — 마지막으로 사용자가 타이핑한 쪽

  const applyResult = (r) => {
    setEng(r.english_word);
    setKor(r.korean_word);
    setEngDef(r.english_def);
    setKorDetail(r.korean_detail);
    setExample(r.example);
    setPhonetic(r.phonetic || "");
    setSaved(!!r.saved);
    setSlangVisible(!!r.english_word);
    setSlangText("");
    lastSearched.current = { en: r.english_word, ko: r.korean_word };
  };

  const runEnglish = async (word) => {
    if (!word.trim()) return;
    try {
      applyResult(await api.searchEnglish(word));
    } catch {
      /* 무시 */
    }
  };

  const runKorean = async (word) => {
    if (!word.trim()) return;
    try {
      applyResult(await api.searchKorean(word));
    } catch {
      /* 무시 */
    }
  };

  // ── 디바운스: 영어 입력 ──
  useEffect(() => {
    if (source.current !== "en") return;
    if (!eng.trim() || eng === lastSearched.current.en) return;
    const t = setTimeout(() => runEnglish(eng), 400);
    return () => clearTimeout(t);
  }, [eng]);

  // ── 디바운스: 한국어 입력 ──
  useEffect(() => {
    if (source.current !== "ko") return;
    if (!kor.trim() || kor === lastSearched.current.ko) return;
    const t = setTimeout(() => runKorean(kor), 400);
    return () => clearTimeout(t);
  }, [kor]);

  const handleSave = async () => {
    if (!eng.trim()) return;
    const res = await api.saveWord({
      word: eng,
      korean: kor,
      english_def: engDef,
      example,
      context,
      slang_def: slangText,
    });
    if (res.saved) setSaved(true);
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

        {/* 슬랭 힌트 */}
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
      <ReadOnlyField label="✏️ 예문" value={example} rows={3} />

      <div className="mb-3">
        <label className="block text-sm text-slate-500 mb-1">
          📍 어디서 봤어요? (선택사항)
        </label>
        <input
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="예: 넷플릭스 보다가 / 영어 뉴스에서 / 친구 문자에서..."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>
    </div>
  );
}
