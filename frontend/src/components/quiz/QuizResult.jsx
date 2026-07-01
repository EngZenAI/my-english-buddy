import { Award, Calendar, BookOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const REVIEW_INTERVAL_OPTIONS = [
  { value: "1d", label: "1일 후 복습" },
  { value: "1w", label: "1주일 후 복습" },
  { value: "1m", label: "1개월 후 복습" },
  { value: "3m", label: "3개월 후 복습" },
];

const TYPE_LABELS = {
  meaning_choice: "뜻/단어",
  context_choice: "문맥 빈칸",
  short_answer: "단답형",
  sentence_answer: "문장형",
};

export default function QuizResult({
  gradeResult,
  scoreSummary,
  incorrectReviewWords,
  reviewInterval,
  setReviewInterval,
  onApplyReview,
  applyReviewLoading,
}) {
  if (!gradeResult) return null;

  return (
    <Card className="shadow-[0_4px_20px_rgba(0,0,0,0.03)] border-slate-100/90 rounded-2xl overflow-hidden mt-6 animate-fadeIn select-none">
      <CardHeader className="bg-brand-50/70 dark:bg-brand-900/20 border-b border-brand-100 p-5 flex items-center justify-between flex-row">
        <div>
          <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <Award className="h-5 w-5 text-brand-500 stroke-[2.2]" />
            퀴즈 채점 성적 리포트
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">실시간 인공지능 채점 결과입니다.</CardDescription>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-400 block uppercase">총점</span>
          <span className="text-xl font-black text-brand-600 tracking-tight">{scoreSummary}</span>
        </div>
      </CardHeader>
      
      <CardContent className="p-5 space-y-4">
        {/* 유형별 정답률 통계 뱃지 목록 */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">유형별 정답률</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(gradeResult.type_stats || {}).map(([type, stat]) => (
              <Badge 
                key={type} 
                variant="secondary" 
                className="bg-slate-100 hover:bg-slate-100 text-slate-600 border border-slate-200/50 rounded-lg text-xs font-semibold px-2.5 py-1"
              >
                {TYPE_LABELS[type] || type}: {Math.round((stat.accuracy || 0) * 100)}%
              </Badge>
            ))}
          </div>
        </div>

        {/* 오답 단어 복습일 일괄 설정 기능 */}
        {incorrectReviewWords.length > 0 && (
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4.5 space-y-3.5 mt-2.5">
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-brand-500" />
                틀린 단어 {incorrectReviewWords.length}개 복습 일정 생성
              </h4>
              <p className="text-xs text-slate-400 font-semibold leading-relaxed">
                오답 목록: {incorrectReviewWords.map((item) => item.word).join(", ")}
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
              <select
                value={reviewInterval}
                onChange={(e) => setReviewInterval(e.target.value)}
                disabled={gradeResult.review_schedule_applied || applyReviewLoading}
                className="h-9.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 outline-none hover:border-slate-300 flex-1 disabled:opacity-60"
              >
                {REVIEW_INTERVAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              
              <Button
                onClick={onApplyReview}
                disabled={
                  applyReviewLoading ||
                  gradeResult.review_schedule_applied ||
                  !gradeResult.session_id
                }
                className={`h-9.5 rounded-xl text-xs font-bold px-5 shadow-sm transition-all ${
                  gradeResult.review_schedule_applied
                    ? "bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-100 shadow-none cursor-default"
                    : "bg-brand-600 hover:bg-brand-700 text-white hover:shadow"
                }`}
              >
                {gradeResult.review_schedule_applied ? (
                  <span className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-green-500 stroke-[2.5]" />
                    복습일 예약 완료
                  </span>
                ) : applyReviewLoading ? (
                  "저장 중..."
                ) : (
                  "복습 일정 적용"
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
