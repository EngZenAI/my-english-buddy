import { useRef, useState } from "react";
import { api } from "../api";

// history: [[user, bot], ...] — 백엔드 형식 그대로 유지
export default function RoleplayTab() {
  const [history, setHistory] = useState([]);
  const [msg, setMsg] = useState("");
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (scrollRef.current)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  };

  const start = async () => {
    setStarting(true);
    try {
      const { history } = await api.roleplayStart();
      setHistory(history);
      scrollToBottom();
    } finally {
      setStarting(false);
    }
  };

  const send = async () => {
    if (!msg.trim() || sending) return;
    const text = msg;
    setMsg("");
    setSending(true);
    try {
      const { history: newHistory } = await api.roleplayContinue(history, text);
      setHistory(newHistory);
      scrollToBottom();
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-1">AI 튜터와 영어로 대화해보세요!</h3>
      <p className="text-sm text-slate-500 mb-3">
        복습할 단어들이 대화 속에 자연스럽게 등장해요 🎭
      </p>

      <button
        onClick={start}
        disabled={starting}
        className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                   px-4 py-2 text-sm font-semibold mb-3"
      >
        {starting ? "시작 중…" : "🎭 롤플레잉 시작"}
      </button>

      <div
        ref={scrollRef}
        className="h-[400px] overflow-y-auto border border-slate-200 rounded-lg bg-white p-3 space-y-3"
      >
        {history.length === 0 && (
          <p className="text-slate-400 text-sm text-center mt-32">
            "롤플레잉 시작"을 눌러 대화를 시작하세요.
          </p>
        )}
        {history.map(([user, bot], i) => (
          <div key={i} className="space-y-2">
            {user && (
              <div className="flex justify-end">
                <div className="bg-brand-600 text-white rounded-2xl rounded-br-sm px-3 py-2
                                text-sm max-w-[80%] whitespace-pre-wrap">
                  {user}
                </div>
              </div>
            )}
            {bot && (
              <div className="flex justify-start">
                <div className="bg-slate-100 text-slate-800 rounded-2xl rounded-bl-sm px-3 py-2
                                text-sm max-w-[80%] whitespace-pre-wrap">
                  {bot}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="영어로 대답해봐요! (엔터로 전송)"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <button
          onClick={send}
          disabled={sending}
          className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                     px-4 py-2 text-sm font-semibold whitespace-nowrap"
        >
          전송 ➤
        </button>
      </div>
    </div>
  );
}
