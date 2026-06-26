import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

// 메시지는 객체 리스트로 관리: { role: "user" | "bot", text, coaching? }
// 백엔드는 [[user, bot], ...] 튜플을 주고받으므로 경계에서 변환한다.
function pairsToMessages(pairs) {
  const out = [];
  for (const [user, bot] of pairs) {
    if (user) out.push({ role: "user", text: user });
    if (bot) out.push({ role: "bot", text: bot });
  }
  return out;
}

function messagesToPairs(messages) {
  const pairs = [];
  let curUser = "";
  let haveUser = false;
  for (const m of messages) {
    if (m.role === "user") {
      curUser = m.text;
      haveUser = true;
    } else {
      pairs.push([haveUser ? curUser : "", m.text]);
      curUser = "";
      haveUser = false;
    }
  }
  if (haveUser) pairs.push([curUser, ""]);
  return pairs;
}

const LEVELS = [
  { value: "beginner", label: "입문", hint: "쉬운 단어·짧은 문장" },
  { value: "intermediate", label: "중급", hint: "일상 어휘·후속 질문" },
  { value: "advanced", label: "고급", hint: "원어민 표현·심화 질문" },
];

const SCENARIOS = [
  { value: "daily", label: "일상 대화", hint: "원어민 친구와 메신저 채팅하듯" },
  { value: "opic", label: "OPIc 시험", hint: "면접관과 자기소개·롤플레이" },
  { value: "tag", label: "단어장 태그", hint: "내가 고른 태그 맥락의 상황극" },
];

export default function RoleplayTab({ user, onRequireLogin }) {
  const [started, setStarted] = useState(false);
  const [level, setLevel] = useState("intermediate");
  const [scenario, setScenario] = useState("daily");
  const [tag, setTag] = useState("");
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState("");
  const scrollRef = useRef(null);

  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: !!user && scenario === "tag",
  });
  const labels = labelsQuery.data?.labels || [];

  // 태그 시나리오인데 아직 태그를 안 골랐으면 첫 태그로 기본값
  const effectiveTag = scenario === "tag" ? tag || labels[0] || "" : null;

  const config = useMemo(
    () => ({ level, scenario, tag: effectiveTag }),
    [level, scenario, effectiveTag],
  );

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (scrollRef.current)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  };

  const startMutation = useMutation({
    mutationFn: () => api.roleplayStart(config),
    onSuccess: ({ history }) => {
      setMessages(pairsToMessages(history));
      setStarted(true);
      scrollToBottom();
    },
  });

  const sendMutation = useMutation({
    mutationFn: ({ pairs, text }) => api.roleplayContinue(pairs, text, config),
    onSuccess: ({ history }) => {
      setMessages(pairsToMessages(history));
      scrollToBottom();
    },
    onError: (_error, { text }) => {
      // 낙관적으로 추가한 사용자 메시지를 되돌리고 입력값 복구
      setMessages((prev) => {
        const next = [...prev];
        if (next.length && next[next.length - 1].role === "user") next.pop();
        return next;
      });
      setMsg((current) => current || text);
    },
  });

  const start = () => {
    if (scenario === "tag" && !effectiveTag) return;
    startMutation.mutate();
  };

  const send = () => {
    if (!msg.trim() || sendMutation.isPending) return;
    const text = msg;
    const pairs = messagesToPairs(messages);
    setMessages((prev) => [...prev, { role: "user", text }]);
    setMsg("");
    sendMutation.mutate({ pairs, text });
    scrollToBottom();
  };

  const reset = () => {
    setStarted(false);
    setMessages([]);
    setMsg("");
  };

  const starting = startMutation.isPending;
  const sending = sendMutation.isPending;

  return (
    <div>
      <h3 className="text-base font-semibold mb-1">AI 튜터와 영어로 대화해보세요!</h3>
      <p className="text-sm text-slate-500 mb-3">
        레벨과 상황을 고르면, 그 맥락에 맞춰 AI가 대화를 이끌어요 🎭
      </p>

      {!user && <MemberNotice feature="롤플레잉" onRequireLogin={onRequireLogin} />}

      {/* ── 설정 화면 (시작 전) ───────────────────────── */}
      {!started && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-1.5">레벨</p>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  disabled={!user}
                  onClick={() => setLevel(l.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60
                    disabled:cursor-not-allowed ${
                      level === l.value
                        ? "border-brand-600 bg-brand-50 ring-1 ring-brand-200"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                >
                  <span className="font-semibold text-slate-800">{l.label}</span>
                  <span className="block text-[11px] text-slate-500">{l.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700 mb-1.5">상황</p>
            <div className="grid grid-cols-3 gap-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  disabled={!user}
                  onClick={() => setScenario(s.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60
                    disabled:cursor-not-allowed ${
                      scenario === s.value
                        ? "border-brand-600 bg-brand-50 ring-1 ring-brand-200"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                >
                  <span className="font-semibold text-slate-800">{s.label}</span>
                  <span className="block text-[11px] text-slate-500">{s.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {scenario === "tag" && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-1.5">태그 선택</p>
              {labelsQuery.isLoading ? (
                <SkeletonBlock className="h-9 w-48 rounded-lg" />
              ) : labels.length === 0 ? (
                <p className="text-sm text-slate-500">
                  저장된 태그가 없어요. 단어장에서 단어를 먼저 추가해보세요.
                </p>
              ) : (
                <select
                  value={effectiveTag}
                  onChange={(e) => setTag(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  {labels.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <button
            onClick={start}
            disabled={
              starting ||
              !user ||
              (scenario === "tag" && !effectiveTag)
            }
            className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                       disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
          >
            {starting ? (
              <LoadingSpinner
                label="시작 중"
                className="text-white"
                spinnerClassName="border-white/40 border-t-white"
              />
            ) : (
              "🎭 롤플레잉 시작"
            )}
          </button>
        </div>
      )}

      {/* ── 대화 화면 (시작 후) ───────────────────────── */}
      {started && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                {LEVELS.find((l) => l.value === level)?.label}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                {SCENARIOS.find((s) => s.value === scenario)?.label}
              </span>
              {scenario === "tag" && effectiveTag && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
                  #{effectiveTag}
                </span>
              )}
            </div>
            <button
              onClick={reset}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              다시 설정
            </button>
          </div>

          <div
            ref={scrollRef}
            className="h-[400px] overflow-y-auto border border-slate-200 rounded-lg bg-white p-3 space-y-3"
          >
            {messages.length === 0 && !sending && (
              <div className="mt-28">
                <EmptyState
                  title="대화를 준비 중입니다"
                  description="AI 튜터가 곧 첫 상황을 제시합니다."
                />
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-brand-600 text-white rounded-2xl rounded-br-sm px-3 py-2
                                  text-sm max-w-[80%] whitespace-pre-wrap">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="bg-slate-100 text-slate-800 rounded-2xl rounded-bl-sm px-3 py-2
                                  text-sm max-w-[80%] whitespace-pre-wrap">
                    {m.text}
                  </div>
                </div>
              ),
            )}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-slate-100 text-slate-500 rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
                  <LoadingSpinner label="답변 작성 중" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={!user}
              placeholder="영어로 대답해봐요! (엔터로 전송)"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm
                         disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
            <button
              onClick={send}
              disabled={sending || !user}
              className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                         disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold whitespace-nowrap"
            >
              전송 ➤
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
