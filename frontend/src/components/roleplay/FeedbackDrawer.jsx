import { Check, Plus, Tag, HelpCircle, FileText, CheckCircle2, Bookmark, Star, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function FeedbackDrawer({
  summary,
  pickedVocab,
  setPickedVocab,
  saveTag,
  setSaveTag,
  labels,
  onSaveVocab,
  savedCount,
  onClose,
}) {
  if (!summary) return null;

  const handleToggleVocab = (index) => {
    setPickedVocab((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const vocabList = summary.vocab || [];
  const expressionsList = summary.expressions || [];

  return (
    <Card className="shadow-[0_8px_30px_rgba(0,0,0,0.04)] border-0 bg-[#e1fbf2] dark:bg-emerald-950/20 text-[#0f5132] rounded-[24px] overflow-hidden mt-6 animate-fadeIn select-none">
      {/* ref/image copy 2.png 별 데코 및 피드백 헤더 이식 */}
      <CardHeader className="p-5 pb-2 flex flex-col items-center border-b border-[#bbf7e3]/50">
        <div className="flex gap-1 mb-2.5">
          <Star className="h-5 w-5 text-emerald-500 fill-emerald-400" />
          <Star className="h-7 w-7 text-emerald-500 fill-emerald-400 -mt-1.5" />
          <Star className="h-5 w-5 text-emerald-500 fill-emerald-400" />
        </div>
        
        <h3 className="text-lg font-black tracking-tight text-emerald-900 dark:text-emerald-100">Perfect!</h3>
        <p className="text-[11px] font-bold text-emerald-700/80 mt-0.5">원어민 AI의 실시간 회화 성취 보고서</p>
      </CardHeader>
      
      <CardContent className="p-5 space-y-5">
        {/* 대화 총평 */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-black text-emerald-800/60 uppercase tracking-widest block">종합 피드백</span>
          <p className="text-xs text-emerald-900 leading-relaxed font-semibold bg-white/40 p-3.5 rounded-[20px]">
            {summary.summary || "대화 내용을 기반으로 피드백을 산출하는 데 실패했습니다."}
          </p>
        </div>

        {/* 유용한 표현 */}
        {expressionsList.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-black text-emerald-800/60 uppercase tracking-widest block">추천/유용한 표현</span>
            <div className="space-y-2">
              {expressionsList.map((expr, index) => (
                <div key={index} className="text-xs bg-white/40 p-3.5 rounded-[18px] space-y-1 font-semibold text-emerald-950">
                  <p className="font-extrabold text-emerald-900 leading-relaxed flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full shrink-0" />
                    {expr.expression}
                  </p>
                  <p className="text-emerald-700/80 leading-relaxed text-[11px] pl-3">{expr.meaning}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 핵심 어휘 저장 */}
        {vocabList.length > 0 && (
          <div className="space-y-3.5 pt-1.5 border-t border-[#bbf7e3]/40 mt-1">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-emerald-800/60 uppercase tracking-widest block">추천 어휘 (단어장 저장)</span>
              {savedCount !== null && (
                <span className="text-[10px] font-extrabold text-[#0f5132] bg-white/50 px-2 py-0.5 rounded-full">
                  ✅ {savedCount}개 저장 완료!
                </span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {vocabList.map((vocab, index) => {
                const isChecked = pickedVocab.has(index);
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleToggleVocab(index)}
                    className={`flex items-center gap-2.5 p-3 rounded-[16px] border text-left text-xs transition-all duration-200 ${
                      isChecked
                        ? "border-emerald-500 bg-white/70 text-emerald-950 shadow-sm"
                        : "border-[#bbf7e3]/40 bg-white/20 text-emerald-800/80 hover:bg-white/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}} // 부모 div 클릭으로 처리
                      className="rounded border-[#bbf7e3] text-emerald-600 h-3.5 w-3.5"
                    />
                    <div className="min-w-0 font-semibold">
                      <p className="font-extrabold truncate text-emerald-900">{vocab.suggested_word}</p>
                      <p className="text-[10px] text-emerald-700/70 truncate mt-0.5">{vocab.suggested_korean}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 일괄 저장 설정 */}
            <div className="flex flex-col sm:flex-row gap-2.5 items-center bg-white/30 p-3 rounded-[18px] border border-[#bbf7e3]/30">
              <select
                value={saveTag}
                onChange={(e) => setSaveTag(e.target.value)}
                className="h-9.5 rounded-xl border border-[#bbf7e3]/30 bg-white/80 px-3 text-xs font-semibold text-emerald-900 outline-none w-full sm:w-44"
              >
                <option value="">🏷️ 태그 선택 (기본: 미지정)</option>
                {labels.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              
              <Button
                onClick={onSaveVocab}
                disabled={pickedVocab.size === 0}
                className="w-full sm:w-auto h-9.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-xs font-bold shadow"
              >
                선택 어휘 저장하기 ({pickedVocab.size}개)
              </Button>
            </div>
          </div>
        )}

        <div className="pt-2">
          <Button
            onClick={onClose}
            className="w-full h-10.5 bg-white/60 hover:bg-white/80 text-emerald-900 rounded-full text-xs font-bold border border-[#bbf7e3]/50 shadow-sm"
          >
            대화로 돌아가기 &rarr;
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
