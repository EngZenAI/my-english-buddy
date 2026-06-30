import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send, RotateCcw } from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";
import LearningNotesTab from "./LearningNotesTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Marker, MarkerGroup } from "@/components/ui/marker";
import { Message } from "@/components/ui/message";
import { MessageScroller } from "@/components/ui/message-scroller";

// ──────────────────────────────────────────────────────────────────────
// 롤플레잉 = 실전 영어 회화 연습 (단어 복습이 아님).
// UX: 상단에서 레벨/모드를 고르고, 바로 아래 예시 카드를 클릭하면 즉시 대화 시작.
//     세부 설정을 강요하지 않고, 클릭 한 번으로 몰입하도록 한다.
// history는 객체 메시지 { role, text } 리스트로 관리하고, 백엔드의 [[user,bot],...]
// 튜플과는 경계에서 변환한다(향후 코칭/표현추출 확장 대비).
// ──────────────────────────────────────────────────────────────────────

// 백엔드 history 항목은 [user, bot, coaching] (coaching은 봇 답변에 붙는 한국어 코칭).
function pairsToMessages(pairs) {
  const out = [];
  for (const item of pairs) {
    const [user, bot, coaching] = item;
    if (user) out.push({ role: "user", text: user });
    if (bot) out.push({ role: "bot", text: bot, coaching: coaching || "" });
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
      pairs.push([haveUser ? curUser : "", m.text, m.coaching || ""]);
      curUser = "";
      haveUser = false;
    }
  }
  if (haveUser) pairs.push([curUser, "", ""]);
  return pairs;
}

const LEVELS = [
  { value: "beginner", label: "입문" },
  { value: "intermediate", label: "중급" },
  { value: "advanced", label: "고급" },
];

const MODES = [
  { value: "opic", label: "OPIc", hint: "설문형 상황극으로 시험 대비" },
  { value: "tag", label: "단어장 태그", hint: "내 태그 주제로 대화·표현 정리" },
  { value: "general", label: "자유 주제", hint: "원하는 상황을 직접 정해 회화" },
];

// 클릭 즉시 대화를 시작하는 고정 예시 카드. situation은 시스템 프롬프트로 주입된다.
const OPIC_CARDS = [
  {
    label: "예약 미루기 📞",
    situation:
      "You are a clinic receptionist. The learner is a patient calling to postpone their appointment to another day. Greet them, ask for details, and reschedule.",
  },
  {
    label: "호텔 방 문제 🏨",
    situation:
      "You are a hotel front-desk clerk. The learner is a guest calling because there is a problem in their room (e.g., no hot water). Listen and offer to fix it.",
  },
  {
    label: "친구와 약속 변경 🗓️",
    situation:
      "You are the learner's close friend. They call to change your weekend plans. React casually and work out a new plan together.",
  },
  {
    label: "환불 요청 🛍️",
    situation:
      "You are a store clerk. The learner returns a product with a defect and wants a refund or exchange. Handle it politely.",
  },
  {
    label: "식당 예약 🍽️",
    situation:
      "You are a restaurant host taking a phone reservation. The learner wants to book a table. Ask for date, time, party size, and any requests.",
  },
  {
    label: "길 안내 받기 🗺️",
    situation:
      "You are a friendly local. The learner is a tourist asking how to get to a famous place nearby. Give directions and chat a little.",
  },
];

