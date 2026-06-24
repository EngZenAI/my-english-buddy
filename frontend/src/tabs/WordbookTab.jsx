import { useEffect, useState } from "react";
import { api } from "../api";

export default function WordbookTab() {
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { words } = await api.listWords();
      setWords(words);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">저장된 단어 목록</h3>
        <button
          onClick={load}
          className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                     px-3 py-1.5 text-sm font-medium"
        >
          🔄 새로고침
        </button>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-left">
              <th className="px-3 py-2 font-semibold">단어</th>
              <th className="px-3 py-2 font-semibold">한국어</th>
              <th className="px-3 py-2 font-semibold">영어뜻</th>
              <th className="px-3 py-2 font-semibold">예문</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">다음복습일</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!loading && words.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  저장된 단어가 없어요. 단어 검색 탭에서 저장해보세요!
                </td>
              </tr>
            )}
            {words.map((w, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 font-medium">{w.word}</td>
                <td className="px-3 py-2">{w.korean}</td>
                <td className="px-3 py-2 whitespace-pre-wrap">{w.english_def}</td>
                <td className="px-3 py-2 whitespace-pre-wrap">{w.example}</td>
                <td className="px-3 py-2 whitespace-nowrap">
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
