import { useEffect, useRef, useState } from "react";
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

const COLS = 10;
const PAGE_SIZE = 40;

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
  const fileInputRef = useRef(null);
  const userId = user?.id || "";
  const [filter, setFilter] = useState(""); // "" = 전체
  const [page, setPage] = useState(0); // 0-based 페이지

  // 태그 편집 모드
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({}); // 원래이름 -> 편집중 값

  // 단어 일괄 편집 모드
  const [rowEdit, setRowEdit] = useState(false);
  const [drafts, setDrafts] = useState({}); // id -> {korean_detail, english_def, example, tag, next_review}
  const [savingAll, setSavingAll] = useState(false);

  // 체크박스 다중 선택(삭제용)
  const [selected, setSelected] = useState(() => new Set());

  // 드래그 정렬
  const [dragIndex, setDragIndex] = useState(null);

  // CSV/XLSX 가져오기 (미리보기 모달)
  const [importing, setImporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState([]); // {key, word, korean, korean_detail, example, tag, dup}
  const [committing, setCommitting] = useState(false);

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

  useEffect(() => {
    setSelected(new Set());
  }, [filter, wordsQuery.data]);

  // 필터가 바뀌면 1페이지로
  useEffect(() => {
    setPage(0);
  }, [filter]);

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
      queryClient.invalidateQueries({ queryKey: ["label-word-count"] });
      setEditValues((prev) => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
      if (filter === name) setFilter("");
    },
  });

  const selectFilter = (label) => {
    setRowEdit(false);
    setDrafts({});
    setFilter(label);
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    queryClient.invalidateQueries({ queryKey: queryKeys.words(filter) });
    queryClient.invalidateQueries({ queryKey: ["label-word-count"] });
  };

  const refreshWords = async () => {
    await queryClient.invalidateQueries({ queryKey: ["words"] });
    await queryClient.invalidateQueries({ queryKey: ["label-word-count"] });
  };

  // ── CSV/XLSX 가져오기: 미리보기 → 편집 → 적용 ──
  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 가능하도록 초기화
    if (!file) return;
    setImporting(true);
    try {
      const res = await api.importPreview(file);
      if (!res.ok) {
        alert(res.message || "가져오기에 실패했어요.");
        return;
      }
      const defTag = filter || "미지정"; // 특정 태그 보는 중이면 그 태그를 기본값으로
      setPreviewRows(
        res.rows.map((r, i) => ({
          key: i,
          word: r.word,
          korean: r.korean,
          korean_detail: "",
          example: "",
          tag: defTag,
          dup: r.dup,
        }))
      );
      setPreviewOpen(true);
    } catch {
      alert("가져오는 중 오류가 발생했어요. 파일 형식을 확인해주세요.");
    } finally {
      setImporting(false);
    }
  };

  const setPreviewField = (key, field, val) =>
    setPreviewRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, [field]: val } : r))
    );

  const removePreviewRow = (key) =>
    setPreviewRows((rows) => rows.filter((r) => r.key !== key));

  const applyAllTag = (tag) =>
    setPreviewRows((rows) => rows.map((r) => ({ ...r, tag })));

  const removeDupRows = () =>
    setPreviewRows((rows) => rows.filter((r) => !r.dup));

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewRows([]);
  };

  const commitPreview = async () => {
    const items = previewRows
      .filter((r) => (r.word || "").trim())
      .map((r) => ({
        word: r.word.trim(),
        korean: r.korean,
        korean_detail: r.korean_detail,
        example: r.example,
        tag: r.tag,
      }));
    if (items.length === 0) {
      alert("적용할 단어가 없어요.");
      return;
    }
    setCommitting(true);
    try {
      const res = await api.importCommit(items);
      if (res.ok === false) {
        alert(res.message || "적용에 실패했어요.");
        return;
      }
      closePreview();
      alert(res.message || "적용했어요.");
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
      await refreshWords();
    } catch {
      alert("적용 중 오류가 발생했어요.");
    } finally {
      setCommitting(false);
    }
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
    await refreshWords();
    setEditMode(false);
    setEditValues({});
    setFilter("");
  };

  const deleteInEdit = async (name) => {
    let count = 0;
    try {
      count = (
        await queryClient.fetchQuery({
          queryKey: queryKeys.labelWordCount(userId, name),
          queryFn: () => api.labelWordCount(name),
          staleTime: 15_000,
        })
      ).count;
    } catch {
      alert("태그에 포함된 단어 수를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    const ok = window.confirm(
      `'${name}' 태그를 삭제하면 이 태그의 단어 ${count}개도 함께 삭제됩니다.\n계속하시겠습니까?`
    );
    if (!ok) return;
    deleteLabelMutation.mutate(name);
  };

  // ── 단어 일괄 편집 ──
  const enterRowEdit = () => {
    const init = {};
    words.forEach((w) => {
      init[w.id] = {
        korean_detail: w.korean_detail || "",
        english_def: w.english_def || "",
        example: w.example || "",
        tag: w.tag || "미지정",
        next_review: String(w.next_review).slice(0, 10),
      };
    });
    setDrafts(init);
    setSelected(new Set());
    setRowEdit(true);
  };

  const cancelRowEdit = () => {
    setRowEdit(false);
    setDrafts({});
  };

  const setDraftField = (id, field, val) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: val } }));

  const saveAll = async () => {
    setSavingAll(true);
    try {
      const items = words.map((w) => ({ id: w.id, ...drafts[w.id] }));
      const res = await api.bulkUpdateWords(items);
      if (res.ok === false) {
        alert(res.message || "저장에 실패했어요.");
        return;
      }
      setRowEdit(false);
      setDrafts({});
      await refreshWords();
    } catch {
      alert("저장 중 오류가 발생했어요.");
    } finally {
      setSavingAll(false);
    }
  };

  // ── 체크박스 선택 / 다중 삭제 ──
  const toggleSelect = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // 현재 페이지 항목만 전체 선택/해제 (선택은 페이지 넘어가도 유지)
  const toggleSelectAll = () =>
    setSelected((s) => {
      const next = new Set(s);
      const ids = pageWords.map((w) => w.id);
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    const ok = window.confirm(`선택한 ${selected.size}개 단어를 삭제할까요?`);
    if (!ok) return;
    try {
      const res = await api.bulkDeleteWords([...selected]);
      if (res.ok === false) {
        alert(res.message || "삭제에 실패했어요.");
        return;
      }
      await refreshWords();
    } catch {
      alert("삭제 중 오류가 발생했어요.");
    }
  };

  // ── 드래그 정렬 ('전체' 보기에서만) ──
  const onDrop = async (i) => {
    if (dragIndex === null || dragIndex === i) {
      setDragIndex(null);
      return;
    }
    const next = [...words];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(i, 0, moved);
    setDragIndex(null);
    queryClient.setQueryData(queryKeys.words(filter), { words: next });
    try {
      await api.reorderWords(next.map((w) => w.id));
      queryClient.invalidateQueries({ queryKey: queryKeys.words(filter) });
    } catch {
      queryClient.invalidateQueries({ queryKey: queryKeys.words(filter) });
    }
  };

  const loading = wordsQuery.isPending || labelsQuery.isPending;
  const refetching = wordsQuery.isFetching && !wordsQuery.isPending;
  const canReorder = filter === "" && !rowEdit; // 순서 변경은 '전체' 보기에서만

  // ── 페이지네이션 (40개씩) ──
  const totalPages = Math.max(1, Math.ceil(words.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages - 1); // 삭제 등으로 페이지 수 줄면 클램프
  const start = curPage * PAGE_SIZE;
  const pageWords = words.slice(start, start + PAGE_SIZE);

  const allChecked =
    pageWords.length > 0 && pageWords.every((w) => selected.has(w.id));
  const dupCount = previewRows.filter((r) => r.dup).length;

  return (
    <div>
      {!user && <MemberNotice feature="단어장" onRequireLogin={onRequireLogin} />}

      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-base font-semibold">
          저장된 단어 목록{" "}
          <span className="text-slate-400 font-normal">({words.length}개)</span>
          {refetching && <span className="ml-2"><LoadingSpinner label="갱신 중" /></span>}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.xls"
            onChange={onImportFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!user || importing || rowEdit}
            title="구글 번역 단어장 등에서 받은 CSV/XLSX (첫 두 열: 영어 | 한국어)를 한 번에 추가"
            className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                       px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? "가져오는 중..." : "가져오기"}
          </button>

          {!rowEdit ? (
            <>
              <button
                onClick={enterRowEdit}
                disabled={!user || words.length === 0}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                           px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                편집
              </button>
              <button
                onClick={deleteSelected}
                disabled={!user || selected.size === 0}
                className="rounded-lg border border-slate-300 bg-white hover:bg-rose-50
                           hover:text-rose-600 hover:border-rose-200 px-3 py-1.5 text-sm font-medium
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                선택 삭제{selected.size ? ` (${selected.size})` : ""}
              </button>
              <button
                onClick={refresh}
                disabled={!user}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                           px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                새로고침
              </button>
            </>
          ) : (
            <>
              <button
                onClick={saveAll}
                disabled={savingAll}
                className="rounded-lg bg-brand-600 text-white hover:bg-brand-700
                           px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {savingAll ? "저장 중..." : "저장"}
              </button>
              <button
                onClick={cancelRowEdit}
                disabled={savingAll}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                           px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                취소
              </button>
            </>
          )}
        </div>
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
                title="기본 태그 - 변경/삭제 불가"
              >
                미지정 잠금
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
                x
              </button>
            </span>
          );
        })}

        {/* 태그 편집/확인 버튼 (회원만, 단어 일괄편집 중엔 숨김) */}
        {user && !rowEdit &&
          (!editMode ? (
            <button
              onClick={enterEdit}
              className="rounded-full text-[13px] font-medium px-3 h-8 border border-dashed
                         border-slate-300 text-slate-500 hover:bg-slate-50"
            >
              태그 편집
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
          태그 칸을 클릭해 이름을 고치고, x로 삭제할 수 있어요. '미지정'은 기본 태그라 변경/삭제할 수 없어요.
        </p>
      )}

      {rowEdit && (
        <p className="text-[11px] text-slate-400 -mt-2 mb-3">
          모든 행을 한 번에 편집 중이에요. 영어단어/한국어는 고정이고, 한국어 상세/영어뜻/예문/태그/복습일을 고친 뒤 저장을 누르세요.
        </p>
      )}
      {!rowEdit && canReorder && words.length > 1 && (
        <p className="text-[11px] text-slate-400 -mt-2 mb-3">
          맨 앞 손잡이를 드래그해 순서를 바꿀 수 있어요(자동 저장). 체크박스로 여러 개를 골라 선택 삭제할 수 있어요.
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
                <th className="px-2 py-2 w-9 text-center">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleSelectAll}
                    disabled={words.length === 0}
                    title="현재 페이지 전체 선택"
                  />
                </th>
                <th className="px-1 py-2 w-6" />
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
              {loading && <WordRowsSkeleton />}
              {!loading && words.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="px-3 py-6 text-center text-slate-400">
                    {filter
                      ? `'${filter}' 태그의 단어가 없어요.`
                      : "저장된 단어가 없어요. 단어 검색 탭에서 저장하거나 CSV를 가져와보세요!"}
                  </td>
                </tr>
              )}
              {pageWords.map((w, idx) => {
                const i = start + idx; // words 배열 내 전역 인덱스 (드래그용)
                const d = drafts[w.id] || {};
                const checked = selected.has(w.id);
                return (
                  <tr
                    key={w.id}
                    className={`border-t border-slate-100 align-top ${
                      checked ? "bg-rose-50/40" : rowEdit ? "bg-brand-50/30" : ""
                    } ${dragIndex === i ? "opacity-50" : ""}`}
                    onDragOver={canReorder ? (e) => e.preventDefault() : undefined}
                    onDrop={canReorder ? () => onDrop(i) : undefined}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(w.id)}
                      />
                    </td>
                    <td
                      className={`px-1 py-2 text-center text-slate-400 ${
                        canReorder ? "cursor-move" : "opacity-30"
                      }`}
                      draggable={canReorder}
                      onDragStart={canReorder ? () => setDragIndex(i) : undefined}
                      onDragEnd={() => setDragIndex(null)}
                      title={
                        canReorder
                          ? "드래그해서 순서 변경"
                          : "순서 변경은 '전체' 보기에서만 가능해요"
                      }
                    >
                      ::
                    </td>
                    <td className="px-3 py-2 font-medium">{w.word}</td>
                    <td className="px-3 py-2">{w.korean}</td>

                    <td className="px-3 py-2 whitespace-pre-wrap text-slate-600">
                      {rowEdit ? (
                        <textarea
                          value={d.korean_detail ?? ""}
                          onChange={(e) =>
                            setDraftField(w.id, "korean_detail", e.target.value)
                          }
                          rows={2}
                          className="w-full min-w-[7rem] rounded-md border border-slate-300 px-2 py-1
                                     text-sm outline-none focus:border-brand-400"
                        />
                      ) : (
                        w.korean_detail || "-"
                      )}
                    </td>

                    <td className="px-3 py-2 whitespace-pre-wrap">
                      {rowEdit ? (
                        <textarea
                          value={d.english_def ?? ""}
                          onChange={(e) =>
                            setDraftField(w.id, "english_def", e.target.value)
                          }
                          rows={2}
                          className="w-full min-w-[7rem] rounded-md border border-slate-300 px-2 py-1
                                     text-sm outline-none focus:border-brand-400"
                        />
                      ) : (
                        w.english_def
                      )}
                    </td>

                    <td className="px-3 py-2 whitespace-pre-wrap">
                      {rowEdit ? (
                        <textarea
                          value={d.example ?? ""}
                          onChange={(e) =>
                            setDraftField(w.id, "example", e.target.value)
                          }
                          rows={2}
                          className="w-full min-w-[7rem] rounded-md border border-slate-300 px-2 py-1
                                     text-sm outline-none focus:border-brand-400"
                        />
                      ) : (
                        w.example
                      )}
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap">
                      {rowEdit ? (
                        <select
                          value={d.tag ?? "미지정"}
                          onChange={(e) => setDraftField(w.id, "tag", e.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm
                                     outline-none focus:border-brand-400 bg-white"
                        >
                          {labels.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      ) : w.tag ? (
                        <span className="inline-flex items-center rounded-full bg-brand-50
                                         text-brand-600 text-xs font-medium px-2 py-0.5">
                          {w.tag}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                      {String(w.created_at).slice(0, 10)}
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                      {rowEdit ? (
                        <input
                          type="date"
                          value={d.next_review ?? ""}
                          onChange={(e) =>
                            setDraftField(w.id, "next_review", e.target.value)
                          }
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm
                                     outline-none focus:border-brand-400"
                        />
                      ) : (
                        String(w.next_review).slice(0, 10)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {user && words.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-3 text-sm">
          <button
            onClick={() => setPage(Math.max(0, curPage - 1))}
            disabled={curPage === 0}
            className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                       px-3 py-1.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            이전
          </button>
          <span className="text-slate-500">
            {curPage + 1} / {totalPages}
            <span className="text-slate-400">
              {" "}
              ({start + 1}-{Math.min(start + PAGE_SIZE, words.length)})
            </span>
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, curPage + 1))}
            disabled={curPage >= totalPages - 1}
            className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                       px-3 py-1.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            다음
          </button>
        </div>
      )}

      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closePreview}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold">
                가져오기 미리보기{" "}
                <span className="text-slate-400 font-normal">
                  ({previewRows.length}개)
                </span>
              </h3>
              <button
                onClick={closePreview}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
                title="닫기"
              >
                x
              </button>
            </div>

            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap text-sm">
              <span className="text-slate-500">전체 태그 지정:</span>
              <select
                onChange={(e) => {
                  if (e.target.value) applyAllTag(e.target.value);
                  e.target.value = "";
                }}
                defaultValue=""
                className="rounded-md border border-slate-300 px-2 py-1 text-sm bg-white
                           outline-none focus:border-brand-400"
              >
                <option value="" disabled>
                  태그 선택...
                </option>
                {labels.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {dupCount > 0 && (
                <button
                  onClick={removeDupRows}
                  className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 px-2 py-1"
                >
                  이미 있는 {dupCount}개 제외
                </button>
              )}
              <span className="text-slate-400 ml-auto">
                영어단어/한국어는 파일값이에요. 필요하면 고치세요.
              </span>
            </div>

            <div className="overflow-auto px-5 py-2 grow">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 sticky top-0 bg-white">
                    <th className="py-2 pr-2 font-semibold">영어단어</th>
                    <th className="py-2 pr-2 font-semibold">한국어</th>
                    <th className="py-2 pr-2 font-semibold">예문(선택)</th>
                    <th className="py-2 pr-2 font-semibold whitespace-nowrap">태그</th>
                    <th className="py-2 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr
                      key={r.key}
                      className={`border-t border-slate-100 ${r.dup ? "bg-amber-50" : ""}`}
                    >
                      <td className="py-1.5 pr-2">
                        <input
                          value={r.word}
                          onChange={(e) =>
                            setPreviewField(r.key, "word", e.target.value)
                          }
                          className="w-full min-w-[7rem] rounded-md border border-slate-300 px-2 py-1
                                     outline-none focus:border-brand-400"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          value={r.korean}
                          onChange={(e) =>
                            setPreviewField(r.key, "korean", e.target.value)
                          }
                          className="w-full min-w-[6rem] rounded-md border border-slate-300 px-2 py-1
                                     outline-none focus:border-brand-400"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          value={r.example}
                          onChange={(e) =>
                            setPreviewField(r.key, "example", e.target.value)
                          }
                          placeholder="예문"
                          className="w-full min-w-[8rem] rounded-md border border-slate-300 px-2 py-1
                                     outline-none focus:border-brand-400"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <select
                          value={r.tag}
                          onChange={(e) =>
                            setPreviewField(r.key, "tag", e.target.value)
                          }
                          className="rounded-md border border-slate-300 px-2 py-1 bg-white
                                     outline-none focus:border-brand-400"
                        >
                          {labels.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {r.dup && (
                          <span
                            title="이미 단어장에 있어요. 적용하면 이 단어는 건너뜁니다."
                            className="inline-block mr-1 text-[11px] text-amber-700"
                          >
                            이미 있음
                          </span>
                        )}
                        <button
                          onClick={() => removePreviewRow(r.key)}
                          title="이 행 제외"
                          className="text-slate-400 hover:text-rose-600"
                        >
                          x
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <span className="text-[12px] text-slate-400 mr-auto">
                '이미 있음' 단어는 적용 시 자동으로 건너뜁니다.
              </span>
              <button
                onClick={closePreview}
                disabled={committing}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                           px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={commitPreview}
                disabled={committing || previewRows.length === 0}
                className="rounded-lg bg-brand-600 text-white hover:bg-brand-700
                           px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {committing ? "적용 중..." : `적용 (${previewRows.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
