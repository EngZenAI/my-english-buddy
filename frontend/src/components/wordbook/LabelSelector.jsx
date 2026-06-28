import { useState } from "react";
import { Edit2, Plus, Check, X, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

export default function LabelSelector({
  labels,
  filter,
  onSelectFilter,
  user,
  rowEdit,
  editMode,
  onEnterEdit,
  onCancelEdit,
  onCommitEdits,
  editValues,
  setEditValues,
  newLabel,
  setNewLabel,
  onAddLabel,
  onDeleteLabel,
  labelError,
  estLabelWidth,
}) {
  return (
    <div className="space-y-3 select-none">
      {/* 모바일 횡스크롤 및 PC 목록을 반응형으로 분기 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            태그 필터
          </label>
          
          {user && !rowEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={editMode ? onCancelEdit : onEnterEdit}
              className="h-8 text-xs text-slate-500 hover:text-brand-600 gap-1 rounded-lg px-2"
            >
              {editMode ? (
                <>
                  <X className="h-3.5 w-3.5" />
                  편집 취소
                </>
              ) : (
                <>
                  <Edit2 className="h-3.5 w-3.5" />
                  태그 관리
                </>
              )}
            </Button>
          )}
        </div>

        {/* 1. 모바일 뷰: 횡스크롤 필터 (md 미만) */}
        <div className="block md:hidden">
          <ScrollArea className="w-full whitespace-nowrap pb-2">
            <div className="flex gap-1.5 py-0.5">
              {!editMode && (
                <button
                  onClick={() => onSelectFilter("")}
                  className={`rounded-full text-xs font-semibold px-4 h-8 border transition-all duration-200 ${
                    filter === ""
                      ? "bg-brand-600 text-white border-brand-600 shadow-sm"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900"
                  }`}
                >
                  전체
                </button>
              )}

              {labels.map((name) => {
                if (!editMode) {
                  const isActive = filter === name;
                  return (
                    <button
                      key={name}
                      onClick={() => onSelectFilter(name)}
                      className={`rounded-full text-xs font-medium px-4.5 h-8 border transition-all duration-200 ${
                        isActive
                          ? "bg-brand-600 text-white border-brand-600 shadow-sm"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900"
                      }`}
                    >
                      {name}
                    </button>
                  );
                }

                if (name === "미지정") {
                  return (
                    <span
                      key={name}
                      className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-medium px-4 h-8"
                      title="기본 태그 - 변경 불가"
                    >
                      미지정
                    </span>
                  );
                }

                const val = editValues[name] ?? name;
                return (
                  <span
                    key={name}
                    className="inline-flex items-center rounded-full border border-brand-200 bg-white dark:bg-slate-900 h-8 pl-3.5 pr-2 gap-1.5"
                  >
                    <input
                      value={val}
                      onChange={(e) =>
                        setEditValues((v) => ({ ...v, [name]: e.target.value }))
                      }
                      style={{ width: `${estLabelWidth(val)}rem` }}
                      className="text-xs bg-transparent outline-none font-medium text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => onDeleteLabel(name)}
                      className="w-4 h-4 rounded-full inline-flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        {/* 2. PC 뷰: 세로형 사이드바 리스트 (md 이상) */}
        <div className="hidden md:flex flex-col gap-1 w-full bg-slate-50/50 dark:bg-slate-900/30 p-2.5 rounded-xl border border-slate-100">
          {!editMode && (
            <button
              onClick={() => onSelectFilter("")}
              className={`w-full text-left rounded-lg text-xs font-semibold px-3 py-2 transition-all ${
                filter === ""
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              전체 보기
            </button>
          )}

          {labels.map((name) => {
            if (!editMode) {
              const isActive = filter === name;
              return (
                <button
                  key={name}
                  onClick={() => onSelectFilter(name)}
                  className={`w-full text-left rounded-lg text-xs font-medium px-3 py-2 transition-all ${
                    isActive
                      ? "bg-brand-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {name}
                </button>
              );
            }

            if (name === "미지정") {
              return (
                <div
                  key={name}
                  className="w-full text-left rounded-lg text-xs font-medium px-3 py-2 text-slate-400 bg-slate-100/50 dark:bg-slate-800/30 cursor-not-allowed"
                >
                  미지정 (기본)
                </div>
              );
            }

            const val = editValues[name] ?? name;
            return (
              <div
                key={name}
                className="w-full flex items-center justify-between rounded-lg border border-brand-100 bg-white dark:bg-slate-900 px-3 py-1.5 gap-2"
              >
                <Input
                  value={val}
                  onChange={(e) =>
                    setEditValues((v) => ({ ...v, [name]: e.target.value }))
                  }
                  className="h-7 text-xs bg-transparent border-none focus-visible:ring-0 p-0"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDeleteLabel(name)}
                  className="h-6 w-6 text-slate-400 hover:text-rose-600 rounded"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 태그 편집 모드 하단 액션바 */}
      {editMode && (
        <div className="p-3 bg-brand-50/50 dark:bg-brand-950/20 border border-brand-100 rounded-xl space-y-2.5">
          {labels.length < 20 && (
            <div className="flex gap-1.5">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="새 태그명"
                className="h-8.5 text-xs rounded-lg border-slate-200"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddLabel();
                  }
                }}
              />
              <Button
                onClick={onAddLabel}
                size="sm"
                className="h-8.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs"
              >
                추가
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={onCommitEdits}
              className="flex-1 h-8.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-sm"
            >
              적용 완료
            </Button>
            <Button
              variant="outline"
              onClick={onCancelEdit}
              className="h-8.5 border-slate-200 text-slate-600 rounded-lg text-xs"
            >
              취소
            </Button>
          </div>

          {labelError && (
            <p className="text-[11px] text-rose-500 font-medium pl-1">{labelError}</p>
          )}
        </div>
      )}
    </div>
  );
}
