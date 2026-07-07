import {
  CalendarDays,
  Check,
  Layers3,
  Loader2,
  Tags,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_QUESTION_TYPE_COUNTS } from "@/components/quiz/quizState";
import { cn } from "@/lib/utils";

const MAX_QUESTION_COUNT = 10;
const QUESTION_TYPE_OPTIONS = [
  {
    key: "meaning_choice",
    label: "뜻/단어 객관식",
    description: "의미와 단어를 고르는 문제",
  },
  {
    key: "context_choice",
    label: "문맥 빈칸 객관식",
    description: "문장 빈칸에 맞는 표현 선택",
  },
  {
    key: "collocation_choice",
    label: "언어/표현",
    description: "자연스러운 단어 조합 선택",
  },
  {
    key: "usage_choice",
    label: "올바른 사용 객관식",
    description: "문장 속 자연스러운 쓰임 선택",
  },
  {
    key: "short_answer",
    label: "단답형",
    description: "정답 단어를 직접 입력",
  },
  {
    key: "sentence_answer",
    label: "문장형 영작",
    description: "목표 단어로 짧은 문장 작성",
  },
];
function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDue(word) {
  const date = safeDate(word?.next_review);
  if (!date) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return date <= today;
}

function isInSavedRange(word, fromValue, toValue) {
  const date = safeDate(word?.created_at);
  if (!date) return false;
  const from = safeDate(fromValue);
  const to = safeDate(toValue);
  if (from) {
    from.setHours(0, 0, 0, 0);
    if (date < from) return false;
  }
  if (to) {
    to.setHours(23, 59, 59, 999);
    if (date > to) return false;
  }
  return true;
}

function formatDate(value) {
  if (!value) return "-";
  return value.replaceAll("-", ".");
}

function countByTag(words, tag) {
  return words.filter((word) => (word.tag || "미지정") === tag).length;
}

function ScopeRow({
  checked,
  title,
  description,
  count,
  onClick,
  disabled = false,
  action,
}) {
  const handleKeyDown = (event) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-3 text-left",
        "transition hover:bg-[#f7f4ec]",
        disabled && "cursor-not-allowed opacity-50",
        checked && "bg-[#f6f1e4]",
      )}
    >
      <Checkbox
        checked={checked}
        tabIndex={-1}
        className="pointer-events-none border-slate-400 data-[state=checked]:border-[#0f766e] data-[state=checked]:bg-[#0f766e]"
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-extrabold text-slate-900">{title}</span>
        {description && (
          <span className="mt-0.5 block truncate text-xs font-medium text-slate-500">
            {description}
          </span>
        )}
      </span>
      <span className="flex items-center gap-3 text-right">
        <span className="whitespace-nowrap text-sm font-black text-slate-900">
          {Number(count || 0).toLocaleString()}개
        </span>
        {action}
      </span>
    </div>
  );
}

function Section({ icon: Icon, title, meta, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4.5 w-4.5 text-slate-800" />
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
        </div>
        {meta && <span className="text-xs font-bold text-slate-500">{meta}</span>}
      </div>
      <div className="space-y-1 px-2 pb-2">{children}</div>
    </section>
  );
}

const GENERATION_STEPS = [
  "단어 범위를 확인하고 있어요",
  "문항 유형을 배분하고 있어요",
  "AI가 문제를 만들고 있어요",
  "문항 품질을 확인하고 있어요",
  "조금 더 걸리고 있어요",
];

