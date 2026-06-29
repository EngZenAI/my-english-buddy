import { Settings, Play, Tag, Calendar, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const MODES = [
  { id: "random", label: "무작위 출제" },
  { id: "tag", label: "태그별 출제" },
  { id: "saved_date", label: "저장 기간별" },
];

export default function QuizConfig({
  goal,
  setGoalValue,
  labels,
  onGenerate,
  disabled,
  user,
}) {
  return (
    <Card className="shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-slate-100/80 rounded-2xl overflow-hidden animate-fadeIn">
      <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-5">
        <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <Settings className="h-4.5 w-4.5 text-brand-500" />
          퀴즈 생성 옵션 설정
        </CardTitle>
        <CardDescription className="text-xs pt-0.5">
          원하는 범위와 방식을 지정하면 AI가 맞춤형 어휘 과제를 출제합니다.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="p-5 space-y-4">
        {/* 출제 모드 선택 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400">출제 방식</label>
          <div className="flex flex-wrap gap-2">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setGoalValue("mode", mode.id)}
                className={`h-9.5 px-4 rounded-xl text-xs font-semibold border transition-all ${
                  goal.mode === mode.id
                    ? "border-brand-500 bg-brand-50 text-brand-700 shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {/* 조건부 입력란 */}
        <div className="grid gap-3 sm:grid-cols-2">
          {goal.mode === "tag" && (
            <div className="space-y-1.5 animate-fadeIn">
              <label className="text-xs font-bold text-slate-400 flex items-center gap-1">
                <Tag className="h-3 w-3 text-slate-400" /> 태그 필터
              </label>
              <select
                value={goal.tag}
                onChange={(e) => setGoalValue("tag", e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-background px-3 text-xs font-medium outline-none"
              >
                <option value="">전체 태그</option>
                {labels.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </div>
          )}

          {goal.mode === "saved_date" && (
            <>
              <div className="space-y-1.5 animate-fadeIn">
                <label className="text-xs font-bold text-slate-400 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-slate-400" /> 시작일
                </label>
                <Input
                  type="date"
                  value={goal.saved_from}
                  onChange={(e) => setGoalValue("saved_from", e.target.value)}
                  className="rounded-xl border-slate-200 text-xs"
                />
              </div>
              <div className="space-y-1.5 animate-fadeIn">
                <label className="text-xs font-bold text-slate-400 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-slate-400" /> 종료일
                </label>
                <Input
                  type="date"
                  value={goal.saved_to}
                  onChange={(e) => setGoalValue("saved_to", e.target.value)}
                  className="rounded-xl border-slate-200 text-xs"
                />
              </div>
            </>
          )}
        </div>

        {/* 기본 설정: 문항 수 & 출제 지시 */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-1">
            <label className="text-xs font-bold text-slate-400">문항 개수</label>
            <Input
              type="number"
              min={1}
              max={50}
              value={goal.question_count}
              onChange={(e) => setGoalValue("question_count", Number(e.target.value))}
              className="rounded-xl border-slate-200 text-xs"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-bold text-slate-400 flex items-center gap-1">
              💡 AI 커스텀 지시사항 <span className="text-[10px] text-slate-400 font-normal">(선택)</span>
            </label>
            <Input
              value={goal.instruction}
              onChange={(e) => setGoalValue("instruction", e.target.value)}
              placeholder="예: 토플 레벨, 비즈니스 어휘 위주로 출제해줘"
              className="rounded-xl border-slate-200 text-xs"
            />
          </div>
        </div>

        {/* 퀴즈 생성 실행 버튼 */}
        <div className="pt-2">
          <Button
            onClick={onGenerate}
            disabled={disabled || !user}
            className="w-full h-11 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold shadow hover:shadow-md flex items-center justify-center gap-2"
          >
            <Play className="h-4.5 w-4.5 fill-current" />
            AI 퀴즈 시작하기
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
