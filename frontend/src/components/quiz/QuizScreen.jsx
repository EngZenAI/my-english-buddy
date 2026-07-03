import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookPlus,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardList,
  Flag,
  Star,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

const TYPE_LABELS = {
  meaning_choice: "뜻/단어",
  context_choice: "문맥 빈칸",
  short_answer: "단답형",
  sentence_answer: "문장형",
};

const CHOICE_IDS = ["A", "B", "C", "D"];

function normalizeQuestionType(type) {
  if (type === "grammar_blank_choice") return "context_choice";
  return type;
}

function questionTypeLabel(type) {
  return TYPE_LABELS[normalizeQuestionType(type)] || type;
}

function hasAnswer(answer) {
  return Boolean(answer?.choice_id) || Boolean((answer?.text_answer || "").trim());
}

function resultTone(status) {
  if (status === "correct") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "partial") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "incorrect") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-white text-slate-600";
}

function QuestionList({ questions, answers, resultByQuestion, currentIndex, onSelect }) {
  return (
    <aside className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
        <div>
          <h3 className="text-sm font-black text-slate-950">문제 목록</h3>
          <p className="mt-1 text-xs font-medium text-slate-500">번호를 눌러 이동합니다.</p>
        </div>
        <ClipboardList className="h-4.5 w-4.5 text-slate-500" />
      </div>

      <div className="space-y-1 p-3">
        {questions.map((question, index) => {
          const answer = answers[question.id] || {};
          const result = resultByQuestion[question.id];
          const active = currentIndex === index;
          const answered = hasAnswer(answer);
          const status = result?.status;

          return (
            <button
              key={question.id}
              type="button"
              onClick={() => onSelect(index)}
              className={cn(
                "grid w-full grid-cols-[28px_1fr_auto] items-center gap-3 rounded-md px-3 py-2.5 text-left transition",
                active ? "bg-[#f6edd8]" : "hover:bg-slate-50",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-black",
                  active && "bg-amber-500 text-white",
                  !active && !result && answered && "bg-[#14532d] text-white",
                  !active && !result && !answered && "bg-slate-100 text-slate-500",
                  status === "correct" && "bg-[#14532d] text-white",
                  status === "partial" && "bg-amber-500 text-white",
                  status === "incorrect" && "bg-rose-600 text-white",
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-extrabold text-slate-800">
                  {questionTypeLabel(question.question_type)}
                </span>
                <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
                  {status ? STATUS_LABELS[status] || status : answered ? "답변 완료" : active ? "현재" : "미답"}
                </span>
              </span>
              {status === "correct" ? (
                <Check className="h-4 w-4 text-[#14532d]" />
              ) : status === "incorrect" ? (
                <XCircle className="h-4 w-4 text-rose-600" />
              ) : answered ? (
                <CircleDot className="h-4 w-4 text-[#14532d]" />
              ) : (
                <Circle className="h-4 w-4 text-slate-300" />
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4 text-xs font-bold text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#14532d]" />
          정답/완료
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-rose-600" />
          오답
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-amber-500" />
          현재
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full border border-slate-300" />
          미답
        </span>
      </div>
    </aside>
  );
}

function ResultExplanation({ result }) {
  const choiceExplanationEntries = result.choice_explanations
    ? CHOICE_IDS.map((choiceId) => [choiceId, result.choice_explanations[choiceId]]).filter(
        ([, text]) => Boolean(text),
      )
    : [];

  return (
    <div className={cn("space-y-3 rounded-md border p-4", resultTone(result.status))}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("rounded-md border px-2 py-1 text-xs font-black", resultTone(result.status))}>
          {STATUS_LABELS[result.status] || result.status}
        </Badge>
        {(result.correct_text || result.acceptable_answers?.length > 0) && (
          <p className="text-sm font-black text-slate-950">
            정답: {result.correct_choice_id ? `${result.correct_choice_id}. ` : ""}
            {result.correct_text || result.acceptable_answers.join(" | ")}
          </p>
        )}
      </div>
      {(result.answer_explanation || result.explanation) && (
        <p className="text-sm font-medium leading-7 text-slate-700">
          {result.answer_explanation || result.explanation}
        </p>
      )}
      {choiceExplanationEntries.length > 0 && (
        <div className="space-y-1.5 border-t border-current/10 pt-3">
          <p className="text-xs font-black text-slate-700">선택지 상세</p>
          {choiceExplanationEntries.map(([choiceId, text]) => (
            <p key={choiceId} className="text-xs font-medium leading-6 text-slate-600">
              <span className="font-black text-slate-900">{choiceId}.</span> {text}
            </p>
          ))}
        </div>
      )}
      {result.study_note && (
        <div className="rounded-md bg-white/70 p-3 text-sm font-semibold leading-7 text-slate-700">
          {result.study_note}
        </div>
      )}
    </div>
  );
}

function SuggestedWordbookSection({ results, onSaveSuggestedWord, savingWord, savedWords }) {
  const items = (results || []).filter((item) => item.can_add_to_wordbook && item.suggested_word);
  if (!items.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <BookPlus className="h-4.5 w-4.5 text-[#0f766e]" />
        <h3 className="text-sm font-black text-slate-950">단어장에 추가</h3>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const word = item.suggested_word;
          const saved = savedWords?.has(word);
          return (
            <div
              key={`${item.question_id}-${word}`}
              className="grid gap-3 rounded-md bg-slate-50/80 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{word}</p>
                <p className="mt-0.5 truncate text-xs font-medium text-slate-600">
                  {item.suggested_korean || item.target_word || "추가 추천 단어"}
                </p>
              </div>
              <Button
                type="button"
                variant={saved ? "outline" : "default"}
                disabled={saved || savingWord === word}
                onClick={() => onSaveSuggestedWord?.(item)}
                className={cn(
                  "h-9 rounded-md px-4 text-xs font-black",
                  saved
                    ? "border-slate-200 text-slate-500"
                    : "bg-[#0f766e] text-white hover:bg-[#0b5f59]",
                )}
              >
                {saved ? "추가됨" : savingWord === word ? "추가 중..." : "추가"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function QuizScreen({
  questions,
  answers,
  chooseAnswer,
  typeTextAnswer,
  gradeResult,
  resultByQuestion,
  currentIndex = 0,
  setCurrentIndex,
  onGrade,
  gradeLoading,
  onResetQuiz,
  onSaveSuggestedWord,
  savingSuggestedWord = "",
  savedSuggestedWords,
}) {
  const [localIndex, setLocalIndex] = useState(currentIndex || 0);
  const activeIndex = setCurrentIndex ? currentIndex : localIndex;
  const safeIndex = Math.min(Math.max(activeIndex || 0, 0), Math.max(questions.length - 1, 0));
  const question = questions[safeIndex];
  const answer = question ? answers[question.id] || {} : {};
  const result = question ? resultByQuestion[question.id] : null;
  const normalizedType = question ? normalizeQuestionType(question.question_type) : "";
  const answeredCount = questions.filter((item) => hasAnswer(answers[item.id])).length;
  const progressPercent = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex < questions.length - 1;
  const isLastQuestion = safeIndex === questions.length - 1;
  const canSubmit = answeredCount > 0 && !gradeResult;

  const setIndex = (value) => {
    const nextIndex =
      typeof value === "function" ? value(safeIndex) : value;
    const bounded = Math.min(Math.max(nextIndex, 0), Math.max(questions.length - 1, 0));
    if (setCurrentIndex) setCurrentIndex(bounded);
    else setLocalIndex(bounded);
  };

  useEffect(() => {
    if (safeIndex !== activeIndex) setIndex(safeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions.length]);

  const stars = useMemo(() => {
    const difficulty = question?.difficulty;
    const count = difficulty === "easy" ? 2 : difficulty === "medium" ? 3 : difficulty === "hard" ? 4 : 5;
    return Array.from({ length: 5 }, (_, index) => index < count);
  }, [question?.difficulty]);

  if (!question) return null;

  return (
    <div className="animate-fadeIn grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <main className="min-w-0 space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="text-lg font-black text-slate-950">
                문제 <span className="text-2xl">{safeIndex + 1}</span> / {questions.length}
              </h2>
              <Progress value={progressPercent} className="h-2 w-48 bg-slate-200 [&>div]:bg-[#14532d]" />
              <span className="text-sm font-bold text-slate-600">{progressPercent}%</span>
            </div>
            {gradeResult && (
              <Button
                type="button"
                onClick={onResetQuiz}
                className="h-10 rounded-md bg-[#064e1f] px-5 text-sm font-black text-white hover:bg-[#053f19]"
              >
                <Flag className="h-4 w-4" />
                새 퀴즈 만들기
              </Button>
            )}
          </div>

          <CardContent className="p-6 lg:p-8">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="rounded-full bg-[#14532d] px-4 py-1.5 text-xs font-black text-white hover:bg-[#14532d]">
                  {questionTypeLabel(question.question_type)}
                </Badge>
                <span className="text-sm font-bold text-slate-600">난이도</span>
                <span className="flex items-center gap-0.5">
                  {stars.map((active, index) => (
                    <Star
                      key={index}
                      className={cn(
                        "h-4 w-4",
                        active ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200",
                      )}
                    />
                  ))}
                </span>
                <span className="text-xs font-bold text-slate-500">
                  {DIFFICULTY_LABELS[question.difficulty] || question.difficulty}
                </span>
              </div>
            </div>

            <div className="space-y-5">
              <h3 className="text-lg font-black leading-8 text-slate-950">
                {question.prompt}
              </h3>
              {question.passage && (
                <div className="border-y border-slate-200 py-5">
                  <p className="font-serif text-xl leading-10 text-slate-950">
                    {question.passage}
                  </p>
                </div>
              )}

              {question.answer_format === "choice" ? (
                <div className="space-y-3">
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
                        className={cn(
                          "grid min-h-14 w-full grid-cols-[36px_1fr_auto] items-center gap-3 rounded-md border px-4 py-3 text-left transition",
                          "border-slate-200 bg-white text-slate-900 hover:border-[#14532d] hover:bg-[#f7faf5]",
                          isSelected && "border-[#14532d] bg-[#f3fbf6] ring-1 ring-[#14532d]/20",
                          isCorrectChoice && "border-emerald-500 bg-emerald-50",
                          isWrongSelected && "border-rose-500 bg-rose-50 animate-shake",
                          Boolean(gradeResult) && "cursor-default",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-black",
                            isSelected
                              ? "border-[#14532d] bg-[#14532d] text-white"
                              : "border-slate-300 bg-white text-slate-700",
                            isWrongSelected && "border-rose-600 bg-rose-600",
                            isCorrectChoice && "border-emerald-600 bg-emerald-600",
                          )}
                        >
                          {choice.id}
                        </span>
                        <span className="text-base font-semibold">{choice.text}</span>
                        {isCorrectChoice ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        ) : isWrongSelected ? (
                          <XCircle className="h-5 w-5 text-rose-600" />
                        ) : isSelected ? (
                          <Check className="h-5 w-5 text-[#14532d]" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Textarea
                  rows={normalizedType === "sentence_answer" ? 5 : 3}
                  value={answer.text_answer || ""}
                  onChange={(event) => typeTextAnswer(question.id, event.target.value)}
                  disabled={Boolean(gradeResult)}
                  placeholder={
                    normalizedType === "sentence_answer"
                      ? "영어 문장으로 답변을 작성하세요."
                      : "정답을 직접 작성하세요."
                  }
                  className="rounded-md border-slate-200 text-base leading-7 focus-visible:ring-[#14532d] disabled:bg-white disabled:opacity-100"
                />
              )}
            </div>

            {result && (
              <div className="mt-8 rounded-md border border-slate-200 bg-slate-50/70 p-4">
                <ResultExplanation result={result} />
              </div>
            )}

            {gradeResult && (
              <div className="mt-6">
                <SuggestedWordbookSection
                  results={gradeResult.results}
                  onSaveSuggestedWord={onSaveSuggestedWord}
                  savingWord={savingSuggestedWord}
                  savedWords={savedSuggestedWords}
                />
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={!canGoPrev}
                onClick={() => setIndex((value) => value - 1)}
                className="h-12 rounded-md border-slate-300 px-6 text-base font-black"
              >
                <ArrowLeft className="h-4 w-4" />
                이전 문제
              </Button>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                {!gradeResult && isLastQuestion ? (
                  <Button
                    type="button"
                    onClick={onGrade}
                    disabled={!canSubmit || gradeLoading}
                    className="h-12 rounded-md bg-[#064e1f] px-10 text-base font-black text-white hover:bg-[#053f19] disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    <Flag className="h-4 w-4" />
                    {gradeLoading ? "채점 중..." : "답안 제출"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant={gradeResult ? "outline" : "default"}
                    disabled={!canGoNext}
                    onClick={() => setIndex((value) => value + 1)}
                    className={cn(
                      "h-12 rounded-md px-8 text-base font-black",
                      gradeResult
                        ? "border-slate-300"
                        : "bg-[#064e1f] text-white hover:bg-[#053f19]",
                    )}
                  >
                    다음 문제
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </div>
      </main>

      <QuestionList
        questions={questions}
        answers={answers}
        resultByQuestion={resultByQuestion}
        currentIndex={safeIndex}
        onSelect={setIndex}
      />
    </div>
  );
}
