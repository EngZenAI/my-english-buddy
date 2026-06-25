import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

const COLS = 8;

const WordRowsSkeleton = () =>
  Array.from({ length: 5 }).map((_, row) => (
    <tr key={row} className="border-t border-slate-100">
      {Array.from({ length: COLS }).map((__, col) => (
        <td key={col} className="px-3 py-3">
          <SkeletonBlock className={col > 1 ? "h-10 min-w-24" : "h-4 w-20"} />
        </td>
      ))}
    </tr>
  ));

export default function WordbookTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(""); // "" = 전체

  // 태그 편집 모드
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({}); // 원래이름 -> 편집중 값

  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const labels = labelsQuery.data?.labels || [];

  const wordsQuery = useQuery({
    queryKey: queryKeys.words(filter),
    queryFn: () => api.listWords(filter),
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  const words = wordsQuery.data?.words || [];

  const renameLabelMutation = useMutation({
    mutationFn: ({ orig, val }) => api.renameLabel(orig, val),
  });

  const deleteLabelMutation = useMutation({
    mutationFn: api.deleteLabel,
    onSuccess: (res, name) => {
      if (!res.ok) {
        alert(res.message || "삭제에 실패했어요.");
        return;
      }
      queryClient.setQueryData(queryKeys.labels, { labels: res.labels });
      queryClient.invalidateQueries({ queryKey: ["words"] });
      setEditValues((prev) => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
      if (filter === name) setFilter("");
    },
  });

  const selectFilter = (label) => {
    setFilter(label);
  };

  // ── 태그 편집 ──
  const enterEdit = () => {
    const init = {};
    labels.forEach((n) => {
      if (n !== "미지정") init[n] = n;
    });
    setEditValues(init);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditValues({});
  };

  const commitEdits = async () => {
    for (const orig of Object.keys(editValues)) {
      const val = (editValues[orig] || "").trim();
      if (!val || val === orig) continue;
      const res = await renameLabelMutation.mutateAsync({ orig, val });
      if (!res.ok) {
        alert(res.message || "이름 변경에 실패했어요.");
        return; // 편집 모드 유지
      }
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    await queryClient.invalidateQueries({ queryKey: ["words"] });
    setEditMode(false);
    setEditValues({});
    setFilter("");
  };

  const deleteInEdit = async (name) => {
    let count = 0;
    try {
      count = (
        await queryClient.fetchQuery({
          queryKey: queryKeys.labelWordCount(name),
          queryFn: () => api.labelWordCount(name),
          staleTime: 15_000,
        })
      ).count;
    } catch {
      /* 무시 */
    }
    const ok = window.confirm(
      `'${name}' 태그를 삭제하면 이 태그의 단어 ${count}개도 함께 삭제됩니다.\n계속하시겠습니까?`
    );
    if (!ok) return;
    deleteLabelMutation.mutate(name);
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    queryClient.invalidateQueries({ queryKey: queryKeys.words(filter) });
  };

  const loading = wordsQuery.isPending || labelsQuery.isPending;
  const refetching = wordsQuery.isFetching && !wordsQuery.isPending;

  return (
    <div>
      {!user && <MemberNotice feature="단어장" onRequireLogin={onRequireLogin} />}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">
          저장된 단어 목록{" "}
          <span className="text-slate-400 font-normal">({words.length}개)</span>
          {refetching && <span className="ml-2"><LoadingSpinner label="갱신 중" /></span>}
        </h3>
        <button
          onClick={refresh}
          disabled={!user}
          className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                     px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          🔄 새로고침
        </button>
      </div>

      {/* 태그 줄: 보기 모드=필터 / 편집 모드=이름편집+삭제 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {!editMode && (
          <button
            onClick={() => selectFilter("")}
            className={`rounded-full text-[13px] font-medium px-3 h-8 border transition-colors
              ${filter === ""
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}
          >
            전체
          </button>
        )}

        {labels.map((name) => {
          if (!editMode) {
            return (
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
            );
          }
          if (name === "미지정") {
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100
                           text-slate-400 text-[13px] font-medium px-3 h-8"
                title="기본 태그 — 변경·삭제 불가"
              >
                미지정 🔒
              </span>
            );
          }
          const val = editValues[name] ?? name;
          return (
            <span
              key={name}
              className="inline-flex items-center rounded-full border border-brand-300
                         bg-white h-8 pl-3 pr-1.5 gap-0.5"
            >
              <input
                value={val}
                onChange={(e) =>
                  setEditValues((v) => ({ ...v, [name]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdits();
                }}
                style={{ width: `${Math.max((val || "").length, 2) + 1.2}em` }}
                className="text-[13px] bg-transparent outline-none"
              />
              <button
                onClick={() => deleteInEdit(name)}
                title="태그 삭제"
                className="w-4 h-4 rounded-full inline-flex items-center justify-center
                           text-slate-400 hover:bg-rose-50 hover:text-rose-600 text-[10px]"
              >
                ✕
              </button>
            </span>
          );
        })}

        {/* 편집/확인 버튼 (회원만) */}
        {user &&
          (!editMode ? (
            <button
              onClick={enterEdit}
              className="rounded-full text-[13px] font-medium px-3 h-8 border border-dashed
                         border-slate-300 text-slate-500 hover:bg-slate-50"
            >
              ✏️ 태그 편집
            </button>
          ) : (
            <>
              <button
                onClick={commitEdits}
                className="rounded-full text-[13px] font-semibold px-4 h-8 bg-brand-600
                           text-white hover:bg-brand-700"
              >
                확인
              </button>
              <button
                onClick={cancelEdit}
                className="rounded-full text-[13px] font-medium px-3 h-8 border
                           border-slate-300 text-slate-500 hover:bg-slate-50"
              >
                취소
              </button>
            </>
          ))}
      </div>

      {editMode && (
        <p className="text-[11px] text-slate-400 -mt-2 mb-3">
          태그 칸을 클릭해 이름을 고치고, ✕로 삭제할 수 있어요. '미지정'은 기본 태그라 변경·삭제할 수 없어요.
        </p>
      )}

      {!user && (
        <EmptyState
          title="로그인이 필요합니다"
          description="로그인하면 저장한 단어를 태그별로 모아볼 수 있어요."
        />
      )}

      {user && (
      <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-left">
              <th className="px-3 py-2 font-semibold">단어</th>
              <th className="px-3 py-2 font-semibold">한국어</th>
              <th className="px-3 py-2 font-semibold">한국어 상세</th>
              <th className="px-3 py-2 font-semibold">영어뜻</th>
              <th className="px-3 py-2 font-semibold">예문</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">태그</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">등록일</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">다음복습일</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <WordRowsSkeleton />
            )}
            {!loading && words.length === 0 && (
              <tr>
                <td colSpan={COLS} className="px-3 py-6 text-center text-slate-400">
                  {filter
                    ? `'${filter}' 태그의 단어가 없어요.`
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
      )}
    </div>
  );
}
