import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";
import AudioButton from "../components/AudioButton";

const COLS = 10;
const PAGE_SIZE = 40;

// 태그 편집 input 폭: 한글(전각)은 넓고 영문/숫자는 좁아서 글자 수로만 잡으면
// 칸마다 오른쪽 여백이 들쭉날쭉해진다. 글자별 실측 폭을 더해 여백을 통일한다. (단위: rem)
const isWideChar = (ch) =>
  /[ᄀ-ᇿ㄰-㆏가-힣　-〿＀-￯]/.test(ch);
const estLabelWidth = (s) => {
  let w = 0;
  for (const ch of s || "") w += isWideChar(ch) ? 0.95 : 0.55;
  return Math.max(w, 1.5) + 0.5; // 최소 폭 + 일정한 오른쪽 여백
};

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
  const lastIndexRef = useRef(null); // Shift+클릭 범위 선택용 (현재 페이지 기준 인덱스)
  const userId = user?.id || "";
  const [filter, setFilter] = useState(""); // "" = 전체
  const [page, setPage] = useState(0); // 0-based 페이지

  // 태그 편집 모드
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({}); // 원래이름 -> 편집중 값
  const [newLabel, setNewLabel] = useState(""); // 편집 모드에서 새 태그 추가 입력
  const [labelError, setLabelError] = useState("");

  // 단어 일괄 편집 모드
  const [rowEdit, setRowEdit] = useState(false);
  const [drafts, setDrafts] = useState({}); // id -> {korean_detail, english_def, example, tag, next_review}
  const [savingAll, setSavingAll] = useState(false);

  // 체크박스 다중 선택(삭제용)
  const [selected, setSelected] = useState(() => new Set());

  // 카드 보기: 예문 펼치기 / 뜻(영어뜻·한국어상세) 팝오버 토글 (모바일 클릭용)
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

  // 드래그 정렬
  const [dragIndex, setDragIndex] = useState(null);

  // CSV/XLSX 가져오기 (안내 모달 → 파일 선택 → 미리보기 모달)
  const [guideOpen, setGuideOpen] = useState(false); // 가져오기 형식 안내
  const [importing, setImporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState([]); // {key, word, korean, korean_detail, example, tag, dup}
  const [overwriteDup, setOverwriteDup] = useState(false); // 이미 있는 단어 덮어쓰기
  const [committing, setCommitting] = useState(false);

  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const labels = labelsQuery.data?.labels || [];

  // 단어는 '전체'를 한 번만 불러와 캐시하고(태그 전환 시 재조회 X),
  // 태그 필터는 클라이언트에서 적용한다. → 태그 전환 즉시, '갱신 중'은 최초/변경 시에만.
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

  // 필터가 바뀌면 1페이지로
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
    onError: () => setLabelError("태그 추가에 실패했어요. 잠시 후 다시 시도해주세요."),
  });

  const handleAddLabel = () => {
    const name = newLabel.trim();
    if (!name) return;
    if (labels.includes(name)) {
      setNewLabel("");
      return;
    }
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
      setGuideOpen(false); // 안내 모달 닫고 미리보기로 전환
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
        word: w.word || "",
        korean: w.korean || "",
        korean_detail: w.korean_detail || "",
        english_def: w.english_def || "",
        example: w.example || "",
        tag: w.tag || "미지정",
        next_review: "", // "" = 복습일 변경 안 함 (상대기간 코드 1d/1w/1m/3m 선택 시 변경)
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
        // swap 등으로 전체 실패 → 편집 모드 유지(사용자가 고칠 수 있게)
        alert(res.message || "저장에 실패했어요.");
        return;
      }
      // 일부 충돌 행은 건너뛰고 저장됨 → 안내
      if (res.conflicts?.length) {
        alert(res.message);
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

  // Shift+클릭: 직전 클릭 행 ~ 현재 행 범위를 한 번에 선택 (현재 페이지 기준)
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
    const ids = [...selected];
    const idSet = new Set(ids);
    // 낙관적: 캐시에서 즉시 제거 → 체감 속도 즉각 (원격 DB 왕복을 기다리지 않음)
    const prev = queryClient.getQueryData(queryKeys.words(""));
    queryClient.setQueryData(queryKeys.words(""), (old) =>
      old ? { words: old.words.filter((w) => !idSet.has(w.id)) } : old
    );
    setSelected(new Set());
    lastIndexRef.current = null;
    try {
      const res = await api.bulkDeleteWords(ids);
      if (res.ok === false) {
        alert(res.message || "삭제에 실패했어요.");
        queryClient.setQueryData(queryKeys.words(""), prev); // 롤백
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["label-word-count"] });
    } catch {
      alert("삭제 중 오류가 발생했어요.");
      queryClient.setQueryData(queryKeys.words(""), prev); // 롤백
    }
  };

  // ── 드래그 정렬 ('전체' 보기에서만) ──
  const onDrop = async (i) => {
    if (dragIndex === null || dragIndex === i) {
      setDragIndex(null);
      return;
    }
    // 순서 변경은 '전체' 보기에서만 가능하므로 words === allWords
    const next = [...allWords];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(i, 0, moved);
    setDragIndex(null);
    const prev = queryClient.getQueryData(queryKeys.words(""));
    queryClient.setQueryData(queryKeys.words(""), { words: next }); // 낙관적 반영
    try {
      const res = await api.reorderWords(next.map((w) => w.id));
      // 0건 반영도 실패로 간주 (조용한 원복 방지 → 바로 알 수 있게)
      if (!res || res.ok === false || res.updated === 0) {
        throw new Error("reorder not persisted");
      }
      // 성공: 캐시가 이미 서버와 동일하므로 재조회하지 않음 (깜빡임/되돌림 방지)
    } catch {
      queryClient.setQueryData(queryKeys.words(""), prev); // 롤백
      alert(
        "순서 저장에 실패했어요. 백엔드(/api/words/reorder)가 최신 코드로 켜져 있는지 확인해주세요."
      );
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
  const newCount = previewRows.length - dupCount;

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
            onClick={() => setGuideOpen(true)}
            disabled={!user || importing || rowEdit}
            title="CSV/XLSX 파일에서 단어를 한 번에 추가"
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
                삭제{selected.size ? ` (${selected.size})` : ""}
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
                미지정
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
                style={{ width: `${estLabelWidth(val)}rem` }}
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
              {labels.length < 20 && (
                <span className="inline-flex items-center gap-1">
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddLabel();
                      }
                    }}
                    placeholder="새 태그"
                    className="w-24 rounded-full border border-slate-300 px-3 h-8 text-[13px]
                               focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <button
                    type="button"
                    onClick={handleAddLabel}
                    disabled={addLabelMutation.isPending}
                    className="rounded-full text-[13px] font-medium px-3 h-8 bg-brand-50
                               text-brand-600 border border-brand-200 hover:bg-brand-100
                               disabled:opacity-50"
                  >
                    추가
                  </button>
                </span>
              )}
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
        <div className="-mt-2 mb-3 rounded-lg bg-slate-50 border border-slate-100
                        px-3 py-2 text-[11.5px] text-slate-500 leading-relaxed">
          태그 이름을 고치려면 칸에 입력, 삭제는 <b className="font-semibold">×</b>,
          새 태그는 <b className="font-semibold">‘새 태그’</b> 칸에 입력 후 <b className="font-semibold">추가</b>.
          <span className="text-slate-400"> ‘미지정’은 기본 태그라 변경·삭제할 수 없어요.</span>
          {labelError && (
            <span className="block text-rose-500 mt-1">{labelError}</span>
          )}
        </div>
      )}

      {rowEdit && (
        <div className="-mt-2 mb-3 rounded-lg bg-brand-50/60 border border-brand-100
                        px-3 py-2 text-[11.5px] text-slate-600 leading-relaxed">
          셀을 고친 뒤 <b className="font-semibold">저장</b>을 누르세요.
          <span className="text-slate-500"> 단어는 중복될 수 없어, 이미 있는 단어와 겹치면 그 행은 건너뜁니다.</span>
        </div>
      )}
      {!rowEdit && !editMode && canReorder && words.length > 1 && (
        <div className="-mt-2 mb-3 rounded-lg bg-slate-50 border border-slate-100
                        px-3 py-2 text-[11.5px] text-slate-500 leading-relaxed">
          <b className="font-semibold">⠿</b> 손잡이를 드래그해 순서 변경(자동 저장) ·
          체크박스 선택(<b className="font-semibold">Shift+클릭</b>=범위) 후 <b className="font-semibold">삭제</b>로 한 번에 제거.
        </div>
      )}

      {!user && (
        <EmptyState
          title="로그인이 필요합니다"
          description="로그인하면 저장한 단어를 태그별로 모아볼 수 있어요."
        />
      )}

      {/* 카드형 그리드 (보기/편집 공용) */}
      {user && (
        <div>
          {/* 현재 페이지 전체선택 바 (보기 모드만) */}
          {!rowEdit && !loading && words.length > 0 && (
            <div className="flex items-center gap-2 mb-2 px-1 text-[13px] text-slate-500">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleSelectAll}
                title="현재 페이지 전체 선택"
              />
              <span>
                현재 페이지 전체 선택
                {selected.size > 0 && (
                  <span className="text-slate-400"> · {selected.size}개 선택됨</span>
                )}
              </span>
            </div>
          )}

          {loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <SkeletonBlock className="h-5 w-32 mb-3" />
                  <SkeletonBlock className="h-4 w-24 mb-2" />
                  <SkeletonBlock className="h-3 w-full" />
                </div>
              ))}
            </div>
          )}

          {!loading && words.length === 0 && (
            <EmptyState
              title={filter ? `'${filter}' 태그의 단어가 없어요.` : "저장된 단어가 없어요."}
              description={
                filter
                  ? "다른 태그를 골라보거나 단어를 추가해보세요."
                  : "단어 검색 탭에서 저장하거나 CSV를 가져와보세요!"
              }
            />
          )}

          {!loading && words.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pageWords.map((w, idx) => {
                const i = start + idx; // 전역 인덱스 (드래그용)
                const checked = selected.has(w.id);
                const d = drafts[w.id] || {}; // 편집 모드 초안 값
                const exExpanded = expandedEx.has(w.id);
                const meaningShown = openMeaning.has(w.id);
                const hasMeaning = !!(w.english_def || w.korean_detail);
                return (
                  <div
                    key={w.id}
                    className={`group relative rounded-xl border bg-white p-4 transition-shadow
                      hover:shadow-md ${
                        checked
                          ? "border-rose-300 ring-2 ring-rose-100"
                          : "border-slate-200"
                      } ${dragIndex === i ? "opacity-50" : ""}`}
                    onDragOver={canReorder ? (e) => e.preventDefault() : undefined}
                    onDrop={canReorder ? () => onDrop(i) : undefined}
                  >
                    {rowEdit ? (
                      /* ── 편집 모드 카드 ── */
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[11px] text-slate-400">영어 단어</span>
                            <input
                              value={d.word ?? ""}
                              onChange={(e) => setDraftField(w.id, "word", e.target.value)}
                              className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1
                                         text-sm font-semibold outline-none focus:border-brand-400"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[11px] text-slate-400">한국어</span>
                            <input
                              value={d.korean ?? ""}
                              onChange={(e) => setDraftField(w.id, "korean", e.target.value)}
                              className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1
                                         text-sm outline-none focus:border-brand-400"
                            />
                          </label>
                        </div>

                        <label className="block">
                          <span className="text-[11px] text-slate-400">한국어 상세</span>
                          <textarea
                            value={d.korean_detail ?? ""}
                            onChange={(e) =>
                              setDraftField(w.id, "korean_detail", e.target.value)
                            }
                            rows={2}
                            className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1
                                       text-sm outline-none focus:border-brand-400"
                          />
                        </label>

                        <label className="block">
                          <span className="text-[11px] text-slate-400">영어뜻</span>
                          <textarea
                            value={d.english_def ?? ""}
                            onChange={(e) =>
                              setDraftField(w.id, "english_def", e.target.value)
                            }
                            rows={2}
                            className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1
                                       text-sm outline-none focus:border-brand-400"
                          />
                        </label>

                        <label className="block">
                          <span className="text-[11px] text-slate-400">예문</span>
                          <textarea
                            value={d.example ?? ""}
                            onChange={(e) => setDraftField(w.id, "example", e.target.value)}
                            rows={2}
                            className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1
                                       text-sm outline-none focus:border-brand-400"
                          />
                        </label>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[11px] text-slate-400">태그</span>
                            <select
                              value={d.tag ?? "미지정"}
                              onChange={(e) => setDraftField(w.id, "tag", e.target.value)}
                              className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1
                                         text-sm bg-white outline-none focus:border-brand-400"
                            >
                              {labels.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-[11px] text-slate-400">
                              복습일{" "}
                              <span className="text-slate-300">
                                (현재 {String(w.next_review).slice(2, 10)})
                              </span>
                            </span>
                            <select
                              value={d.next_review ?? ""}
                              onChange={(e) =>
                                setDraftField(w.id, "next_review", e.target.value)
                              }
                              className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1
                                         text-sm bg-white outline-none focus:border-brand-400"
                            >
                              <option value="">변경 안 함</option>
                              <option value="1d">하루 뒤</option>
                              <option value="1w">일주일 뒤</option>
                              <option value="1m">한달 뒤</option>
                              <option value="3m">3개월 뒤</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    ) : (
                    <>
                    {/* 상단: 체크박스 + 드래그 핸들 */}
                    <div className="flex items-center justify-between mb-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        onClick={(e) => handleSelectClick(e, idx, w.id)}
                        title="선택 (Shift+클릭=범위)"
                      />
                      <span
                        className={`select-none text-slate-400 ${
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
                        ⠿
                      </span>
                    </div>

                    {/* 단어 + 발음 */}
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="min-w-0 text-lg font-bold text-slate-800 leading-tight break-words">
                        {w.word}
                      </h4>
                      <span className="shrink-0">
                        <AudioButton word={w.word} lang="en" />
                      </span>
                    </div>

                    {/* 한국어 */}
                    <p className="mt-0.5 text-sm text-slate-600">
                      {w.korean || <span className="text-slate-300">-</span>}
                    </p>

                    {/* 예문: 한 줄 truncate → 클릭으로 펼치기 */}
                    {w.example && (
                      <p
                        onClick={() => toggleExpandedEx(w.id)}
                        title={exExpanded ? "접기" : "펼쳐 보기"}
                        className={`mt-2 text-[13px] text-slate-500 italic cursor-pointer ${
                          exExpanded ? "whitespace-pre-wrap" : "truncate"
                        }`}
                      >
                        {w.example}
                      </p>
                    )}

                    {/* 뜻(영어뜻·한국어상세): 평소 숨김 → hover 팝오버 / 모바일 클릭 토글 */}
                    {hasMeaning && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => toggleMeaning(w.id)}
                          className="text-[12px] text-brand-600 hover:underline sm:hidden"
                        >
                          {meaningShown ? "뜻 숨기기" : "뜻 보기"}
                        </button>

                        {/* 데스크톱: 카드 hover 팝오버 / 모바일: 클릭 시 인라인 표시 */}
                        <div
                          className={`mt-1 rounded-lg border border-slate-200 bg-slate-50 p-2.5
                            text-[12.5px] text-slate-600 leading-relaxed space-y-1
                            ${meaningShown ? "block" : "hidden"}
                            sm:block sm:absolute sm:left-3 sm:right-3 sm:top-full sm:mt-1 sm:z-20
                            sm:opacity-0 sm:invisible sm:shadow-lg
                            sm:group-hover:opacity-100 sm:group-hover:visible
                            sm:transition-opacity`}
                        >
                          {w.korean_detail && (
                            <p className="whitespace-pre-wrap">
                              <span className="text-slate-400">상세 </span>
                              {w.korean_detail}
                            </p>
                          )}
                          {w.english_def && (
                            <p className="whitespace-pre-wrap">
                              <span className="text-slate-400">영어뜻 </span>
                              {w.english_def}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 하단 메타: 태그 칩 · 등록일 | 복습일 (한 줄, 년도 2자리) */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                      {w.tag && (
                        <span className="inline-flex items-center rounded-full bg-brand-50 text-brand-600 font-medium px-2 py-0.5">
                          {w.tag}
                        </span>
                      )}
                      <span className="whitespace-nowrap" title="등록일">
                        {String(w.created_at).slice(2, 10)}
                      </span>
                      <span className="text-slate-300">|</span>
                      <span className="whitespace-nowrap" title="다음 복습일">
                        {String(w.next_review).slice(2, 10)}
                      </span>
                    </div>
                    </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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

      {guideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 w-full max-w-lg
                       max-h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="px-6 pt-5 pb-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">단어 가져오기</h3>
                <p className="text-[13px] text-slate-500 mt-0.5">
                  CSV 또는 Excel(.xlsx) 파일에서 단어를 한 번에 추가해요.
                </p>
              </div>
              <button
                onClick={() => setGuideOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none -mt-1"
                title="닫기"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-4 overflow-auto grow space-y-4 text-sm text-slate-600">
              <div>
                <p className="font-semibold text-slate-700 mb-1.5">지원 형식</p>
                <p className="text-[13px] leading-relaxed">
                  <b>.csv</b>, <b>.xlsx</b> 파일을 지원해요. 첫 두 열이
                  <b> 영어 · 한국어</b>면 됩니다. 구글 번역 단어장 내보내기 파일도 그대로 쓸 수 있어요.
                </p>
              </div>

              <div>
                <p className="font-semibold text-slate-700 mb-1.5">예시 ① 간단한 2열</p>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-[13px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold border-b border-slate-200">영어</th>
                        <th className="text-left px-3 py-1.5 font-semibold border-b border-slate-200">한국어</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="px-3 py-1.5">apple</td><td className="px-3 py-1.5">사과</td></tr>
                      <tr className="bg-slate-50/60"><td className="px-3 py-1.5">commute</td><td className="px-3 py-1.5">통근하다</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="font-semibold text-slate-700 mb-1.5">예시 ② 구글 번역 내보내기(4열)</p>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-[13px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold border-b border-slate-200">영어</th>
                        <th className="text-left px-3 py-1.5 font-semibold border-b border-slate-200">한국어</th>
                        <th className="text-left px-3 py-1.5 font-semibold border-b border-slate-200">word</th>
                        <th className="text-left px-3 py-1.5 font-semibold border-b border-slate-200">번역</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="px-3 py-1.5">영어</td><td className="px-3 py-1.5">한국어</td><td className="px-3 py-1.5">apple</td><td className="px-3 py-1.5">사과</td></tr>
                      <tr className="bg-slate-50/60"><td className="px-3 py-1.5">영어</td><td className="px-3 py-1.5">한국어</td><td className="px-3 py-1.5">commute</td><td className="px-3 py-1.5">통근하다</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[12px] text-slate-400 mt-1.5">
                  언어 라벨(영어/한국어)을 보고 영어 쪽을 단어로 자동 인식해요.
                </p>
              </div>

              <p className="text-[12px] text-slate-400">
                파일을 고르면 <b>미리보기</b> 화면에서 검토·수정한 뒤 적용해요. 이미 있는 단어는 자동으로 건너뜁니다.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                onClick={() => setGuideOpen(false)}
                disabled={importing}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                           px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="rounded-lg bg-brand-600 text-white hover:bg-brand-700
                           px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {importing ? "읽는 중..." : "파일 선택 (.csv / .xlsx)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          {/* 배경 클릭으로 닫지 않음 — input 드래그 선택 중 실수로 닫혀 작업이 사라지는 문제 방지.
              닫기는 X/취소/적용 버튼으로만. */}
          <div
            className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 w-full max-w-3xl
                       max-h-[85vh] flex flex-col overflow-hidden"
          >
            {/* 헤더 */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-200">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold">가져오기 미리보기</h3>
                  <p className="text-[13px] text-slate-500 mt-0.5">
                    검토·수정한 뒤 적용하세요. 적용 전까지 단어장에 저장되지 않아요.
                  </p>
                </div>
                <button
                  onClick={closePreview}
                  className="text-slate-400 hover:text-slate-600 text-2xl leading-none -mt-1"
                  title="닫기"
                >
                  ×
                </button>
              </div>
              {/* 요약 칩 */}
              <div className="flex items-center gap-2 mt-3 text-[13px]">
                <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 font-medium">
                  총 {previewRows.length}
                </span>
                <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 font-medium">
                  신규 {newCount}
                </span>
                <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2.5 py-1 font-medium">
                  이미 있음 {dupCount}
                </span>
              </div>
            </div>

            {/* 툴바 */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2 flex-wrap text-sm">
              <span className="text-slate-500">전체 태그:</span>
              <select
                onChange={(e) => {
                  if (e.target.value) applyAllTag(e.target.value);
                  e.target.value = "";
                }}
                defaultValue=""
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white
                           outline-none focus:border-brand-400"
              >
                <option value="" disabled>
                  태그 일괄 지정...
                </option>
                {labels.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {dupCount > 0 && (
                <>
                  <button
                    onClick={removeDupRows}
                    className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 font-medium"
                  >
                    이미 있는 {dupCount}개 빼기
                  </button>
                  <label className="inline-flex items-center gap-1.5 ml-auto text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={overwriteDup}
                      onChange={(e) => setOverwriteDup(e.target.checked)}
                    />
                    이미 있는 단어 덮어쓰기
                  </label>
                </>
              )}
            </div>

            <div className="overflow-auto px-6 py-2 grow">
              {previewRows.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  적용할 단어가 없어요. 모두 제외되었습니다.
                </div>
              ) : (
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-slate-500 sticky top-0 bg-white z-10">
                    <th className="py-2 pr-2 font-semibold border-b border-slate-200">영어단어</th>
                    <th className="py-2 pr-2 font-semibold border-b border-slate-200">한국어</th>
                    <th className="py-2 pr-2 font-semibold border-b border-slate-200">예문(선택)</th>
                    <th className="py-2 pr-2 font-semibold whitespace-nowrap border-b border-slate-200">태그</th>
                    <th className="py-2 w-16 border-b border-slate-200" />
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, ri) => (
                    <tr
                      key={r.key}
                      className={
                        r.dup ? "bg-amber-50" : ri % 2 ? "bg-slate-50/60" : ""
                      }
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
                            title={
                              overwriteDup
                                ? "이미 단어장에 있어요. 적용하면 새 내용으로 덮어씁니다."
                                : "이미 단어장에 있어요. 적용하면 이 단어는 건너뜁니다."
                            }
                            className={`inline-block mr-1 text-[11px] ${
                              overwriteDup ? "text-brand-600" : "text-amber-700"
                            }`}
                          >
                            {overwriteDup ? "덮어씀" : "이미 있음"}
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
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <span className="text-[12px] text-slate-400 mr-auto">
                {overwriteDup
                  ? "이미 있는 단어는 가져온 값(빈칸 제외)으로 덮어씁니다."
                  : "이미 있는 단어는 적용 시 자동으로 건너뜁니다."}
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
