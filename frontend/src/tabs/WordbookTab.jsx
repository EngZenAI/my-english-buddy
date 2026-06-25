import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import MemberNotice from "../components/MemberNotice";

const COLS = 10;

export default function WordbookTab({ user, onRequireLogin }) {
  const [words, setWords] = useState([]);
  const [labels, setLabels] = useState([]);
  const [filter, setFilter] = useState(""); // "" = 전체
  const [loading, setLoading] = useState(false);

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

  // CSV/XLSX 가져오기
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);

  const canReorder = filter === ""; // 순서 변경은 '전체' 보기에서만

  const load = async (label = filter) => {
    setLoading(true);
    try {
      const { words } = await api.listWords(label);
      setWords(words);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  };

  const reloadLabels = () =>
    api.listLabels().then(({ labels }) => setLabels(labels)).catch(() => {});

  useEffect(() => {
    if (!user) return; // 비회원: 데이터 조회 안 함 (미리보기만)
    reloadLabels();
    load("");
  }, [user]);

  const selectFilter = (label) => {
    setRowEdit(false);
    setDrafts({});
    setFilter(label);
    load(label);
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 가능하도록 초기화
    if (!file) return;
    setImporting(true);
    try {
      // 특정 태그를 보는 중이면 그 태그로, '전체'면 미지정으로 들어감
      const res = await api.importWords(file, filter || "");
      alert(res.message || (res.ok ? "가져왔어요." : "가져오기에 실패했어요."));
      if (res.ok) {
        await reloadLabels();
        await load();
      }
    } catch (err) {
      alert("가져오는 중 오류가 발생했어요. 파일 형식을 확인해주세요.");
    } finally {
      setImporting(false);
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
      const res = await api.renameLabel(orig, val);
      if (!res.ok) {
        alert(res.message || "이름 변경에 실패했어요.");
        return; // 편집 모드 유지
      }
    }
    await reloadLabels();
    setEditMode(false);
    setEditValues({});
    setFilter("");
    load("");
  };

  const deleteInEdit = async (name) => {
    let count = 0;
    try {
      count = (await api.labelWordCount(name)).count;
    } catch {
      /* 무시 */
    }
    const ok = window.confirm(
      `'${name}' 태그를 삭제하면 이 태그의 단어 ${count}개도 함께 삭제됩니다.\n계속하시겠습니까?`
    );
    if (!ok) return;
    const res = await api.deleteLabel(name);
    if (!res.ok) {
      alert(res.message || "삭제에 실패했어요.");
      return;
    }
    setLabels(res.labels);
    setEditValues((prev) => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    if (filter === name) {
      setFilter("");
      load("");
    }
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
      await load();
    } catch (e) {
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

  const toggleSelectAll = () =>
    setSelected((s) =>
      s.size === words.length ? new Set() : new Set(words.map((w) => w.id))
    );

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
      await load();
    } catch (e) {
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
    setWords(next);
    try {
      await api.reorderWords(next.map((w) => w.id));
    } catch {
      /* 실패해도 화면 순서는 유지; 새로고침하면 서버 순서로 복귀 */
    }
  };

  const allChecked = words.length > 0 && selected.size === words.length;

  return (
    <div>
      {!user && <MemberNotice feature="단어장" onRequireLogin={onRequireLogin} />}

      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-base font-semibold">
          저장된 단어 목록{" "}
          <span className="text-slate-400 font-normal">({words.length}개)</span>
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
            {importing ? "가져오는 중…" : "📥 가져오기"}
          </button>

          {!rowEdit ? (
            <>
              <button
                onClick={enterRowEdit}
                disabled={!user || words.length === 0}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                           px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ✏️ 편집
              </button>
              <button
                onClick={deleteSelected}
                disabled={!user || selected.size === 0}
                className="rounded-lg border border-slate-300 bg-white hover:bg-rose-50
                           hover:text-rose-600 hover:border-rose-200 px-3 py-1.5 text-sm font-medium
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🗑️ 선택 삭제{selected.size ? ` (${selected.size})` : ""}
              </button>
              <button
                onClick={() => load()}
                disabled={!user}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                           px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🔄
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
                {savingAll ? "저장 중…" : "💾 저장"}
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

        {/* 태그 편집/확인 버튼 (회원만, 단어 일괄편집 중엔 숨김) */}
        {user && !rowEdit &&
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

      {rowEdit && (
        <p className="text-[11px] text-slate-400 -mt-2 mb-3">
          모든 행을 한 번에 편집 중이에요. 영어단어·한국어는 고정이고, 한국어 상세·영어뜻·예문·태그·복습일을 고친 뒤 '저장'을 누르세요.
        </p>
      )}
      {!rowEdit && canReorder && words.length > 1 && (
        <p className="text-[11px] text-slate-400 -mt-2 mb-3">
          맨 앞 ⠿ 손잡이를 드래그해 순서를 바꿀 수 있어요(자동 저장). 체크박스로 여러 개를 골라 '선택 삭제'할 수 있어요.
        </p>
      )}

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
                  title="전체 선택"
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
                  {!user
                    ? "로그인하면 저장한 단어를 태그별로 모아볼 수 있어요."
                    : filter
                    ? `'${filter}' 태그의 단어가 없어요.`
                    : "저장된 단어가 없어요. 단어 검색 탭에서 저장하거나 CSV를 가져와보세요!"}
                </td>
              </tr>
            )}
            {words.map((w, i) => {
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
                    ⠿
                  </td>
                  <td className="px-3 py-2 font-medium">{w.word}</td>
                  <td className="px-3 py-2">{w.korean}</td>

                  {/* 한국어 상세 */}
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
                      w.korean_detail || "—"
                    )}
                  </td>

                  {/* 영어뜻 */}
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

                  {/* 예문 */}
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

                  {/* 태그 */}
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
                      <span className="text-slate-300">—</span>
                    )}
                  </td>

                  {/* 등록일 (고정) */}
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                    {String(w.created_at).slice(0, 10)}
                  </td>

                  {/* 다음 복습일 */}
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
    </div>
  );
}
