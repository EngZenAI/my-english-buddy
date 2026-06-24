import { useState } from "react";
import { api } from "../api";
import MemberNotice from "../components/MemberNotice";

export default function QuizTab({ user, onRequireLogin }) {
  const [words, setWords] = useState([]);
  const [quizText, setQuizText] = useState("");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [gradeLoading, setGradeLoading] = useState(false);

  const generate = async () => {
    setGenLoading(true);
    setFeedback("");
    try {
      const { words, quiz_text } = await api.quizGenerate();
      setWords(words);
      setQuizText(quiz_text);
    } finally {
      setGenLoading(false);
    }
  };

  const grade = async () => {
    setGradeLoading(true);
    try {
      const { feedback } = await api.quizGrade(words, quizText, answer);
      setFeedback(feedback);
    } finally {
      setGradeLoading(false);
    }
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">복습할 단어로 퀴즈를 풀어보세요!</h3>

      {!user && <MemberNotice feature="퀴즈" onRequireLogin={onRequireLogin} />}

      <button
        onClick={generate}
        disabled={genLoading || !user}
        className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                   disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
      >
        {genLoading ? "생성 중…" : "🎯 퀴즈 생성"}
      </button>

      <div className="mt-3">
        <label className="block text-sm text-slate-500 mb-1">퀴즈</label>
        <textarea
          readOnly
          rows={12}
          value={quizText}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm
                     resize-none whitespace-pre-wrap"
        />
      </div>

      <div className="mt-3">
        <label className="block text-sm text-slate-500 mb-1">📝 답변 입력</label>
        <textarea
          rows={6}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={!user}
          placeholder={"1번: \n2번: \n3번: \n4번: \n5번: "}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none
                     disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      <button
        onClick={grade}
        disabled={gradeLoading || !user}
        className="mt-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                   disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
      >
        {gradeLoading ? "채점 중…" : "✅ 채점하기"}
      </button>

      <div className="mt-3">
        <label className="block text-sm text-slate-500 mb-1">📊 채점 결과</label>
        <textarea
          readOnly
          rows={8}
          value={feedback}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm
                     resize-none whitespace-pre-wrap"
        />
      </div>
    </div>
  );
}