// 역할이 둘인 상황은 AI가 첫 턴에 "어느 역할을 맡을래?"를 먼저 묻고, 학습자가 고른
// 역할의 반대를 맡아 시작하도록 situation에 지시한다. (소개팅처럼 역할 구분이 없는 건 바로 시작)
const GENERAL_CARDS = [
  {
    label: "카페 ☕",
    situation:
      "This is a café role-play with two roles: barista or customer. FIRST, briefly set " +
      "the scene and ask the learner which role they want to play — barista or customer. " +
      "After they choose, take the OTHER role and begin. Menu: Americano, caffè latte, " +
      "cappuccino, hot chocolate, croissant, blueberry muffin. Handle the order, suggest " +
      "items, confirm size and payment, and add light small talk about the weather or day.",
  },
  {
    label: "레스토랑 서빙 🍽️",
    situation:
      "This is a restaurant role-play with two roles: the server (waiter) or the diner. " +
      "FIRST set the scene and ask the learner which role they want — server or diner. " +
      "After they choose, take the OTHER role and begin. Cover greeting and seating, taking " +
      "the order from the menu (starters: soup, salad; mains: steak, pasta, burger, grilled " +
      "fish; drinks: wine, beer, soda), recommending the special, checking how everything is, " +
      "and bringing the bill. Keep it natural and friendly.",
  },
  {
    label: "공항 체크인 ✈️",
    situation:
      "This is an airport check-in role-play with two roles: the passenger or the check-in " +
      "agent. FIRST set the scene and ask the learner which role they want — passenger or " +
      "agent. After they choose, take the OTHER role and begin. Cover passport and " +
      "destination, bags to check vs carry-on, window or aisle seat, and the boarding gate " +
      "and time, with brief small talk about the trip.",
  },
  {
    label: "면접 💼",
    situation:
      "This is a job-interview role-play for a Marketing Associate position, with two " +
      "roles: the candidate or the interviewer. FIRST set the scene and ask the learner " +
      "which role they want — candidate or interviewer. After they choose, take the OTHER " +
      "role and begin. Use common questions (tell me about yourself, why this job, a " +
      "strength and a weakness, a challenge you solved) and follow up naturally.",
  },
  {
    label: "소개팅 💗",
    situation:
      "This is a casual first-date role-play at a cozy café; you are the learner's date. " +
      "Set the scene warmly and start. Take turns asking and sharing about hobbies, work, " +
      "favorite food, travel, and music. Show interest, react warmly, and keep it light.",
  },
  {
    label: "집 구하기 🏠",
    situation:
      "This is an apartment-viewing role-play with two roles: the prospective tenant or the " +
      "real-estate agent. FIRST set the scene and ask the learner which role they want — " +
      "tenant or agent. After they choose, take the OTHER role and begin. It's a two-bedroom " +
      "apartment; cover monthly rent, deposit, location, nearby transit, amenities, and move-in date.",
  },
];

