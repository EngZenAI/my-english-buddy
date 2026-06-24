import { useEffect, useState } from "react";
import { api } from "../api";

const COLS = 8;

export default function WordbookTab() {
  const [words, setWords] = useState([]);
  const [labels, setLabels] = useState([]);
  const [filter, setFilter] = useState(""); // "" = 전체
  const [loading, setLoading] = useState(false);

  const load = async (label = filter) => {
    setLoading(true);
    try {
      const { words } = await api.listWords(label);
      setWords(words);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.listLabels().then(({ labels }) => setLabels(labels)).catch(() => {});
    load("");
  }, []);

  const selectFilter = (label) => {
    setFilter(label);
    load(label);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">
          저장된 단어 목록{" "}
          <span className="text-slate-400 font-normal">({words.length}개)</span>
        </h3>
        <button
          onClick={() => load()}
          className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                     px-3 py-1.5 text-sm font-medium"
        >
          🔄 새로고침
        </button>
      </div>

      {/* 라벨 필터 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => selectFilter("")}
          className={`rounded-full text-[13px] font-medium px-3 h-8 border transition-colors
            ${filter === ""
              ? "bg-brand-600 text-white border-brand-600"
              : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}
        >
          전체
        </button>
        {labels.map((name) => (
          <button
            key={name}
            onClick={() => selectFilter(name)}
            className={`rounded-full text-[13px] font-medium px-3 h-8 border transition-colors
              ${filter === name
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-left">
              <th className="px-3 py-2 font-semibold">단어</th>
              <th className="px-3 py-2 font-semibold">한국어</th>
              <th className="px-3 py-2 font-semibold">한국어 상세</th>
              <th className="px-3 py-2 font-semibold">영어뜻</th>
              <th className="px-3 py-2 font-semibold">예문</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">라벨</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">등록일</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">다음복습일</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLS} className="px-3 py-6 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!loading && words.length === 0 && (
              <tr>
                <td colSpan={COLS} className="px-3 py-6 text-center text-slate-400">
                  {filter
                    ? `'${filter}' 라벨의 단어가 없어요.`
                    : "저장된 단어가 없어요. 단어 검색 탭에서 저장해보세요!"}
                </td>
              </tr>
            )}
            {words.map((w, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 font-medium">{w.word}</td>
                <td className="px-3 py-2">{w.korean}</td>
                <td className="px-3 py-2 whitespace-pre-wrap text-slate-600">
                  {w.korean_detail || "—"}
                </td>
                <td className="px-3 py-2 whitespace-pre-wrap">{w.english_def}</td>
                <td className="px-3 py-2 whitespace-pre-wrap">{w.example}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {w.tag ? (
                    <span className="inline-flex items-center rounded-full bg-brand-50
                                     text-brand-600 text-xs font-medium px-2 py-0.5">
                      {w.tag}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                  {String(w.created_at).slice(0, 10)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                  {String(w.next_review).slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
