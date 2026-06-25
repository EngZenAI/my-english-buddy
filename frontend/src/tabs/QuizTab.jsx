import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

export default function QuizTab({ user, onRequireLogin }) {
  const [words, setWords] = useState([]);
  const [quizText, setQuizText] = useState("");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");

  const generateMutation = useMutation({
    mutationFn: api.quizGenerate,
    onSuccess: ({ words, quiz_text }) => {
      setFeedback("");
      setAnswer("");
      setWords(words);
      setQuizText(quiz_text);
    },
  });

  const gradeMutation = useMutation({
    mutationFn: () => api.quizGrade(words, quizText, answer),
    onSuccess: ({ feedback }) => {
      setFeedback(feedback);
    },
  });

  const generate = async () => {
    if (genLoading || gradeLoading) return;
    generateMutation.mutate();
  };

  const grade = async () => {
    if (genLoading || gradeLoading || !quizText.trim()) return;
    gradeMutation.mutate();
  };

  const genLoading = generateMutation.isPending;
  const gradeLoading = gradeMutation.isPending;

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">복습할 단어로 퀴즈를 풀어보세요!</h3>

      {!user && <MemberNotice feature="퀴즈" onRequireLogin={onRequireLogin} />}

      <button
        onClick={generate}
        disabled={genLoading || gradeLoading || !user}
        className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                   disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
      >
        {genLoading ? (
          <LoadingSpinner
            label="퀴즈 생성 중"
            className="text-white"
            spinnerClassName="border-white/40 border-t-white"
          />
        ) : "🎯 퀴즈 생성"}
      </button>

      <div className="mt-3">
        <label className="block text-sm text-slate-500 mb-1">퀴즈</label>
        {genLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
            <SkeletonBlock className="h-4 w-3/4" />
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-5/6" />
            <SkeletonBlock className="h-4 w-2/3" />
            <SkeletonBlock className="h-4 w-4/5" />
          </div>
        ) : quizText ? (
          <textarea
            readOnly
            rows={12}
            value={quizText}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm
                       resize-none whitespace-pre-wrap"
          />
        ) : (
          <EmptyState
            title={user ? "아직 생성된 퀴즈가 없습니다" : "로그인이 필요합니다"}
            description={
              user
                ? "퀴즈 생성을 누르면 복습할 단어로 문제가 만들어집니다."
                : "로그인하면 저장한 단어로 퀴즈를 만들 수 있어요."
            }
          />
        )}
      </div>

      <div className="mt-3">
        <label className="block text-sm text-slate-500 mb-1">📝 답변 입력</label>
        <textarea
          rows={6}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={!user || genLoading || gradeLoading}
          placeholder={"1번: \n2번: \n3번: \n4번: \n5번: "}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none
                     disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      <button
        onClick={grade}
        disabled={genLoading || gradeLoading || !user || !quizText.trim()}
        className="mt-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                   disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
      >
        {gradeLoading ? <LoadingSpinner label="채점 중" /> : "✅ 채점하기"}
      </button>

      <div className="mt-3">
        <label className="block text-sm text-slate-500 mb-1">📊 채점 결과</label>
        {gradeLoading ? (
          <SkeletonBlock className="h-32" />
        ) : feedback ? (
          <textarea
            readOnly
            rows={8}
            value={feedback}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm
                       resize-none whitespace-pre-wrap"
          />
        ) : (
          <EmptyState
            title="채점 결과가 없습니다"
            description="답변을 입력하고 채점하면 피드백이 표시됩니다."
          />
        )}
      </div>
    </div>
  );
}
