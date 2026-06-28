import { GripVertical, ChevronDown, ChevronUp, Eye, EyeOff, Volume2 } from "lucide-react";
import AudioButton from "@/components/AudioButton";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

export default function WordCard({
  w,
  idx,
  checked,
  rowEdit,
  d,
  exExpanded,
  meaningShown,
  hasMeaning,
  canReorder,
  dragIndex,
  setDragIndex,
  onDrop,
  setDraftField,
  toggleMeaning,
  toggleExpandedEx,
  handleSelectClick,
  labels,
  reviewPreview,
}) {
  return (
    <div
      draggable={canReorder}
      onDragStart={canReorder ? () => setDragIndex(idx) : undefined}
      onDragOver={canReorder ? (e) => e.preventDefault() : undefined}
      onDrop={canReorder ? () => onDrop(idx) : undefined}
      className={`group relative rounded-2xl border bg-card p-4.5 transition-all duration-200 shadow-sm hover:shadow-md ${
        checked
          ? "border-rose-400 ring-2 ring-rose-50 dark:ring-rose-950/20"
          : "border-slate-100 hover:border-slate-200"
      } ${dragIndex === idx ? "opacity-40" : ""}`}
    >
      {rowEdit ? (
        /* ───────────────────────────────────────────────────────────────────────── */
        /* A. 단어 일괄 편집 모드 카드                                                */
        /* ───────────────────────────────────────────────────────────────────────── */
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase">영어 단어</span>
              <Input
                value={d.word ?? ""}
                onChange={(e) => setDraftField(w.id, "word", e.target.value)}
                className="h-8.5 text-xs font-semibold"
              />
            </div>
            <div className="flex-1 space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase">한국어 기본</span>
              <Input
                value={d.korean ?? ""}
                onChange={(e) => setDraftField(w.id, "korean", e.target.value)}
                className="h-8.5 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">한국어 상세</span>
            <Textarea
              value={d.korean_detail ?? ""}
              onChange={(e) => setDraftField(w.id, "korean_detail", e.target.value)}
              rows={2}
              className="text-xs p-2 min-h-12 resize-none"
            />
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">영어 사전적 정의</span>
            <Textarea
              value={d.english_def ?? ""}
              onChange={(e) => setDraftField(w.id, "english_def", e.target.value)}
              rows={2}
              className="text-xs p-2 min-h-12 resize-none"
            />
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">예문</span>
            <Textarea
              value={d.example ?? ""}
              onChange={(e) => setDraftField(w.id, "example", e.target.value)}
              rows={2}
              className="text-xs p-2 min-h-12 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-50 mt-1">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase">태그</span>
              <select
                value={d.tag ?? "미지정"}
                onChange={(e) => setDraftField(w.id, "tag", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-background px-2 py-1 text-xs outline-none h-8"
              >
                {labels.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase">다음 복습 주기</span>
              <select
                value={d.next_review ?? ""}
                onChange={(e) => setDraftField(w.id, "next_review", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-background px-2 py-1 text-xs outline-none h-8"
              >
                <option value="">변경 안 함</option>
                <option value="1d">1일 뒤 ({reviewPreview("1d")})</option>
                <option value="1w">1주일 뒤 ({reviewPreview("1w")})</option>
                <option value="1m">1달 뒤 ({reviewPreview("1m")})</option>
                <option value="3m">3달 뒤 ({reviewPreview("3m")})</option>
              </select>
            </div>
          </div>
        </div>
      ) : (
        /* ───────────────────────────────────────────────────────────────────────── */
        /* B. 단어 조회 모드 카드 (뷰 모드)                                           */
        /* ───────────────────────────────────────────────────────────────────────── */
        <div className="space-y-3">
          {/* 드래그 손잡이 및 상단 액션바 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => handleSelectClick(e, idx, w.id)}
                className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 h-3.5 w-3.5 cursor-pointer"
              />
              
              {w.tag && w.tag !== "미지정" && (
                <Badge variant="secondary" className="bg-brand-50 text-brand-600 hover:bg-brand-50 text-[10px] px-2 py-0.5 rounded-full font-semibold">
                  🏷️ {w.tag}
                </Badge>
              )}
            </div>

            {canReorder && (
              <div 
                className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 rounded"
                title="순서 드래그 정렬"
              >
                <GripVertical className="h-4 w-4" />
              </div>
            )}
          </div>

          {/* 단어 헤더 */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-base font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">
                {w.word}
              </h4>
              <div className="h-6 flex items-center">
                <AudioButton word={w.word} lang="en" />
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {w.phonetic ? `[${w.phonetic}]` : ""}
            </p>
          </div>

          {/* 뜻 정보 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {meaningShown ? w.korean : "••••••"}
              </span>
              {hasMeaning && (
                <button
                  type="button"
                  onClick={() => toggleMeaning(w.id)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                  title={meaningShown ? "뜻 가리기" : "뜻 보기"}
                >
                  {meaningShown ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>

            {meaningShown && hasMeaning && (
              <div className="mt-2 text-xs text-slate-500 leading-relaxed bg-slate-50/50 p-2.5 rounded-xl border border-slate-100/50 space-y-1.5 animate-fadeIn">
                {w.korean_detail && (
                  <div>
                    <span className="font-bold text-slate-400 block text-[9px] uppercase">상세 뜻</span>
                    <span>{w.korean_detail}</span>
                  </div>
                )}
                {w.english_def && (
                  <div>
                    <span className="font-bold text-slate-400 block text-[9px] uppercase">영어 정의</span>
                    <span>{w.english_def}</span>
                  </div>
                )}
                {w.slang_def && (
                  <div className="text-indigo-500 bg-indigo-50/50 px-2 py-1 rounded-lg text-[11px] mt-1">
                    <span className="font-bold block text-[8px] uppercase">AI 추가 설명</span>
                    {w.slang_def}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 예문 및 상세 */}
          {w.example && (
            <div className="border-t border-slate-50 pt-2">
              <button
                type="button"
                onClick={() => toggleExpandedEx(w.id)}
                className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-slate-600"
              >
                <span>예문 보기</span>
                {exExpanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>

              {exExpanded && (
                <p className="mt-1.5 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap animate-fadeIn bg-slate-50/20 p-2 border border-slate-100 rounded-lg">
                  {w.example}
                </p>
              )}
            </div>
          )}

          {/* 하단 메타 정보 (복습일 등) */}
          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-50/60">
            <span>
              복습: {w.next_review ? w.next_review.slice(2, 10) : "미정"}
            </span>
            <span className="text-[9px]">
              생성: {w.created_at ? w.created_at.slice(2, 10) : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