function QuizGenerationLoading({ activeStep = 0, totalQuestionCount = 0, elapsedSeconds = 0 }) {
  const safeStep = Math.min(activeStep, GENERATION_STEPS.length - 1);
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-md bg-white p-5 text-center shadow-[0_16px_40px_rgba(15,23,42,0.16)]">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-brand-700" />
        <div className="mt-4 min-w-0">
          <p className="text-base font-black text-slate-950">
            {GENERATION_STEPS[safeStep]}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-400">
            생성 시작 후 {elapsedSeconds.toLocaleString()}초
          </p>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
            {safeStep >= 4
              ? "문항 품질 검사를 통과하지 못한 문제는 다시 생성할 수 있어요."
              : totalQuestionCount >= 5
              ? "문항이 많을수록 시간이 더 걸릴 수 있어요. 화면을 닫지 말고 기다려 주세요."
              : "AI가 퀴즈를 만드는 동안 잠시만 기다려 주세요."}
          </p>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {GENERATION_STEPS.map((step, index) => (
              <div
                key={step}
                className={cn(
                  "h-1.5 rounded-full transition",
                  index <= safeStep ? "bg-brand-600" : "bg-slate-100",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QuizConfig({
  goal,
  setGoalValue,
  labels,
  words = [],
  onGenerate,
  disabled,
  loading = false,
  generationStep = 0,
  generationElapsedSeconds = 0,
  user,
}) {
  const totalWords = words.length;
  const dueWords = words.filter(isDue);
  const rangeWords = words.filter((word) => isInSavedRange(word, goal.saved_from, goal.saved_to));
  const selectedTags = Array.isArray(goal.scope_tags) ? goal.scope_tags : [];
  const selectedWordsById = new Map();
  if (goal.scope_all) {
    words.forEach((word) => selectedWordsById.set(word.id, word));
  }
  selectedTags.forEach((tag) => {
    words
      .filter((word) => (word.tag || "미지정") === tag)
      .forEach((word) => selectedWordsById.set(word.id, word));
  });
  if (goal.scope_saved_date) {
    rangeWords.forEach((word) => selectedWordsById.set(word.id, word));
  }
  if (goal.scope_due) {
    dueWords.forEach((word) => selectedWordsById.set(word.id, word));
  }
  const selectedWordCount = selectedWordsById.size;
  const wordTags = Array.from(
    new Set(words.map((word) => word.tag || "미지정").filter(Boolean)),
  );
  const visibleLabels = [
    ...labels.filter((label) => wordTags.includes(label)),
    ...wordTags.filter((tag) => !labels.includes(tag)),
  ];

  const syncMode = (nextGoal) => {
    if (nextGoal.scope_all) return "random";
    if (nextGoal.scope_tags?.length === 1 && !nextGoal.scope_saved_date && !nextGoal.scope_due) return "tag";
    if (!nextGoal.scope_tags?.length && nextGoal.scope_saved_date && !nextGoal.scope_due) return "saved_date";
    return "custom";
  };

  const updateScope = (patch) => {
    const nextGoal = { ...goal, ...patch };
    if (patch.scope_all === true) {
      nextGoal.scope_tags = [];
      nextGoal.scope_saved_date = false;
      nextGoal.scope_due = false;
    }
    if (
      patch.scope_tags?.length > 0 ||
      patch.scope_saved_date === true ||
      patch.scope_due === true
    ) {
      nextGoal.scope_all = false;
    }
    setGoalValue("scope_all", Boolean(nextGoal.scope_all));
    setGoalValue("scope_tags", nextGoal.scope_tags || []);
    setGoalValue("scope_saved_date", Boolean(nextGoal.scope_saved_date));
    setGoalValue("scope_due", Boolean(nextGoal.scope_due));
    setGoalValue("tag", nextGoal.scope_tags?.[0] || "");
    setGoalValue("mode", syncMode(nextGoal));
  };

  const toggleTag = (label) => {
    const nextTags = selectedTags.includes(label)
      ? selectedTags.filter((item) => item !== label)
      : [...selectedTags, label];
    updateScope({ scope_tags: nextTags });
  };

  const hasTypeCounts = Object.keys(goal.question_type_counts || {}).length > 0;
  const questionTypeCounts = hasTypeCounts ? goal.question_type_counts : DEFAULT_QUESTION_TYPE_COUNTS;
  const totalQuestionCount = Object.values(questionTypeCounts).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  const controlsDisabled = Boolean(disabled || loading);

  const setQuestionTypeCount = (key, value) => {
    const digits = String(value).replace(/\D/g, "");
    const current = Number(questionTypeCounts[key] || 0);
    const otherTotal = Math.max(0, totalQuestionCount - current);
    if (!digits) {
      const nextCounts = { ...questionTypeCounts, [key]: 0 };
      setGoalValue("question_type_counts", nextCounts);
      setGoalValue("question_count", Object.values(nextCounts).reduce((sum, item) => sum + Number(item || 0), 0));
      return;
    }
    const nextValue = Math.min(MAX_QUESTION_COUNT - otherTotal, Math.max(0, Number(digits)));
    const nextCounts = { ...questionTypeCounts, [key]: nextValue };
    setGoalValue("question_type_counts", nextCounts);
    setGoalValue("question_count", Object.values(nextCounts).reduce((sum, item) => sum + Number(item || 0), 0));
  };

  return (
    <div className="animate-fadeIn space-y-5">
      <div>
        <h2 className="text-2xl font-black tracking-normal text-slate-950">퀴즈</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">
          단어장 범위와 문항 수를 정하면 AI가 바로 풀 수 있는 퀴즈를 생성합니다.
        </p>
      </div>

      <div className="rounded-lg bg-[#fbfaf5]">
        <div className="p-4">
          <Card className="rounded-lg border-0 bg-transparent shadow-none">
            <CardContent className="space-y-5 p-5">
              <div className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-950">학습 범위</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    퀴즈에 포함할 단어 범위를 선택하세요.
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <span className="block text-xs font-bold text-slate-500">선택된 단어 수</span>
                  <strong className="text-2xl font-black text-[#0f766e]">
                    {selectedWordCount.toLocaleString()}개
                  </strong>
                  <span className="ml-1 text-sm font-bold text-slate-500">/ {totalWords.toLocaleString()}개</span>
                </div>
              </div>

              <Section icon={Layers3} title="기본 범위" meta="선택 시 세부 범위는 비활성화됩니다">
                <ScopeRow
                  checked={Boolean(goal.scope_all)}
                  title="전체 단어 랜덤"
                  description="태그와 기간 제한 없이 단어장 전체에서 출제"
                  count={totalWords}
                  onClick={() => updateScope({ scope_all: !goal.scope_all })}
                  disabled={controlsDisabled}
                />
              </Section>

              <Section
                icon={Tags}
                title="태그별 선택"
                meta={selectedTags.length > 0 ? `${selectedTags.length}개 태그 선택` : "저장한 태그에서 선택"}
              >
                {visibleLabels.length === 0 ? (
                  <div className="px-3 py-4 text-sm font-medium text-slate-500">
                    아직 태그가 없습니다.
                  </div>
                ) : (
                  visibleLabels.map((label) => (
                    <ScopeRow
                      key={label}
                      checked={selectedTags.includes(label)}
                      title={label}
                      description="저장한 태그에서 출제"
                      count={countByTag(words, label)}
                      onClick={() => toggleTag(label)}
                      disabled={controlsDisabled}
                    />
                  ))
                )}
              </Section>

              <Section
                icon={CalendarDays}
                title="복습 예정"
                meta={goal.scope_saved_date ? `${formatDate(goal.saved_from)} - ${formatDate(goal.saved_to)}` : "기간 기준 선택"}
              >
                <ScopeRow
                  checked={Boolean(goal.scope_saved_date)}
                  title="저장 기간으로 출제"
                  description={`${formatDate(goal.saved_from)}부터 ${formatDate(goal.saved_to)}까지 저장한 단어`}
                  count={rangeWords.length}
                  onClick={() => updateScope({ scope_saved_date: !goal.scope_saved_date })}
                  disabled={controlsDisabled}
                />
                <div className="grid gap-3 rounded-md bg-slate-50/70 px-3 py-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">시작일</span>
                    <Input
                      type="date"
                      value={goal.saved_from}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        updateScope({ scope_saved_date: true });
                        setGoalValue("saved_from", event.target.value);
                      }}
                      className="h-9 rounded-md border-slate-200 bg-white text-sm font-semibold focus-visible:ring-[#0f766e]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">종료일</span>
                    <Input
                      type="date"
                      value={goal.saved_to}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        updateScope({ scope_saved_date: true });
                        setGoalValue("saved_to", event.target.value);
                      }}
                      className="h-9 rounded-md border-slate-200 bg-white text-sm font-semibold focus-visible:ring-[#0f766e]"
                    />
                  </label>
                </div>
                <ScopeRow
                  checked={Boolean(goal.scope_due)}
                  title="오늘 복습 예정"
                  description="복습일이 지난 단어를 함께 포함"
                  count={dueWords.length}
                  onClick={() => updateScope({ scope_due: !goal.scope_due })}
                  disabled={controlsDisabled}
                />
              </Section>

              <Section icon={Check} title="생성 옵션">
                <div className="relative grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  {loading && (
                    <QuizGenerationLoading
                      activeStep={generationStep}
                      totalQuestionCount={totalQuestionCount}
                      elapsedSeconds={generationElapsedSeconds}
                    />
                  )}
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-extrabold text-slate-600">출제 유형</p>
                          <p className="mt-1 text-xs font-medium text-slate-500">유형별 문항 수를 직접 정합니다.</p>
                        </div>
                        <p className="text-sm font-black text-[#0f766e]">
                          총 {totalQuestionCount.toLocaleString()}문항
                        </p>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {QUESTION_TYPE_OPTIONS.map((option) => (
                          <label key={option.key} className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3 rounded-md bg-white p-3">
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-black text-slate-900">{option.label}</span>
                              <span className="mt-0.5 block truncate text-xs font-medium text-slate-500">
                                {option.description}
                              </span>
                            </span>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={MAX_QUESTION_COUNT}
                              value={questionTypeCounts[option.key] ?? 0}
                              disabled={controlsDisabled}
                              onChange={(event) => setQuestionTypeCount(option.key, event.target.value)}
                              className="h-10 rounded-md border-slate-200 bg-white text-center text-sm font-black focus-visible:ring-[#0f766e]"
                              aria-label={`${option.label} 문항 수`}
                            />
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs font-medium text-slate-500">
                        최대 {MAX_QUESTION_COUNT}문항까지 생성할 수 있습니다.
                      </p>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="rounded-md bg-white p-3">
                      <p className="text-xs font-bold text-slate-500">선택된 단어 수</p>
                      <p className="mt-2 text-xl font-black text-slate-950">{selectedWordCount.toLocaleString()}개</p>
                    </div>
                    <label className="min-w-0 space-y-1.5">
                      <span className="text-xs font-extrabold text-slate-600">(선택) AI 지시사항</span>
                      <Textarea
                        value={goal.instruction}
                        onChange={(event) => setGoalValue("instruction", event.target.value)}
                        placeholder="예: 비즈니스 상황 중심으로, 헷갈리는 뜻 위주로 출제해줘."
                        rows={4}
                        maxLength={300}
                        disabled={controlsDisabled}
                        className="resize-none rounded-md border-slate-200 bg-white text-sm font-medium leading-6 focus-visible:ring-[#0f766e]"
                      />
                      <span className="block text-right text-[11px] font-medium text-slate-400">
                        {(goal.instruction || "").length} / 300
                      </span>
                    </label>
                    <Button
                      onClick={onGenerate}
                      disabled={controlsDisabled || !user || selectedWordCount === 0 || totalQuestionCount === 0}
                      className="h-12 w-full rounded-md bg-[#0f766e] text-base font-black text-white shadow-sm hover:bg-[#0b5f59] disabled:bg-slate-200 disabled:text-slate-500 sm:w-48 sm:self-end"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {loading ? "생성 중..." : "시작하기"}
                    </Button>
                  </div>
                </div>
              </Section>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
