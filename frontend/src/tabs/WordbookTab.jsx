import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";
import LabelSelector from "@/components/wordbook/LabelSelector";
import WordCard from "@/components/wordbook/WordCard";
import WordImportDialog from "@/components/wordbook/WordImportDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, HelpCircle, Import, Trash2, Edit3, Save, X } from "lucide-react";

const PAGE_SIZE = 24; // 반응형 그리드에 적합한 페이지 사이즈 (2, 3, 4로 나누어 떨어짐)

const isWideChar = (ch) =>
  /[\u3130-\u318F\uAC00-\uD7A3\u3000-\u303F\uFF00-\uFFEF]/.test(ch);
const estLabelWidth = (s) => {
  let w = 0;
  for (const ch of s || "") w += isWideChar(ch) ? 0.95 : 0.55;
  return Math.max(w, 1.5) + 0.5;
};

export default function WordbookTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const lastIndexRef = useRef(null);
  const userId = user?.id || "";
  const [filter, setFilter] = useState(""); // "" = 전체
  const [page, setPage] = useState(0);

  // 태그 편집 모드
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [newLabel, setNewLabel] = useState("");
  const [labelError, setLabelError] = useState("");

  // 단어 일괄 편집 모드
  const [rowEdit, setRowEdit] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [savingAll, setSavingAll] = useState(false);

  // 체크박스 다중 선택(삭제용)
  const [selected, setSelected] = useState(() => new Set());

  // 카드 보기: 예문 펼치기 / 뜻(영어뜻·한국어상세) 토글
  const [expandedEx, setExpandedEx] = useState(() => new Set());
  const [openMeaning, setOpenMeaning] = useState(() => new Set());
  
  const toggleInSet = (setter) => (id) =>
    setter((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleExpandedEx = toggleInSet(setExpandedEx);
  const toggleMeaning = toggleInSet(setOpenMeaning);

  const fmtYMD2 = (date) =>
    `${String(date.getFullYear()).slice(2)}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  
  const reviewPreview = (code) => {
    const dt = new Date();
    if (code === "1d") dt.setDate(dt.getDate() + 1);
    else if (code === "1w") dt.setDate(dt.getDate() + 7);
    else if (code === "1m") dt.setMonth(dt.getMonth() + 1);
    else if (code === "3m") dt.setMonth(dt.getMonth() + 3);
    return fmtYMD2(dt);
  };

  // 드래그 정렬
  const [dragIndex, setDragIndex] = useState(null);

  // CSV/XLSX 가져오기
  const [guideOpen, setGuideOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [overwriteDup, setOverwriteDup] = useState(false);
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
    queryKey: queryKeys.words(""),
    queryFn: () => api.listWords(""),
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const allWords = wordsQuery.data?.words || [];
  const words = filter ? allWords.filter((w) => w.tag === filter) : allWords;

  useEffect(() => {
    setSelected(new Set());
    lastIndexRef.current = null;
  }, [filter, wordsQuery.data]);

  useEffect(() => {
    setPage(0);
  }, [filter]);

  const renameLabelMutation = useMutation({
    mutationFn: ({ orig, val }) => api.renameLabel(orig, val),
  });

  const addLabelMutation = useMutation({
    mutationFn: api.addLabel,
    onSuccess: ({ labels: next, ok }) => {
      queryClient.setQueryData(queryKeys.labels, { labels: next });
      if (ok) {
        setNewLabel("");
        setLabelError("");
      } else {
        setLabelError("태그는 최대 20개까지 추가할 수 있어요.");
      }
    },
    onError: () => setLabelError("태그 추가에 실패했어요."),
  });

  const handleAddLabel = () => {
    const name = newLabel.trim();
    if (!name || labels.includes(name)) return;
    if (labels.length >= 20) {
      setLabelError("태그는 최대 20개까지 추가할 수 있어요.");
      return;
    }
    addLabelMutation.mutate(name);
  };

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

  const refreshWords = async () => {
    await queryClient.invalidateQueries({ queryKey: ["words"] });
    await queryClient.invalidateQueries({ queryKey: ["label-word-count"] });
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const res = await api.importPreview(file);
      if (!res.ok) {
        alert(res.message || "가져오기에 실패했어요.");
        return;
      }
      const defTag = filter || "미지정";
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
      setGuideOpen(false);
      setPreviewOpen(true);
    } catch {
      alert("가져오는 중 오류가 발생했어요.");
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
    setOverwriteDup(false);
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
      const res = await api.importCommit(items, overwriteDup);
      if (res.ok === false) {
        alert(res.message || "적용에 실패했어요.");
        return;
      }
      closePreview();
      await refreshWords();
    } catch {
      alert("적용 중 오류가 발생했어요.");
    } finally {
      setCommitting(false);
    }
  };

  const enterEdit = () => {
    const init = {};
    labels.forEach((n) => {
      if (n !== "미지정") init[n] = n;
    });
    setEditValues(init);
    setNewLabel("");
    setLabelError("");
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditValues({});
    setNewLabel("");
    setLabelError("");
  };

  const commitEdits = async () => {
    for (const orig of Object.keys(editValues)) {
      const val = (editValues[orig] || "").trim();
      if (!val || val === orig) continue;
      const res = await renameLabelMutation.mutateAsync({ orig, val });
      if (!res.ok) {
        alert(res.message || "이름 변경에 실패했어요.");
        return;
      }
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    await refreshWords();
    setEditMode(false);
    setEditValues({});
    setFilter("");
  };

  const deleteInEdit = async (name) => {
    const ok = window.confirm(`'${name}' 태그를 삭제하면 포함된 단어도 함께 삭제됩니다. 계속하시겠습니까?`);
    if (!ok) return;
    deleteLabelMutation.mutate(name);
  };

  const enterRowEdit = () => {
    const init = {};
    words.forEach((w) => {
      init[w.id] = {
        word: w.word || "",
        korean: w.korean || "",
        korean_detail: w.korean_detail || "",
        english_def: w.english_def || "",
        example: w.example || "",
        tag: w.tag || "미지정",
        next_review: "",
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

  const toggleSelect = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSelectClick = (e, pageIdx, id) => {
    if (e.shiftKey && lastIndexRef.current != null) {
      const a = Math.min(lastIndexRef.current, pageIdx);
      const b = Math.max(lastIndexRef.current, pageIdx);
      setSelected((s) => {
        const next = new Set(s);
        for (let k = a; k <= b; k++) {
          if (pageWords[k]) next.add(pageWords[k].id);
        }
        return next;
      });
    } else {
      toggleSelect(id);
    }
    lastIndexRef.current = pageIdx;
  };

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
    const ids = [...selected];
    try {
      await api.bulkDeleteWords(ids);
      setSelected(new Set());
      await refreshWords();
    } catch {
      alert("삭제 중 오류가 발생했어요.");
    }
  };

  const onDrop = async (i) => {
    if (dragIndex === null || dragIndex === i) {
      setDragIndex(null);
      return;
    }
    const next = [...allWords];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(i, 0, moved);
    setDragIndex(null);
    try {
      await api.reorderWords(next.map((w) => w.id));
      queryClient.setQueryData(queryKeys.words(""), { words: next });
    } catch {
      alert("순서 저장에 실패했어요.");
    }
  };

  const loading = wordsQuery.isPending || labelsQuery.isPending;
  const refetching = wordsQuery.isFetching && !wordsQuery.isPending;
  const canReorder = filter === "" && !rowEdit;

  const totalPages = Math.max(1, Math.ceil(words.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages - 1);
  const start = curPage * PAGE_SIZE;
  const pageWords = words.slice(start, start + PAGE_SIZE);

  const allChecked =
    pageWords.length > 0 && pageWords.every((w) => selected.has(w.id));
  const dupCount = previewRows.filter((r) => r.dup).length;
  const newCount = previewRows.length - dupCount;

  return (
    <div className="h-full flex flex-col">
      {!user && <MemberNotice feature="단어장" onRequireLogin={onRequireLogin} />}

      {user && (
        <div className="flex flex-col gap-6 md:grid md:grid-cols-12 md:gap-6 items-start h-full">
          
          {/* A. 반응형 레이블 사이드바 / 상단 필터 영역 */}
          <div className="w-full md:col-span-3 md:sticky md:top-6 space-y-4">
            <div className="hidden md:block">
              <h2 className="text-xl font-bold text-slate-800 tracking-tight dark:text-slate-100">단어장</h2>
              <p className="text-xs text-slate-400 mt-0.5">내 단어 리스트와 태그를 관리합니다.</p>
            </div>
            
            <LabelSelector
              labels={labels}
              filter={filter}
              onSelectFilter={selectFilter}
              user={user}
              rowEdit={rowEdit}
              editMode={editMode}
              onEnterEdit={enterEdit}
              onCancelEdit={cancelEdit}
              onCommitEdits={commitEdits}
              editValues={editValues}
              setEditValues={setEditValues}
              newLabel={newLabel}
              setNewLabel={setNewLabel}
              onAddLabel={handleAddLabel}
              onDeleteLabel={deleteInEdit}
              labelError={labelError}
              estLabelWidth={estLabelWidth}
            />
          </div>

          {/* B. 메인 단어 목록 및 제어 영역 */}
          <div className="w-full md:col-span-9 flex flex-col gap-4 flex-1">
            
            {/* 단어장 헤더 툴바 */}
            <Card className="shadow-[0_2px_10px_rgba(0,0,0,0.02)] border-slate-100/80 rounded-2xl overflow-hidden">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {filter ? `🏷️ ${filter}` : "📚 전체 단어"}
                    <span className="text-xs text-slate-400 ml-1.5 font-normal">
                      ({words.length}개)
                    </span>
                  </h3>
                  {refetching && <LoadingSpinner label="" />}
                </div>

                {/* 컨트롤 버튼 그룹 */}
                <div className="flex items-center gap-1.5 flex-wrap sm:justify-end">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xlsm,.xls"
                    onChange={onImportFile}
                    className="hidden"
                  />
                  
                  {!rowEdit ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setGuideOpen(true)}
                        disabled={importing}
                        className="h-8.5 text-xs rounded-xl border-slate-200 hover:bg-slate-50 gap-1.5 px-3"
                      >
                        <Import className="h-3.5 w-3.5" />
                        가져오기
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={enterRowEdit}
                        disabled={words.length === 0}
                        className="h-8.5 text-xs rounded-xl border-slate-200 hover:bg-slate-50 gap-1.5 px-3"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        일괄 편집
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={deleteSelected}
                        disabled={selected.size === 0}
                        className="h-8.5 text-xs rounded-xl border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 gap-1.5 px-3"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        삭제{selected.size ? ` (${selected.size})` : ""}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        onClick={saveAll}
                        disabled={savingAll}
                        className="h-8.5 text-xs rounded-xl bg-brand-600 hover:bg-brand-700 text-white gap-1.5 px-4 font-bold"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingAll ? "저장 중..." : "일괄 저장"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={cancelRowEdit}
                        disabled={savingAll}
                        className="h-8.5 text-xs rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 gap-1.5 px-3"
                      >
                        <X className="h-3.5 w-3.5" />
                        취소
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 안내 텍스트 */}
            {rowEdit && (
              <div className="bg-brand-50/50 dark:bg-brand-950/10 border border-brand-100 rounded-xl px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed flex items-start gap-1.5">
                <HelpCircle className="h-4 w-4 text-brand-500 shrink-0 mt-0.5" />
                <div>
                  <b className="font-semibold">일괄 편집 모드:</b> 각 카드의 입력칸을 수정하고 우측 상단의 [일괄 저장]을 클릭하세요. 중복 단어 입력 시 저장을 건너뜁니다.
                </div>
              </div>
            )}
            {!rowEdit && !editMode && canReorder && words.length > 1 && (
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-100 rounded-xl px-4 py-2.5 text-xs text-slate-500 leading-relaxed flex items-start gap-1.5">
                <HelpCircle className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  정렬을 변경하려면 우측 상단의 <b className="font-semibold">Grip ⠿</b> 아이콘을 잡아 드래그앤드롭 하세요 (자동저장). 다중 선택 삭제는 체크박스를 클릭(Shift 범위 선택 지원) 하신 후 삭제 버튼을 누르시면 됩니다.
                </div>
              </div>
            )}

            {/* 단어 전체 선택 바 (보기 모드) */}
            {!rowEdit && !loading && words.length > 0 && (
              <div className="flex items-center gap-2.5 px-1.5 py-0.5 text-xs text-slate-500 font-medium">
                <input
                  type="checkbox"
                  id="selectAll"
                  checked={allChecked}
                  onChange={toggleSelectAll}
                  className="rounded border-slate-300 text-brand-600 h-3.5 w-3.5 cursor-pointer"
                />
                <label htmlFor="selectAll" className="cursor-pointer">
                  현재 페이지 전체 선택
                  {selected.size > 0 && (
                    <span className="text-brand-600 font-semibold"> · {selected.size}개 선택됨</span>
                  )}
                </label>
              </div>
            )}

            {/* 카드 리스트 그리드 */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="p-4.5 border-slate-100">
                    <SkeletonBlock className="h-5 w-32 mb-3" />
                    <SkeletonBlock className="h-4 w-20 mb-2.5" />
                    <SkeletonBlock className="h-3 w-full" />
                  </Card>
                ))}
              </div>
            ) : words.length === 0 ? (
              <EmptyState
                title={filter ? `'${filter}' 태그의 단어가 없습니다.` : "단어장이 비어있습니다."}
                description={
                  filter
                    ? "다른 태그를 선택하거나 단어를 추가해보세요."
                    : "단어 검색 탭에서 단어를 등록하거나 파일 가져오기로 추가해보세요!"
                }
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {pageWords.map((w, idx) => {
                  const i = start + idx;
                  const checked = selected.has(w.id);
                  const d = drafts[w.id] || {};
                  const exExpanded = expandedEx.has(w.id);
                  const meaningShown = openMeaning.has(w.id);
                  const hasMeaning = !!(w.english_def || w.korean_detail || w.slang_def);

                  return (
                    <WordCard
                      key={w.id}
                      w={w}
                      idx={i}
                      checked={checked}
                      rowEdit={rowEdit}
                      d={d}
                      exExpanded={exExpanded}
                      meaningShown={meaningShown}
                      hasMeaning={hasMeaning}
                      canReorder={canReorder}
                      dragIndex={dragIndex}
                      setDragIndex={setDragIndex}
                      onDrop={onDrop}
                      setDraftField={setDraftField}
                      toggleMeaning={toggleMeaning}
                      toggleExpandedEx={toggleExpandedEx}
                      handleSelectClick={handleSelectClick}
                      labels={labels}
                      reviewPreview={reviewPreview}
                    />
                  );
                })}
              </div>
            )}

            {/* 페이지네이션 */}
            {!loading && totalPages > 1 && (
              <div className="flex items-center justify-center gap-1.5 pt-4 pb-6 mt-auto">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={curPage === 0}
                  onClick={() => setPage(curPage - 1)}
                  className="h-8.5 w-8.5 rounded-lg border-slate-200 text-slate-600"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <span className="text-xs font-semibold text-slate-600 px-3">
                  {curPage + 1} / {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="icon"
                  disabled={curPage === totalPages - 1}
                  onClick={() => setPage(curPage + 1)}
                  className="h-8.5 w-8.5 rounded-lg border-slate-200 text-slate-600"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

          </div>

        </div>
      )}

      {/* CSV/XLSX 가져오기 다이얼로그 모달 */}
      <WordImportDialog
        guideOpen={guideOpen}
        onCloseGuide={() => setGuideOpen(false)}
        onImportClick={() => fileInputRef.current?.click()}
        importing={importing}
        previewOpen={previewOpen}
        onClosePreview={closePreview}
        previewRows={previewRows}
        dupCount={dupCount}
        newCount={newCount}
        overwriteDup={overwriteDup}
        setOverwriteDup={setOverwriteDup}
        onSetPreviewField={setPreviewField}
        onRemovePreviewRow={removePreviewRow}
        onApplyAllTag={applyAllTag}
        onRemoveDupRows={removeDupRows}
        onCommitPreview={commitPreview}
        committing={committing}
        labels={labels}
      />
    </div>
  );
}
