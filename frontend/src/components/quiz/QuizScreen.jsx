import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const DIFFICULTY_LABELS = {
  easy: "기초",
  medium: "응용",
  hard: "심화",
  challenge: "도전",
};

const STATUS_LABELS = {
  correct: "정답",
  partial: "부분 정답",
  incorrect: "오답",
};

const CHOICE_IDS = ["A", "B", "C", "D"];

function normalizeQuestionType(type) {
  if (type === "grammar_blank_choice") {
    return "context_choice";
  }
  return type;
}

const TYPE_LABELS = {
  meaning_choice: "뜻/단어",
  context_choice: "문맥 빈칸",
  short_answer: "단답형",
  sentence_answer: "문장형",
};

function questionTypeLabel(type) {
  const normalized = normalizeQuestionType(type);
  return TYPE_LABELS[normalized] || normalized;
}

export default function QuizScreen({
  questions,
  answers,
  chooseAnswer,
  typeTextAnswer,
  gradeResult,
  resultByQuestion,
  onGrade,
  gradeLoading,
}) {
  const answeredCount = Object.keys(answers).length;
  const progressPercent = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;

  return (
    <div className="space-y-5 select-none">
      {/* 상단 프로그레스 바 */}
      <Card className="shadow-[0_2px_10px_rgba(0,0,0,0.02)] border-slate-100/80 rounded-2xl p-4">
        <div className="flex justify-between items-center text-xs font-bold text-slate-500 mb-2">
          <span>진행률: {answeredCount} / {questions.length} 문제 완료</span>
          <span className="text-brand-600">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </Card>

      {/* 문제 리스트 */}
      <div className="space-y-4">
        {questions.map((question, index) => {
          const result = resultByQuestion[question.id];
          const answer = answers[question.id] || {};
          const normalizedType = normalizeQuestionType(question.question_type);
          
          const choiceExplanationEntries = result?.choice_explanations
            ? CHOICE_IDS
                .map((choiceId) => [choiceId, result.choice_explanations[choiceId]])
                .filter(([, text]) => Boolean(text))
            : [];

          return (
            <Card
              key={question.id}
              className={`shadow-sm border-slate-100 rounded-2xl overflow-hidden transition-all duration-200 ${
                result
                  ? result.status === "correct"
                    ? "border-emerald-200 ring-2 ring-emerald-50/20"
                    : result.status === "partial"
                      ? "border-amber-200 ring-2 ring-amber-50/20"
                      : "border-rose-200 ring-2 ring-rose-50/20"
                  : "hover:border-slate-200"
              }`}
            >
              <CardContent className="p-5 space-y-3.5">
                {/* 메타 배지 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="bg-slate-100 hover:bg-slate-100 text-slate-600 rounded-full font-bold text-[10px] px-2 py-0.5">
                    {questionTypeLabel(question.question_type)}
                  </Badge>
                  <Badge variant="secondary" className="bg-brand-50 hover:bg-brand-50 text-brand-600 rounded-full font-bold text-[10px] px-2 py-0.5">
                    {DIFFICULTY_LABELS[question.difficulty] || question.difficulty}
                  </Badge>
                  {question.is_derived && (
                    <Badge variant="secondary" className="bg-amber-50 hover:bg-amber-50 text-amber-700 rounded-full font-bold text-[10px] px-2 py-0.5">
                      파생어
                    </Badge>
                  )}
                  {question.is_related && !question.is_derived && (
                    <Badge variant="secondary" className="bg-cyan-50 hover:bg-cyan-50 text-cyan-700 rounded-full font-bold text-[10px] px-2 py-0.5">
                      관련어
                    </Badge>
                  )}
                  
                  {/* 정오답 상태 배지 */}
                  {result && (
                    <Badge
                      className={`ml-auto rounded-full font-bold text-[10px] px-2 py-0.5 ${
                        result.status === "correct"
                          ? "bg-emerald-500 hover:bg-emerald-500 text-white"
                          : result.status === "partial"
                            ? "bg-amber-500 hover:bg-amber-500 text-white"
                            : "bg-rose-500 hover:bg-rose-500 text-white"
                      }`}
                    >
                      {STATUS_LABELS[result.status] || result.status}
                    </Badge>
                  )}
                </div>

                {/* 질문 문장 */}
                <div className="space-y-2">
                  <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100 leading-relaxed">
                    {index + 1}. {question.prompt}
                  </p>
                  
                  {question.passage && (
                    <div className="rounded-xl bg-slate-50/70 border border-slate-100/70 p-3.5 text-xs text-slate-600 dark:bg-slate-900 leading-relaxed font-medium">
                      <span className="font-bold text-slate-400 block text-[9px] uppercase mb-1">Passage (지문/예문)</span>
                      {question.passage}
                    </div>
                  )}
                </div>

                {/* 답안 입력부 (객관식 vs 주관식) */}
                {question.answer_format === "choice" ? (
                  <div className="grid gap-2 sm:grid-cols-2 pt-1.5">
                    {question.choices.map((choice) => {
                      const isSelected = answer.choice_id === choice.id;
                      const isCorrectChoice = result?.correct_choice_id === choice.id;
                      const isWrongSelected = result && isSelected && !isCorrectChoice;
                      
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => chooseAnswer(question.id, choice.id)}
                          disabled={Boolean(gradeResult)}
                          className={`min-h-10 px-3.5 py-2.5 rounded-xl border text-left text-xs font-semibold transition-all duration-200 ${
                            isSelected
                              ? "border-brand-500 bg-brand-50 text-brand-800 shadow-sm"
                              : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                          } ${
                            isCorrectChoice
                              ? "border-emerald-500 bg-emerald-50/80 text-emerald-800"
                              : ""
                          } ${
                            isWrongSelected
                              ? "border-rose-500 bg-rose-50/80 text-rose-800 animate-shake"
                              : ""
                          } disabled:cursor-default disabled:hover:bg-white`}
                        >
                          <span className="font-bold text-brand-500 mr-1.5">{choice.id}.</span>
                          <span>{choice.text}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="pt-1.5">
                    <Textarea
                      rows={normalizedType === "sentence_answer" ? 3 : 2}
                      value={answer.text_answer || ""}
                      onChange={(e) => typeTextAnswer(question.id, e.target.value)}
                      disabled={Boolean(gradeResult)}
                      placeholder={
                        normalizedType === "sentence_answer"
                          ? "영어 완전한 문장으로 해석/답변을 작성하세요."
                          : "정답을 직접 작성하세요."
                      }
                      className="rounded-xl border-slate-200 focus-visible:ring-brand-500 text-xs leading-relaxed"
                    />
                  </div>
                )}

                {/* 해설 및 결과 상세 정보 */}
                {result && (
                  <div className="mt-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 p-4 text-xs text-slate-600 dark:text-slate-400 space-y-2.5 animate-fadeIn">
                    {result.correct_text && (
                      <div className="space-y-1">
                        <span className="font-bold text-slate-400 block text-[9px] uppercase">정답</span>
                        <p className="font-semibold text-slate-800 dark:text-slate-200">
                          {result.correct_choice_id ? `${result.correct_choice_id}. ` : ""}{result.correct_text}
                        </p>
                        {(result.answer_explanation || result.explanation) && (
                          <p className="text-slate-500 leading-relaxed pt-0.5">
                            💡 {result.answer_explanation || result.explanation}
                          </p>
                        )}
                      </div>
                    )}
                    
                    {!result.correct_text && result.acceptable_answers?.length > 0 && (
                      <div className="space-y-1">
                        <span className="font-bold text-slate-400 block text-[9px] uppercase">허용 정답 범위</span>
                        <p className="font-semibold text-slate-800 dark:text-slate-200">
                          {result.acceptable_answers.join(" | ")}
                        </p>
                        {result.explanation && (
                          <p className="text-slate-500 leading-relaxed pt-0.5">
                            💡 {result.explanation}
                          </p>
                        )}
                      </div>
                    )}

                    {choiceExplanationEntries.length > 0 && (
                      <div className="space-y-1.5 pt-1.5 border-t border-slate-100/60 mt-1">
                        <span className="font-bold text-slate-400 block text-[9px] uppercase">선택지 상세 분석</span>
                        <ul className="space-y-1 pl-1">
                          {choiceExplanationEntries.map(([choiceId, text]) => (
                            <li key={choiceId} className="flex gap-1.5">
                              <span className="font-bold text-brand-600">{choiceId}</span>
                              <span className="text-slate-500 leading-relaxed">{text}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {result.study_note && (
                      <div className="pt-1.5 border-t border-slate-100/60 mt-1">
                        <span className="font-bold text-brand-500 block text-[9px] uppercase mb-1">📖 핵심 오답 가이드 & 팁</span>
                        <p className="text-indigo-600 font-semibold bg-indigo-50/30 p-2 rounded-lg leading-relaxed">
                          {result.study_note}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 채점 제출 버튼 */}
      {!gradeResult && questions.length > 0 && (
        <div className="pt-2">
          <Button
            onClick={onGrade}
            disabled={answeredCount === 0 || gradeLoading}
            className="w-full h-11 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold shadow hover:shadow-md flex justify-center items-center gap-2"
          >
            {gradeLoading ? "제출 및 채점 중..." : "✍️ 답안 제출하고 채점하기"}
          </Button>
        </div>
      )}
    </div>
  );
}
