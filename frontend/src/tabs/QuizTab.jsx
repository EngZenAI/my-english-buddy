import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

export default function QuizTab({ user, onRequireLogin }) {
  const [questions, setQuestions] = useState([]);
  const [answerToken, setAnswerToken] = useState("");
  const [answers, setAnswers] = useState({});
  const [gradeResult, setGradeResult] = useState(null);
  const [message, setMessage] = useState("");

  const generateMutation = useMutation({
    mutationFn: api.quizGenerate,
    onSuccess: (data) => {
      setGradeResult(null);
      setAnswers({});
      setQuestions(data.questions || []);
      setAnswerToken(data.answer_token || "");
      setMessage(data.message || "");
    },
  });

  const gradePayload = useMemo(
    () =>
      Object.entries(answers).map(([questionId, choiceId]) => ({
        question_id: questionId,
        choice_id: choiceId,
      })),
    [answers],
  );

  const gradeMutation = useMutation({
    mutationFn: () => api.quizGrade(answerToken, gradePayload),
    onSuccess: (data) => {
      setGradeResult(data);
      setMessage(data.feedback || "");
    },
  });

  const genLoading = generateMutation.isPending;
  const gradeLoading = gradeMutation.isPending;
  const answeredCount = Object.keys(answers).length;
  const hasQuiz = questions.length > 0;
  const resultByQuestion = useMemo(() => {
    const pairs = (gradeResult?.results || []).map((result) => [
      result.question_id,
      result,
    ]);
    return Object.fromEntries(pairs);
  }, [gradeResult]);

  const generate = () => {
    if (genLoading || gradeLoading) return;
    generateMutation.mutate();
  };

  const grade = () => {
    if (genLoading || gradeLoading || !answerToken || !hasQuiz) return;
    gradeMutation.mutate();
  };

  const chooseAnswer = (questionId, choiceId) => {
    if (gradeResult) return;
    setAnswers((prev) => ({ ...prev, [questionId]: choiceId }));
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">AI 어휘 과제</h3>
          <p className="mt-1 text-sm text-slate-500">
            복습일이 된 단어를 바탕으로 영어 학원 선생님처럼 문제를 냅니다.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={genLoading || gradeLoading || !user}
          className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                     disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
        >
          {genLoading ? (
            <LoadingSpinner
              label="출제 중"
              className="text-white"
              spinnerClassName="border-white/40 border-t-white"
            />
          ) : "퀴즈 생성"}
        </button>
      </div>

      {!user && <MemberNotice feature="퀴즈" onRequireLogin={onRequireLogin} />}

      {(generateMutation.error || gradeMutation.error) && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {(generateMutation.error || gradeMutation.error).message}
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          {message}
        </div>
      )}

      <div className="mt-4">
        {genLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border border-slate-200 bg-white p-4">
                <SkeletonBlock className="h-4 w-3/4" />
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <SkeletonBlock className="h-10" />
                  <SkeletonBlock className="h-10" />
                  <SkeletonBlock className="h-10" />
                  <SkeletonBlock className="h-10" />
                </div>
              </div>
            ))}
          </div>
        ) : hasQuiz ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>총 {questions.length}문제</span>
              <span>{answeredCount}/{questions.length} 선택</span>
            </div>

            {questions.map((question, index) => {
              const result = resultByQuestion[question.id];
              return (
                <div
                  key={question.id}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-800">
                      {index + 1}. {question.prompt}
                    </p>
                    {result && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                          result.correct
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {result.correct ? "정답" : "오답"}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {question.choices.map((choice) => {
                      const selected = answers[question.id] === choice.id;
                      const correctChoice = result?.correct_choice_id === choice.id;
                      const wrongSelected = result && selected && !correctChoice;
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => chooseAnswer(question.id, choice.id)}
                          disabled={Boolean(gradeResult)}
                          className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition
                            ${selected ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white hover:bg-slate-50"}
                            ${correctChoice ? "border-emerald-500 bg-emerald-50 text-emerald-800" : ""}
                            ${wrongSelected ? "border-rose-500 bg-rose-50 text-rose-800" : ""}
                            disabled:cursor-default`}
                        >
                          <span className="font-semibold">{choice.id}.</span>{" "}
                          <span>{choice.text}</span>
                        </button>
                      );
                    })}
                  </div>

                  {result && (
                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <p>
                        정답: {result.correct_choice_id}. {result.correct_text}
                      </p>
                      {result.explanation && (
                        <p className="mt-1">{result.explanation}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={grade}
              disabled={genLoading || gradeLoading || !user || !answerToken || Boolean(gradeResult)}
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                         disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
            >
              {gradeLoading ? <LoadingSpinner label="채점 중" /> : "채점하기"}
            </button>

            {gradeResult && (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">
                  점수 {gradeResult.score}/{gradeResult.total}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  정답 단어는 30일 뒤, 오답 단어는 1일 뒤로 다음 복습일이 조정됩니다.
                </p>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            title={user ? "생성된 퀴즈가 없습니다" : "로그인이 필요합니다"}
            description={
              user
                ? "퀴즈 생성을 누르면 복습일이 된 단어로 문제가 만들어집니다."
                : "로그인하면 저장한 단어로 AI 어휘 과제를 받을 수 있어요."
            }
          />
        )}
      </div>
    </div>
  );
}
