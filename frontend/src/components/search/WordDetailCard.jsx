import { Check, Plus, Tag, HelpCircle, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export default function WordDetailCard({
  engDef,
  korDetail,
  customExample,
  setCustomExample,
  searchLoading,
  saved,
  saveDisabled,
  onSave,
  user,
  labels,
  labelsLoading,
  selectedLabel,
  setSelectedLabel,
  newLabel,
  setNewLabel,
  adding,
  setAdding,
  onAddLabel,
  labelError,
  slangText,
  setSlangText,
}) {
  return (
    <Card className="shadow-[0_4px_20px_rgba(0,0,0,0.04)] border-slate-100 rounded-2xl overflow-hidden flex flex-col h-full">
      <CardHeader className="bg-slate-50/50 border-b border-slate-100 py-3.5 px-5 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <FileText className="h-4.5 w-4.5 text-brand-500" />
          상세 검색 결과
        </CardTitle>

        {/* 저장 버튼 */}
        <Button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          className={`h-9 px-4 rounded-xl text-xs font-semibold shadow-sm transition-all duration-300 ${
            saved
              ? "bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-100 cursor-default"
              : "bg-brand-600 hover:bg-brand-700 text-white hover:shadow"
          }`}
        >
          {saved ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 stroke-[2.5]" />
              저장 완료
            </span>
          ) : (
            "📥 단어장에 저장"
          )}
        </Button>
      </CardHeader>

      <CardContent className="p-5 space-y-5 flex-1 overflow-y-auto">
        {/* 영어 뜻 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 flex items-center gap-1">
            📖 영어 사전적 정의
          </label>
          {searchLoading ? (
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : (
            <div className="w-full rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap min-h-16 leading-relaxed">
              {engDef || "사전 검색 결과를 가져오는 중이거나 결과가 없습니다."}
            </div>
          )}
        </div>

        {/* 한국어 뜻 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 flex items-center gap-1">
            🇰🇷 한국어 번역/해석
          </label>
          {searchLoading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : (
            <div className="w-full rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap min-h-12 leading-relaxed">
              {korDetail || "번역 결과가 없습니다."}
            </div>
          )}
        </div>

        {/* AI 의미 분석 */}
        {slangText && (
          <div className="space-y-1.5 animate-fadeIn">
            <label className="text-xs font-bold text-brand-500 flex items-center gap-1">
              <HelpCircle className="h-3.5 w-3.5" />
              AI 원어민 뉘앙스 & 슬랭 설명
            </label>
            <Textarea
              rows={4}
              value={slangText}
              onChange={(e) => setSlangText(e.target.value)}
              placeholder="AI 설명을 내 입맛에 맞게 편집하여 저장할 수 있어요."
              className="rounded-xl border-slate-200 focus-visible:ring-brand-500 text-sm leading-relaxed p-4 bg-indigo-50/30 text-slate-700 resize-none"
            />
          </div>
        )}

        {/* 편집 가능한 예문 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 flex items-center gap-1">
            ✏️ 예문 (상황에 맞게 직접 편집해보세요)
          </label>
          <Textarea
            rows={3}
            value={customExample}
            onChange={(e) => setCustomExample(e.target.value)}
            placeholder="단어를 외우는 데 도움이 될 나만의 문장을 적어보세요."
            className="rounded-xl border-slate-200 focus-visible:ring-brand-500 text-sm leading-relaxed p-3.5"
          />
        </div>

        {/* 태그 선택 섹션 */}
        {user && (
          <div className="space-y-2 pt-1">
            <label className="text-xs font-bold text-slate-400 flex items-center gap-1">
              <Tag className="h-3.5 w-3.5" />
              태그 (단어장 필터 카테고리)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {labelsLoading ? (
                <>
                  <Skeleton className="h-8 w-16 rounded-full" />
                  <Skeleton className="h-8 w-20 rounded-full" />
                </>
              ) : (
                labels.map((name) => {
                  const active = selectedLabel === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setSelectedLabel(active ? "" : name)}
                      className={`rounded-full text-xs font-medium px-3.5 h-8 border transition-all duration-200 flex items-center gap-1 ${
                        active
                          ? "bg-brand-600 text-white border-brand-600 shadow-sm"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {active && <Check className="h-3 w-3 stroke-[2.5]" />}
                      {name}
                    </button>
                  );
                })
              )}

              {adding ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onAddLabel();
                      if (e.key === "Escape") {
                        setAdding(false);
                        setNewLabel("");
                      }
                    }}
                    placeholder="새 태그명"
                    className="w-24 rounded-full border border-slate-200 px-3 h-8 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <Button
                    type="button"
                    onClick={onAddLabel}
                    size="sm"
                    className="h-8 bg-brand-50 text-brand-600 hover:bg-brand-100 border border-brand-100 rounded-full text-xs font-semibold px-3"
                  >
                    추가
                  </Button>
                </div>
              ) : (
                labels.length < 20 && (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="rounded-full text-xs font-medium px-3 h-8 border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    태그 추가
                  </button>
                )
              )}
            </div>
            {labelError && (
              <p className="text-[11px] text-rose-500 mt-1 pl-1">{labelError}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
