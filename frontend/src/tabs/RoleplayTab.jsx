import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";
import LearningNotesTab from "./LearningNotesTab";
import RoleplayCard from "@/components/roleplay/RoleplayCard";
import ChatArea from "@/components/roleplay/ChatArea";
import FeedbackDrawer from "@/components/roleplay/FeedbackDrawer";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, BookOpen, AlertCircle, Compass } from "lucide-react";

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
  { value: "opic", label: "OPIc 상황극", hint: "시험에 자주 나오는 대화 세트" },
  { value: "tag", label: "단어장 태그", hint: "내가 정한 단어 범주 기반 대화" },
  { value: "general", label: "자유 주제", hint: "상황을 직접 타이핑하여 대화" },
];

const OPIC_CARDS = [
  {
    label: "예약 미루기 📞",
    situation:
      "You are a clinic receptionist. The learner is a patient calling to postpone their appointment to another day. Greet them, ask for details, and reschedule.",
  },
  {
    label: "hotel front desk 🏨",
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

export default function RoleplayTab({ user, onRequireLogin }) {
  const [subTab, setSubTab] = useState("play"); // play | notes
  const [level, setLevel] = useState("intermediate");
  const [mode, setMode] = useState("opic");
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState("");
  const [freeTopic, setFreeTopic] = useState("");
  const [session, setSession] = useState(null); // 시작 시 고정된 {level, scenario, tag, situation}
  const [summary, setSummary] = useState(null); // 종료 후 {summary, expressions, vocab}
  const [pickedVocab, setPickedVocab] = useState(() => new Set());
  const [saveTag, setSaveTag] = useState("");
  const [savedCount, setSavedCount] = useState(null);

  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: !!user,
  });

  const wordsQuery = useQuery({
    queryKey: queryKeys.words(""),
    queryFn: () => api.listWords(""),
    enabled: !!user && mode === "tag",
  });

  const labels = labelsQuery.data?.labels || [];
  const allWords = wordsQuery.data?.words || [];

  const usableTags = useMemo(() => {
    const counts = {};
    for (const w of allWords) counts[w.tag] = (counts[w.tag] || 0) + 1;
    return labels
      .filter((t) => t !== "미지정" && counts[t] > 0)
      .map((t) => ({ name: t, count: counts[t] }));
  }, [allWords, labels]);

  const tagLoading = mode === "tag" && (labelsQuery.isLoading || wordsQuery.isLoading);
  const active = messages.length > 0;

  const resetConversation = () => {
    setMessages([]);
    setMsg("");
    setSession(null);
    setSummary(null);
    setPickedVocab(new Set());
    setSavedCount(null);
  };

  const startMutation = useMutation({
    mutationFn: ({ scenario, situation, tag }) =>
      api.roleplayStart({
        level,
        scenario,
        tag: tag || null,
        situation,
      }),
    onSuccess: (data, variables) => {
      resetConversation();
      setSession({
        level,
        scenario: variables.scenario,
        tag: variables.tag || "",
        situation: variables.situation,
        title: variables.title || "",
      });
      setMessages(pairsToMessages(data.history || []));
    },
  });

  const sendMutation = useMutation({
    mutationFn: (text) =>
      api.roleplayContinue(messagesToPairs(messages), text, {
        level: session.level,
        scenario: session.scenario,
        tag: session.tag || null,
        situation: session.situation,
      }),
    onSuccess: (data) => {
      setMessages(pairsToMessages(data.history || []));
    },
  });

  const finishMutation = useMutation({
    mutationFn: () =>
      api.roleplaySummary(messagesToPairs(messages), {
        level: session.level,
        scenario: session.scenario,
        tag: session.tag || null,
        situation: session.situation,
        title: session.title || "",
      }),
    onSuccess: (data) => {
      setSummary({
        summary: data.summary || "",
        expressions: data.expressions || [],
        vocab: data.vocab || [],
      });
      const vocabList = data.vocab || [];
      const initPicked = new Set();
      vocabList.forEach((_, idx) => initPicked.add(idx));
      setPickedVocab(initPicked);
    },
  });

  const saveVocabMutation = useMutation({
    mutationFn: ({ items, tag }) => api.roleplaySaveWords(items, tag),
    onSuccess: (data) => {
      setSavedCount((data.added || 0) + (data.updated || 0));
      setPickedVocab(new Set());
    },
  });

  const startRoleplay = (scenario, situation, tag = "", title = "") => {
    if (!user) {
      onRequireLogin();
      return;
    }
    startMutation.mutate({ scenario, situation, tag, title });
  };

  const handleStartFreeTopic = () => {
    const text = freeTopic.trim();
    if (!text || !user) return;
    startRoleplay("general", text, "", text);
  };

  const handleSend = () => {
    const text = msg.trim();
    if (!text || sendMutation.isPending || finishMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setMsg("");
    sendMutation.mutate(text);
  };

  const handleFinish = () => {
    if (finishMutation.isPending || messages.length === 0) return;
    finishMutation.mutate();
  };

  const handleSaveVocab = () => {
    if (!summary || pickedVocab.size === 0) return;
    const list = summary.vocab || [];
    const items = list
      .filter((_, idx) => pickedVocab.has(idx))
      .map((v) => ({
        word: v.suggested_word,
        korean: v.suggested_korean,
        korean_detail: v.suggested_korean,
        english_def: v.suggested_english_def,
        example: v.suggested_example,
        tag: saveTag || "미지정",
      }));
    saveVocabMutation.mutate({ items, tag: saveTag || "미지정" });
  };

  return (
    <div className="h-full flex flex-col select-none">
      {/* 롤플레잉 탭 헤더 */}
      <div className="flex flex-col gap-4.5 md:flex-row md:items-center justify-between border-b pb-4.5 mb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight dark:text-slate-100 flex items-center gap-1.5">
            <MessageSquare className="h-5 w-5 text-indigo-500 fill-indigo-100" />
            AI 원어민 롤플레잉
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            가상 상황에서 원어민 AI와 1:1 회화 연습을 진행하고 맞춤 코칭을 받아보세요.
          </p>
        </div>

        {/* 대화하기 / 회화 기록 서브탭 토글 */}
        <div className="flex rounded-xl border border-slate-200/80 bg-white p-0.5 self-start">
          {[
            { id: "play", label: "대화하기" },
            { id: "notes", label: "회화 복습 노트" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={`h-8 rounded-lg px-4 text-xs font-semibold transition-all ${
                subTab === item.id
                  ? "bg-slate-900 text-white dark:bg-slate-800"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {subTab === "notes" ? (
        <LearningNotesTab user={user} onRequireLogin={onRequireLogin} />
      ) : (
        <div className="flex-1">
          {startMutation.isPending ? (
            <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
              <LoadingSpinner label="AI 원어민이 상황을 연출 중입니다..." />
            </div>
          ) : !active ? (
            /* 1. 대화 시작 전 세팅 화면 */
            <>
              {startMutation.isError && (
                <Card className="mb-4 border-red-100 bg-red-50/80 text-red-700 rounded-2xl">
                  <CardContent className="p-4 flex items-start gap-2.5 text-xs font-semibold">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p>대화를 시작하지 못했습니다.</p>
                      <p className="mt-1 text-red-500 font-medium">
                        {startMutation.error?.message || "백엔드 또는 LLM 연결 상태를 확인해주세요."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
              <RoleplayCard
                levels={LEVELS}
                selectedLevel={level}
                setSelectedLevel={setLevel}
                modes={MODES}
                selectedMode={mode}
                setSelectedMode={setMode}
                cards={OPIC_CARDS}
                onStartRoleplay={startRoleplay}
                usableTags={usableTags}
                tagLoading={tagLoading}
                freeTopic={freeTopic}
                setFreeTopic={setFreeTopic}
                onStartFreeTopic={handleStartFreeTopic}
                user={user}
              />
            </>
          ) : (
            /* 2. 대화 진행 중 화면 (반응형 2-Column 구성) */
            <div className="flex flex-col gap-6 md:grid md:grid-cols-12 md:gap-6 items-start h-full pb-10">
              {/* 좌측: 실시간 메신저 채팅창 */}
              <div className="w-full md:col-span-7 h-full">
                <ChatArea
                  session={session}
                  messages={messages}
                  msg={msg}
                  setMsg={setMsg}
                  onSend={handleSend}
                  sendPending={sendMutation.isPending}
                  onFinish={handleFinish}
                  finishPending={finishMutation.isPending}
                  onReset={resetConversation}
                />
              </div>

              {/* 우측: 팁 및 대화 완료 후 피드백 리포트 */}
              <div className="w-full md:col-span-5 h-full">
                {summary ? (
                  <FeedbackDrawer
                    summary={summary}
                    pickedVocab={pickedVocab}
                    setPickedVocab={setPickedVocab}
                    saveTag={saveTag}
                    setSaveTag={setSaveTag}
                    labels={labels}
                    onSaveVocab={handleSaveVocab}
                    savedCount={savedCount}
                    onClose={resetConversation}
                  />
                ) : (
                  <Card className="border-slate-100 bg-slate-50/30 rounded-2xl p-5 space-y-3.5 shadow-sm">
                    <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Compass className="h-4 w-4 text-brand-500" />
                      롤플레잉 진행 가이드
                    </h4>
                    <div className="text-xs text-slate-500 space-y-2.5 font-medium leading-relaxed">
                      <p>1. AI 원어민의 첫 인사말에 어울리는 답변을 영어로 입력해 대화를 이어가세요.</p>
                      <p>2. 각 봇 말풍선 하단의 전구💡 아이콘 영역에는 더 세련된 표현을 익힐 수 있는 한국어 코칭 피드백이 제공됩니다.</p>
                      <p>3. 대화를 마무리하고 싶을 때 우측 상단의 <b className="text-brand-600">[대화 완료]</b> 버튼을 누르면 AI가 전체 대화를 피드백해주고 단어장에 등록할 주요 표현을 추출해 드립니다.</p>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