export default function RoleplayTab({ user, onRequireLogin }) {
  const [subTab, setSubTab] = useState("play"); // play | notes
  const [level, setLevel] = useState("intermediate");
  const [mode, setMode] = useState("opic");
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState("");
  const [freeTopic, setFreeTopic] = useState("");
  const [session, setSession] = useState(null); // 시작 시 고정된 {level, scenario, tag, situation}
  const [summary, setSummary] = useState(null); // 종료 후 {summary, expressions, vocab}
  const [pickedVocab, setPickedVocab] = useState(() => new Set()); // 단어장에 담을 어휘 인덱스
  const [saveTag, setSaveTag] = useState(""); // 어휘 저장 시 태그
  const [savedCount, setSavedCount] = useState(null); // 저장 결과 안내
  const [finishNoticeDismissed, setFinishNoticeDismissed] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef(null);

  // 라벨은 태그 모드 칩 + 정리 페이지의 '단어장 추가' 태그 선택에 쓰이므로 로그인 시 로드.
  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: !!user,
  });
  // 단어 있는 태그 추리기용 — 태그 모드에서만 필요.
  const wordsQuery = useQuery({
    queryKey: queryKeys.words(""),
    queryFn: () => api.listWords(""),
    enabled: !!user && mode === "tag",
  });
  const labels = labelsQuery.data?.labels || [];
  const allWords = wordsQuery.data?.words || [];

  // '미지정'(기본 폴백 태그)은 주제가 아니므로 제외하고, 단어가 있는 태그만.
  const usableTags = useMemo(() => {
    const counts = {};
    for (const w of allWords) counts[w.tag] = (counts[w.tag] || 0) + 1;
    return labels
      .filter((t) => t !== "미지정" && counts[t] > 0)
      .map((t) => ({ name: t, count: counts[t] }));
  }, [allWords, labels]);

  const tagLoading =
    mode === "tag" && (labelsQuery.isLoading || wordsQuery.isLoading);

  const active = messages.length > 0;

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToBottom?.();
    });
  };

  const resetConversation = () => {
    setMessages([]);
    setSession(null);
    setMsg("");
    setSummary(null);
    setPickedVocab(new Set());
    setSavedCount(null);
    setFinishNoticeDismissed(false);
  };

  const startMutation = useMutation({
    mutationFn: (cfg) => api.roleplayStart(cfg),
    onSuccess: ({ history }) => {
      setMessages(pairsToMessages(history));
      scrollToBottom();
    },
  });

  // 카드/태그/자유주제 클릭 → 즉시 시작.
  // title: 진행 중 칩에 보여줄 상황 제목(카드 라벨 / 자유주제 텍스트 / #태그).
  const start = ({ tag = null, situation = "", title = "" }) => {
    if (startMutation.isPending) return;
    const cfg = { level, scenario: mode, tag, situation };
    setSession({ ...cfg, title });
    setMessages([]);
    setMsg("");
    setFinishNoticeDismissed(false);
    startMutation.mutate(cfg);
  };

  const changeLevel = (l) => {
    setLevel(l);
    resetConversation();
  };
  const changeMode = (m) => {
    setMode(m);
    resetConversation();
  };

  // 토큰 보호: 일정 턴부터 마무리 권장, 더 길어지면 정리만 가능하게 막는다.
  const SOFT_TURN_LIMIT = 5;
  const WRAP_UP_TURN = 6;
  const HARD_TURN_LIMIT = 8;
  const userTurns = messages.filter((m) => m.role === "user").length;
  const reachedCap = userTurns >= WRAP_UP_TURN;
  const reachedHardLimit = userTurns >= HARD_TURN_LIMIT;
  const shouldSuggestFinish = active && !summary && userTurns >= SOFT_TURN_LIMIT;
  const showFinishNotice =
    shouldSuggestFinish && (!finishNoticeDismissed || reachedHardLimit);

  const send = async () => {
    if (!msg.trim() || streaming) return;
    if (reachedHardLimit) return;
    const text = msg;
    const pairs = messagesToPairs(messages);
    // 다음 응답이 정리 구간에 도달하면 AI가 자연스럽게 마무리하도록 wrapUp 전달.
    const wrapUp = userTurns + 1 >= WRAP_UP_TURN;
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "bot", text: "", coaching: "", streaming: true },
    ]);
    setMsg("");
    setFinishNoticeDismissed(false);
    setStreaming(true);
    scrollToBottom();
    try {
      const { history } = await api.roleplayContinueStream(
        pairs,
        text,
        { ...(session || {}), wrapUp },
        {
          onDelta: (delta) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "bot") {
                next[next.length - 1] = {
                  ...last,
                  text: `${last.text || ""}${delta}`,
                  streaming: true,
                };
              }
              return next;
            });
            scrollToBottom();
          },
          onCoaching: (coaching) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "bot") {
                next[next.length - 1] = { ...last, coaching, streaming: true };
              }
              return next;
            });
            scrollToBottom();
          },
        }
      );
      setMessages(pairsToMessages(history));
      scrollToBottom();
    } catch (_error) {
      setMessages((prev) => {
        const next = [...prev];
        if (next.length && next[next.length - 1].role === "bot") next.pop();
        if (next.length && next[next.length - 1].role === "user") next.pop();
        return next;
      });
      setMsg((current) => current || text);
    } finally {
      setStreaming(false);
    }
  };

  // 대화 종료 → 요약 + 표현/어휘 추출
  const summaryMutation = useMutation({
    mutationFn: () => api.roleplaySummary(messagesToPairs(messages), session || {}),
    onSuccess: (data) => {
      setSummary(data);
      // 추출된 어휘는 기본 전체 선택, 저장 태그는 상황 태그 또는 '미지정'.
      setPickedVocab(new Set((data.vocab || []).map((_, i) => i)));
      setSaveTag((session && session.tag) || "");
      setSavedCount(null);
    },
  });

  const saveWordsMutation = useMutation({
    mutationFn: (items) => api.roleplaySaveWords(items, saveTag || null),
    onSuccess: (res) => {
      setSavedCount(res.added ?? 0);
    },
  });

  const finish = () => {
    if (summaryMutation.isPending) return;
    summaryMutation.mutate();
  };

  const toggleVocab = (i) => {
    setPickedVocab((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const saveSelectedVocab = () => {
    if (!summary || saveWordsMutation.isPending) return;
    const items = (summary.vocab || []).filter((_, i) => pickedVocab.has(i));
    if (!items.length) return;
    saveWordsMutation.mutate(items);
  };

  const starting = startMutation.isPending;
  const sending = streaming;
  const summarizing = summaryMutation.isPending;

  const cards = mode === "opic" ? OPIC_CARDS : GENERAL_CARDS;

  return (
    <div>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">원어민과 영어로 대화 연습! 🎭</h3>
        <p className="text-sm text-slate-500">
          상황을 하나 고르면 바로 대화가 시작돼요. 실전처럼 영어로 말해보고, 배운 표현을 써보세요.
        </p>
      </div>

      {!user && <MemberNotice feature="롤플레잉" onRequireLogin={onRequireLogin} />}

      {/* 롤플레잉 내부 탭: 대화 / 학습노트 */}
      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {[
          { id: "play", label: "대화하기" },
          { id: "notes", label: "학습노트" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              subTab === t.id
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "notes" && (
        <div className="mt-4">
          <LearningNotesTab user={user} />
        </div>
      )}

      {subTab === "play" && (
        <>
      {/* ── 상단 선택: 레벨 + 모드 ───────────────────────── */}
      <div className="mt-4 space-y-2 mb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 w-10">레벨</span>
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              disabled={!user}
              onClick={() => changeLevel(l.value)}
              className={`rounded-full border px-3 py-1 text-xs disabled:opacity-60
                disabled:cursor-not-allowed ${
                  level === l.value
                    ? "border-brand-600 bg-brand-50 text-brand-700 font-semibold"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 w-10">모드</span>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              disabled={!user}
              title={m.hint}
              onClick={() => changeMode(m.value)}
              className={`rounded-full border px-3 py-1 text-xs disabled:opacity-60
                disabled:cursor-not-allowed ${
                  mode === m.value
                    ? "border-brand-600 bg-brand-50 text-brand-700 font-semibold"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 시작 전: 예시 카드 / 태그 / 자유주제 ───────────── */}
      {user && !active && (
        <div className="mb-3">
          {(mode === "opic" || mode === "general") && (
            <>
              <p className="text-xs text-slate-500 mb-1.5">
                상황을 클릭하면 바로 시작해요
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {cards.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    disabled={starting}
                    onClick={() => start({ situation: c.situation, title: c.label })}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left
                               text-sm text-slate-700 hover:border-brand-400 hover:bg-brand-50
                               disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {mode === "general" && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    value={freeTopic}
                    onChange={(e) => setFreeTopic(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      freeTopic.trim() &&
                      start({ situation: freeTopic.trim(), title: freeTopic.trim() })
                    }
                    placeholder="또는 직접 상황 입력 (예: 택시 기사와 대화, 병원 접수)"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <button
                    type="button"
                    disabled={!freeTopic.trim() || starting}
                    onClick={() => start({ situation: freeTopic.trim(), title: freeTopic.trim() })}
                    className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                               disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold whitespace-nowrap"
                  >
                    시작
                  </button>
                </div>
              )}
            </>
          )}

          {mode === "tag" && (
            <>
              {tagLoading ? (
                <div className="flex gap-2">
                  <SkeletonBlock className="h-9 w-24 rounded-full" />
                  <SkeletonBlock className="h-9 w-24 rounded-full" />
                  <SkeletonBlock className="h-9 w-24 rounded-full" />
                </div>
              ) : usableTags.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center">
                  <p className="text-sm font-semibold text-slate-600">
                    대화할 태그가 아직 없어요
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    단어장을 태그(예: 여행, 비즈니스)별로 정리하면 그 주제로 대화할 수 있어요.
                  </p>
                  <div className="mt-3 flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => changeMode("general")}
                      className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 px-3 py-1.5 text-sm font-semibold"
                    >
                      자유 주제로 시작
                    </button>
                    <button
                      type="button"
                      onClick={() => changeMode("opic")}
                      className="rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-1.5 text-sm font-semibold"
                    >
                      OPIc으로 시작
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500 mb-1.5">
                    태그를 클릭하면 그 주제로 대화를 시작해요
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {usableTags.map((t) => (
                      <button
                        key={t.name}
                        type="button"
                        disabled={starting}
                        onClick={() => start({ tag: t.name, title: `#${t.name}` })}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm
                                   text-slate-700 hover:border-brand-400 hover:bg-brand-50
                                   disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        #{t.name}{" "}
                        <span className="text-xs text-slate-400">{t.count}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 진행 중: 상황 칩 + 다시 고르기 ─────────────────── */}
      {active && session && (
        <div className="flex items-center justify-between mb-2">
          <MarkerGroup>
            <Marker variant="muted">
              {LEVELS.find((l) => l.value === level)?.label}
            </Marker>
            <Marker variant="muted">
              {MODES.find((m) => m.value === mode)?.label}
            </Marker>
            {session.title && (
              <Marker
                variant="primary"
                title={session.title}
                className="max-w-[220px]"
              >
                {session.title}
              </Marker>
            )}
          </MarkerGroup>
          <div className="flex items-center gap-2">
            {!summary && !showFinishNotice && (
              <button
                onClick={finish}
                disabled={summarizing}
                className={`rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-60 ${
                  reachedCap || reachedHardLimit
                    ? "bg-brand-600 text-white hover:bg-brand-700"
                    : "border border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {summarizing ? "정리 중…" : "대화 마무리 & 정리"}
              </button>
            )}
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={resetConversation}
              className="h-7 px-1 text-xs text-slate-500 hover:text-slate-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              다른 상황 고르기
            </Button>
          </div>
        </div>
      )}

      {showFinishNotice && (
        <div
          className={`mb-3 rounded-lg border px-4 py-3 ${
            reachedHardLimit
              ? "border-rose-200 bg-rose-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p
                className={`text-sm font-semibold ${
                  reachedHardLimit ? "text-rose-800" : "text-amber-800"
                }`}
              >
                {reachedHardLimit
                  ? "토큰 보호를 위해 여기서 마무리해요"
                  : "대화가 충분히 진행됐어요. 마무리할까요?"}
              </p>
              <p
                className={`mt-1 text-xs ${
                  reachedHardLimit ? "text-rose-700" : "text-amber-700"
                }`}
              >
                {reachedHardLimit
                  ? "이 대화는 이미 연습량이 충분해서 추가 전송을 잠시 막았어요. 정리하면 요약과 표현을 저장할 수 있습니다."
                  : "지금 정리하면 대화 요약, 유용한 표현, 단어장에 넣을 어휘를 바로 뽑아줍니다."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {!reachedHardLimit && (
                <button
                  type="button"
                  onClick={() => setFinishNoticeDismissed(true)}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  조금 더 하기
                </button>
              )}
              <button
                type="button"
                onClick={finish}
                disabled={summarizing}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
                  reachedHardLimit
                    ? "bg-rose-600 hover:bg-rose-700"
                    : "bg-brand-600 hover:bg-brand-700"
                }`}
              >
                {summarizing ? "정리 중..." : "대화 마무리 & 정리"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 채팅 영역 ─────────────────────────────────────── */}
      <MessageScroller
        ref={scrollRef}
        className="h-[420px]"
        contentClassName="min-h-full"
      >
        {starting && (
          <div className="space-y-3">
            <SkeletonBlock className="h-12 w-3/4 rounded-2xl" />
            <SkeletonBlock className="ml-auto h-10 w-1/2 rounded-2xl" />
            <SkeletonBlock className="h-16 w-5/6 rounded-2xl" />
          </div>
        )}
        {!starting && !active && (
          <div className="mt-24">
            <EmptyState
              title={user ? "상황을 골라 대화를 시작하세요" : "로그인이 필요합니다"}
              description={
                user
                  ? "위에서 모드와 상황을 선택하면 AI가 첫 장면을 열어줍니다."
                  : "로그인하면 원어민 AI와 영어로 대화할 수 있어요."
              }
            />
          </div>
        )}
        {!starting &&
          messages.map((m, i) => (
            <Message
              key={`${m.role}-${i}`}
              role={m.role === "user" ? "user" : "assistant"}
              coaching={m.coaching}
              loading={m.streaming && !m.text}
            >
              {m.text}
            </Message>
          ))}
      </MessageScroller>

      {/* 입력창: 대화 시작 후에만 활성화 (정리 화면에선 숨김) */}
      {!summary && (
        <div className="flex items-center gap-2 mt-3">
          <Input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={!user || !active || starting || reachedHardLimit}
            placeholder={
              reachedHardLimit
                ? "토큰 보호를 위해 대화를 마무리해주세요"
                : active
                  ? "영어로 대답해봐요! (엔터로 전송)"
                  : "위에서 상황을 먼저 선택하세요"
            }
            className="h-11 flex-1 bg-background disabled:bg-muted"
          />
          <Button
            type="button"
            onClick={send}
            disabled={sending || !user || !active || reachedHardLimit}
            className="h-11 shrink-0 px-4"
          >
            <Send className="h-4 w-4" />
            전송
          </Button>
        </div>
      )}

      {/* 정리 페이지: 요약 + 유용 표현 + 유용 어휘(단어장 추가) */}
      {summary && (
        <div className="mt-3 space-y-4">
          {summary.summary && (
            <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
              <p className="text-sm font-semibold text-brand-700 mb-1">🎉 대화 요약</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{summary.summary}</p>
            </div>
          )}

          {summary.expressions?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-1.5">💬 유용한 표현</p>
              <ul className="space-y-1.5">
                {summary.expressions.map((e, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-slate-800">{e.en}</span>
                    {e.ko && <span className="text-slate-500"> — {e.ko}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.vocab?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold text-slate-700">
                  📒 유용한 어휘 — 단어장에 추가할까요?
                </p>
                <select
                  value={saveTag}
                  onChange={(e) => setSaveTag(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs
                             focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">미지정</option>
                  {labels
                    .filter((t) => t !== "미지정")
                    .map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                </select>
              </div>
              <ul className="space-y-1.5">
                {summary.vocab.map((v, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={pickedVocab.has(i)}
                      onChange={() => toggleVocab(i)}
                      className="mt-1"
                    />
                    <div>
                      <span className="font-semibold text-slate-800">{v.word}</span>
                      {v.korean && <span className="text-slate-500"> — {v.korean}</span>}
                      {v.example && (
                        <span className="block text-xs text-slate-400">{v.example}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={saveSelectedVocab}
                  disabled={saveWordsMutation.isPending || pickedVocab.size === 0}
                  className="rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60
                             disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
                >
                  {saveWordsMutation.isPending
                    ? "추가 중…"
                    : `선택한 ${pickedVocab.size}개 단어장에 추가`}
                </button>
                {savedCount != null && (
                  <span className="text-sm text-emerald-600">✓ {savedCount}개 추가됐어요!</span>
                )}
              </div>
            </div>
          )}

          <button
            onClick={resetConversation}
            className="rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50
                       px-4 py-2 text-sm font-semibold"
          >
            새 대화 시작
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}
