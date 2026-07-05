import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Flag,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";
import LearningNotesTab from "./LearningNotesTab";
import tutorAvatar from "@/assets/roleplay-tutor-avatar.svg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { MessageAvatar } from "@/components/ui/message";
import {
  getCachedRoleplayAudio,
  normalizeTtsText,
  roleplayTtsCacheKey,
  saveCachedRoleplayAudio,
} from "../lib/roleplayAudioCache";

// ──────────────────────────────────────────────────────────────────────
// 롤플레잉 = 실전 영어 회화 연습 (단어 복습이 아님).
// UX: 상단에서 레벨/모드를 고르고, 바로 아래 예시 카드를 클릭하면 즉시 대화 시작.
//     세부 설정을 강요하지 않고, 클릭 한 번으로 몰입하도록 한다.
// history는 객체 메시지 { role, text } 리스트로 관리하고, 백엔드의 [[user,bot],...]
// 튜플과는 경계에서 변환한다(향후 코칭/표현추출 확장 대비).
// ──────────────────────────────────────────────────────────────────────

// 백엔드 history 항목은 [user, bot, coaching] (coaching은 봇 답변에 붙는 한국어 코칭).
const ROLEPLAY_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const ROLEPLAY_TTS_VOICE = "Kore";

function RoleplayScrollEffect({ signal }) {
  const { scrollToEnd, shouldStickToEndRef } = useMessageScroller();

  useEffect(() => {
    if (!signal) return;
    requestAnimationFrame(() => {
      if (!shouldStickToEndRef?.current) return;
      scrollToEnd({ behavior: "auto" });
    });
  }, [scrollToEnd, shouldStickToEndRef, signal]);

  return null;
}

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

export default function RoleplayTab({ user, onRequireLogin, agentLaunch = null }) {
  const [subTab, setSubTab] = useState("play"); // play | voice
  const [sideTab, setSideTab] = useState("coach");
  const [level, setLevel] = useState("intermediate");
  const [mode, setMode] = useState("opic");
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [ttsSource, setTtsSource] = useState("idle"); // idle | generating | cache | generated | browser | error
  const [voiceError, setVoiceError] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [freeTopic, setFreeTopic] = useState("");
  const [memo, setMemo] = useState("");
  const [session, setSession] = useState(null); // 시작 시 고정된 {level, scenario, tag, situation}
  const [summary, setSummary] = useState(null); // 종료 후 {summary, expressions, vocab}
  const [pickedVocab, setPickedVocab] = useState(() => new Set()); // 단어장에 담을 어휘 인덱스
  const [saveTag, setSaveTag] = useState(""); // 어휘 저장 시 태그
  const [savedCount, setSavedCount] = useState(null); // 저장 결과 안내
  const [finishNoticeDismissed, setFinishNoticeDismissed] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [scrollSignal, setScrollSignal] = useState(0);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const audioCleanupRef = useRef(null);
  const startAbortRef = useRef(null);
  const streamAbortRef = useRef(null);
  const requestSeqRef = useRef(0);
  const roleplayRequestInFlightRef = useRef(false);
  const summaryInFlightRef = useRef(false);
  const agentLaunchIdRef = useRef(null);

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
  const isVoiceTab = subTab === "voice";
  const latestAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "bot" && messages[i].text) return messages[i].text;
    }
    return "";
  }, [messages]);
  const voicePhase = streaming
    ? {
        title: "AI가 답변을 작성 중입니다",
        description: "텍스트 답변이 먼저 도착하고, 이어서 AI 음성을 준비합니다.",
        tone: "primary",
      }
    : ttsSource === "generating"
      ? {
          title: "AI 음성을 생성 중입니다",
          description: "처음 듣는 문장은 몇 초 걸릴 수 있습니다. 준비되면 자동으로 재생됩니다.",
          tone: "primary",
        }
      : speaking
        ? {
            title:
              ttsSource === "browser"
                ? "기기 내장 음성으로 재생 중입니다"
                : "AI 음성을 재생 중입니다",
            description:
              ttsSource === "cache"
                ? "AI 답변을 다시 읽고 있습니다."
                : ttsSource === "browser"
                  ? "AI 음성 대신 브라우저/기기 내장 음성을 사용 중입니다."
                  : "AI 답변을 읽고 있습니다.",
            tone: ttsSource === "browser" ? "warning" : "primary",
          }
        : listening
          ? {
              title: "듣고 있습니다",
              description: "말한 내용을 전송 전에 확인할 수 있습니다.",
              tone: "destructive",
            }
          : {
              title: active ? "말할 준비가 됐습니다" : "상황을 먼저 선택하세요",
              description: active
                ? "말하기를 누르고 영어로 답하세요. AI 답변은 음성으로 재생됩니다."
                : "상황을 선택하면 AI가 첫 장면을 열고 음성으로 읽어줍니다.",
              tone: "muted",
            };

  const scrollToBottom = () => {
    setScrollSignal((value) => value + 1);
  };

  const cancelRoleplayRequests = () => {
    requestSeqRef.current += 1;
    roleplayRequestInFlightRef.current = false;
    startAbortRef.current?.abort?.();
    streamAbortRef.current?.abort?.();
    startAbortRef.current = null;
    streamAbortRef.current = null;
    setStreaming(false);
  };

  const stopListening = () => {
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    setListening(false);
  };

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const resetConversation = () => {
    cancelRoleplayRequests();
    stopListening();
    stopSpeaking();
    setMessages([]);
    setSession(null);
    setMsg("");
    setVoiceTranscript("");
    setTtsSource("idle");
    setVoiceError("");
    setVoiceNotice("");
    setSummary(null);
    setPickedVocab(new Set());
    setSavedCount(null);
    setFinishNoticeDismissed(false);
  };

  useEffect(() => {
    return () => {
      cancelRoleplayRequests();
      recognitionRef.current?.abort?.();
      audioRef.current?.pause?.();
      audioCleanupRef.current?.();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const startMutation = useMutation({
    mutationFn: ({ cfg, signal }) => api.roleplayStart({ ...cfg, signal }),
    onSuccess: ({ history }, variables) => {
      if (variables.requestId !== requestSeqRef.current) return;
      startAbortRef.current = null;
      roleplayRequestInFlightRef.current = false;
      setMessages(pairsToMessages(history));
      if (isVoiceTab) playAssistantVoice(history?.[0]?.[1] || "");
      scrollToBottom();
    },
    onError: (_error, variables) => {
      if (variables?.requestId === requestSeqRef.current) {
        startAbortRef.current = null;
        roleplayRequestInFlightRef.current = false;
      }
    },
  });

  // 카드/태그/자유주제 클릭 → 즉시 시작.
  // title: 진행 중 칩에 보여줄 상황 제목(카드 라벨 / 자유주제 텍스트 / #태그).
  const start = ({ tag = null, situation = "", title = "" }) => {
    if (startMutation.isPending || roleplayRequestInFlightRef.current) return;
    cancelRoleplayRequests();
    roleplayRequestInFlightRef.current = true;
    const controller = new AbortController();
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    startAbortRef.current = controller;
    const cfg = { level, scenario: mode, tag, situation };
    setSession({ ...cfg, title });
    setMessages([]);
    setMsg("");
    setFinishNoticeDismissed(false);
    startMutation.mutate({ cfg, requestId, signal: controller.signal });
  };

  const startFromAgent = (launch) => {
    if (!launch || !user || startMutation.isPending || roleplayRequestInFlightRef.current) return;
    if (agentLaunchIdRef.current === launch.id) return;
    agentLaunchIdRef.current = launch.id;
    cancelRoleplayRequests();
    stopListening();
    stopSpeaking();
    setSubTab("play");
    const nextLevel = launch.level || "intermediate";
    const nextMode = launch.scenario || "general";
    const cfg = {
      level: nextLevel,
      scenario: nextMode,
      tag: launch.tag || null,
      situation: launch.situation || "",
    };
    setLevel(nextLevel);
    setMode(nextMode);
    setFreeTopic(launch.situation || "");
    setSummary(null);
    setPickedVocab(new Set());
    setSavedCount(null);
    setFinishNoticeDismissed(false);
    roleplayRequestInFlightRef.current = true;
    const controller = new AbortController();
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    startAbortRef.current = controller;
    setSession({ ...cfg, title: launch.title || launch.tag || launch.situation || "Buddy 추천" });
    setMessages([]);
    setMsg("");
    startMutation.mutate({ cfg, requestId, signal: controller.signal });
  };

  useEffect(() => {
    startFromAgent(agentLaunch);
  }, [agentLaunch, user]);

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

  const speakWithBrowser = (text) => {
    const clean = (text || "").trim();
    if (!clean || !("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    setTtsSource("browser");
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      setTtsSource("error");
      setVoiceError("기기 내장 음성으로도 답변을 읽지 못했어요.");
    };
    window.speechSynthesis.speak(utterance);
    return true;
  };

  const playAudioBlob = async (blob, source, fallbackText) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    let handledError = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      URL.revokeObjectURL(url);
      if (audioRef.current === audio) audioRef.current = null;
      if (audioCleanupRef.current === cleanup) audioCleanupRef.current = null;
    };

    audioRef.current = audio;
    audioCleanupRef.current = cleanup;
    audio.onplay = () => {
      setSpeaking(true);
      setTtsSource(source);
    };
    audio.onended = () => {
      setSpeaking(false);
      cleanup();
    };
    audio.onerror = () => {
      handledError = true;
      setSpeaking(false);
      cleanup();
      setVoiceError(
        source === "cache"
          ? "브라우저에 저장된 AI 음성을 재생하지 못해 기기 내장 음성으로 전환했어요."
          : "AI 음성을 재생하지 못해 기기 내장 음성으로 전환했어요.",
      );
      speakWithBrowser(fallbackText);
    };

    try {
      await audio.play();
    } catch (error) {
      if (handledError) return;
      setSpeaking(false);
      cleanup();
      throw error;
    }
  };

  const playAssistantVoice = async (text, { force = false } = {}) => {
    const clean = normalizeTtsText(text);
    if ((!autoSpeak && !force) || !clean) return;
    stopSpeaking();
    setVoiceError("");
    setTtsSource("generating");
    try {
      const cacheKey = await roleplayTtsCacheKey(clean, {
        model: ROLEPLAY_TTS_MODEL,
        voice: ROLEPLAY_TTS_VOICE,
      });
      const cached = await getCachedRoleplayAudio(cacheKey).catch(() => null);
      if (cached?.blob) {
        await playAudioBlob(cached.blob, "cache", clean);
        return;
      }

      const result = await api.roleplayTtsAudio(clean, {
        model: ROLEPLAY_TTS_MODEL,
        voice: ROLEPLAY_TTS_VOICE,
      });
      await saveCachedRoleplayAudio({
        key: result.cacheKey || cacheKey,
        blob: result.blob,
        mimeType: result.mimeType,
        model: result.model,
        voice: result.voice,
        text: clean,
      }).catch(() => {});
      await playAudioBlob(result.blob, "generated", clean);
    } catch (error) {
      const fallbackStarted = speakWithBrowser(clean);
      if (fallbackStarted) {
        setVoiceError("AI 음성 대신 기기 내장 음성으로 재생하고 있습니다.");
      } else {
        setTtsSource("error");
        setVoiceError("음성을 재생하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    }
  };

  const sendText = async (inputText, { speakReply = false } = {}) => {
    const text = (inputText || "").trim();
    if (!text || streaming || roleplayRequestInFlightRef.current) return;
    if (reachedHardLimit) return;
    roleplayRequestInFlightRef.current = true;
    const pairs = messagesToPairs(messages);
    // 다음 응답이 정리 구간에 도달하면 AI가 자연스럽게 마무리하도록 wrapUp 전달.
    const wrapUp = userTurns + 1 >= WRAP_UP_TURN;
    streamAbortRef.current?.abort?.();
    const controller = new AbortController();
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    streamAbortRef.current = controller;
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "bot", text: "", coaching: "", streaming: true },
    ]);
    setMsg("");
    setVoiceTranscript("");
    setFinishNoticeDismissed(false);
    setStreaming(true);
    scrollToBottom();
    try {
      const { history } = await api.roleplayContinueStream(
        pairs,
        text,
        { ...(session || {}), wrapUp, signal: controller.signal },
        {
          onDelta: (delta) => {
            if (requestId !== requestSeqRef.current) return;
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
            if (requestId !== requestSeqRef.current) return;
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
      if (requestId !== requestSeqRef.current) return;
      setMessages(pairsToMessages(history));
      if (speakReply) {
        const lastTurn = history?.[history.length - 1];
        playAssistantVoice(lastTurn?.[1] || "");
      }
      scrollToBottom();
    } catch (_error) {
      if (requestId !== requestSeqRef.current || controller.signal.aborted) return;
      setMessages((prev) => {
        const next = [...prev];
        if (next.length && next[next.length - 1].role === "bot") next.pop();
        if (next.length && next[next.length - 1].role === "user") next.pop();
        return next;
      });
      setMsg((current) => current || text);
      if (speakReply) setVoiceTranscript((current) => current || text);
    } finally {
      if (requestId === requestSeqRef.current) {
        streamAbortRef.current = null;
        roleplayRequestInFlightRef.current = false;
        setStreaming(false);
      }
    }
  };

  const send = () => sendText(msg);

  const requestMicrophonePermission = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceNotice("");
      setVoiceError("이 브라우저는 마이크 권한 요청을 지원하지 않아요.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setVoiceError("");
      setVoiceNotice(
        active
          ? "마이크 권한이 확인됐어요."
          : "마이크 권한이 확인됐어요. 상황을 선택하면 음성 채팅을 시작할 수 있습니다.",
      );
      return true;
    } catch (error) {
      setVoiceNotice("");
      setVoiceError(
        error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError"
          ? "마이크 권한을 허용해야 음성 채팅을 사용할 수 있어요."
          : "마이크를 사용할 수 없습니다. 브라우저 권한과 입력 장치를 확인해주세요.",
      );
      return false;
    }
  };

  const startListening = async () => {
    if (!user || starting || streaming || reachedHardLimit) return;
    stopSpeaking();
    const permitted = await requestMicrophonePermission();
    if (!permitted || !active) return;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("이 브라우저는 음성 인식을 지원하지 않아요. Chrome 또는 Edge에서 사용해주세요.");
      return;
    }
    setVoiceError("");
    setVoiceNotice("");
    setVoiceTranscript("");
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript || "";
      }
      setVoiceTranscript(transcript.trim());
    };
    recognition.onerror = (event) => {
      setVoiceError(
        event.error === "not-allowed"
          ? "마이크 권한이 필요합니다. 브라우저 권한을 허용해주세요."
          : "음성 인식 중 문제가 생겼어요. 다시 시도해주세요."
      );
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try {
      setListening(true);
      recognition.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
      setVoiceError("음성 인식을 시작하지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  };

  const sendVoice = () => {
    stopListening();
    sendText(voiceTranscript, { speakReply: true });
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
    onSettled: () => {
      summaryInFlightRef.current = false;
    },
  });

  const saveWordsMutation = useMutation({
    mutationFn: (items) => api.roleplaySaveWords(items, saveTag || null),
    onSuccess: (res) => {
      setSavedCount(res.added ?? 0);
    },
  });

  const finish = () => {
    if (
      summaryMutation.isPending ||
      summaryInFlightRef.current ||
      roleplayRequestInFlightRef.current
    ) {
      return;
    }
    summaryInFlightRef.current = true;
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
  const summarizing = summaryMutation.isPending || summaryInFlightRef.current;
  const finishDisabled = summarizing || starting || sending;
  const scrollerItemCount =
    messages.length + (starting ? 1 : 0) + (!starting && !active ? 1 : 0);

  const cards = mode === "opic" ? OPIC_CARDS : GENERAL_CARDS;
  const levelLabel = LEVELS.find((item) => item.value === level)?.label || level;
  const modeLabel = MODES.find((item) => item.value === mode)?.label || mode;
  const sessionTitle =
    session?.title ||
    (mode === "tag" ? "태그 선택" : mode === "opic" ? "OPIc 상황 선택" : "상황 선택");
  const coachingItems = messages
    .map((item, index) => ({ ...item, index }))
    .filter((item) => item.role === "bot" && item.coaching?.trim())
    .slice(-3)
    .reverse();
  const scenarioOptions =
    mode === "tag"
      ? usableTags.map((tag) => ({
          value: `tag:${tag.name}`,
          label: `#${tag.name} (${tag.count})`,
          action: () => start({ tag: tag.name, title: `#${tag.name}` }),
        }))
      : cards.map((card, index) => ({
          value: `card:${index}`,
          label: card.label,
          action: () => start({ situation: card.situation, title: card.label }),
        }));
  const visibleScenarioOptions = scenarioOptions.filter((option) => {
    if (!session) return true;
    if (session?.tag && option.value === `tag:${session.tag}`) return false;
    if (session?.title && option.label === session.title) return false;
    return true;
  });
  const elapsedLabel = `${String(Math.floor(userTurns / 2)).padStart(2, "0")}:${String(
    (userTurns * 23) % 60
  ).padStart(2, "0")}`;
  const sessionBusy = starting || streaming || summarizing;
  const emptyScenarioDisabled =
    !user || starting || (mode === "tag" && (tagLoading || usableTags.length === 0));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f6f7f8] text-slate-950">
      <div className="shrink-0 border-b border-slate-800/60 bg-[#10171b] px-3 py-2 text-white shadow-[0_10px_26px_rgba(15,23,42,0.18)] md:px-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[minmax(210px,1.45fr)_minmax(150px,0.8fr)_minmax(170px,1fr)]">
            <label className="grid grid-cols-[3.25rem_1fr] items-center gap-2 text-xs text-slate-300">
              <span>시나리오</span>
              <span className="relative min-w-0">
                <select
                  value=""
                  disabled={emptyScenarioDisabled}
                  onChange={(event) => {
                    const selected = scenarioOptions.find(
                      (option) => option.value === event.target.value
                    );
                    selected?.action();
                  }}
                  className="h-9 w-full appearance-none rounded-md border border-white/10 bg-white/10 px-3 pr-9 text-sm font-semibold text-white outline-none ring-offset-[#10171b] transition hover:bg-white/20 focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="" className="text-slate-900">
                    {sessionTitle}
                  </option>
                  {visibleScenarioOptions.map((option) => (
                    <option key={option.value} value={option.value} className="text-slate-900">
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              </span>
            </label>

            <label className="grid grid-cols-[2rem_1fr] items-center gap-2 text-xs text-slate-300">
              <span>레벨</span>
              <span className="relative min-w-0">
                <select
                  value={level}
                  disabled={!user || sessionBusy}
                  onChange={(event) => changeLevel(event.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-white/10 bg-white/10 px-3 pr-9 text-sm font-semibold text-white outline-none ring-offset-[#10171b] transition hover:bg-white/20 focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {LEVELS.map((item) => (
                    <option key={item.value} value={item.value} className="text-slate-900">
                      {item.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              </span>
            </label>

            <label className="grid grid-cols-[3.7rem_1fr] items-center gap-2 text-xs text-slate-300">
              <span>언어 환경</span>
              <span className="relative min-w-0">
                <select
                  value={isVoiceTab ? "voice" : "play"}
                  disabled={!user}
                  onChange={(event) => setSubTab(event.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-brand-300/20 bg-brand-500/40 px-3 pr-9 text-sm font-semibold text-white outline-none ring-offset-[#10171b] transition hover:bg-brand-500/50 focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="play" className="text-slate-900">
                    텍스트 대화
                  </option>
                  <option value="voice" className="text-slate-900">
                    음성 채팅
                  </option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-200" />
              </span>
            </label>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAutoSpeak((value) => !value)}
              className="h-9 border-white/20 bg-white/10 px-3 text-white hover:bg-white/20 hover:text-white"
            >
              {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              <span className="hidden 2xl:inline">자동 스크립트</span>
              <span className="2xl:hidden">스크립트</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetConversation}
              className="h-9 border-white/20 bg-white/10 px-3 text-white hover:bg-white/20 hover:text-white"
            >
              <RotateCcw className="h-4 w-4" />
              <span>다시 선택</span>
            </Button>
          </div>
        </div>
      </div>

      {!user && (
        <div className="shrink-0 px-4 pt-4">
          <MemberNotice feature="롤플레잉" onRequireLogin={onRequireLogin} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pb-24 lg:grid lg:grid-cols-[minmax(0,1fr)_330px] lg:overflow-hidden lg:p-4 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="flex shrink-0 flex-col gap-3 lg:min-h-0 lg:shrink">
          <Card className="shrink-0 rounded-md border-slate-200 bg-white shadow-sm">
            <CardContent className="p-3 md:p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="rounded-md bg-slate-100 text-slate-700">
                    {modeLabel}
                  </Badge>
                  <Badge variant="outline" className="rounded-md border-slate-200 bg-white">
                    {levelLabel}
                  </Badge>
                  <Badge className="max-w-[22rem] truncate rounded-md bg-brand-50 text-brand-700 hover:bg-brand-50">
                    {sessionTitle}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="h-4 w-4" />
                    {elapsedLabel}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Headphones className="h-4 w-4" />
                    {isVoiceTab ? voicePhase.title : "대화 기록"}
                  </span>
                </div>
              </div>

            </CardContent>
          </Card>

          {showFinishNotice && (
            <Card
              className={`shrink-0 rounded-md ${
                reachedHardLimit
                  ? "border-rose-200 bg-rose-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p
                    className={`text-sm font-bold ${
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
                      ? "정리하면 요약과 표현을 저장할 수 있습니다."
                      : "요약, 유용한 표현, 단어장에 넣을 어휘를 바로 뽑습니다."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!reachedHardLimit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFinishNoticeDismissed(true)}
                      className="border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                    >
                      조금 더 하기
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={finish}
                    disabled={finishDisabled}
                    className={reachedHardLimit ? "bg-rose-600 hover:bg-rose-700" : ""}
                  >
                    <Flag className="h-4 w-4" />
                    {summarizing ? "정리 중..." : "세션 종료"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {user && !active && !session && (
            <Card className="shrink-0 rounded-md border-slate-200 bg-white">
              <CardContent className="p-3 md:p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {MODES.map((item) => (
                      <Button
                        key={item.value}
                        type="button"
                        variant={mode === item.value ? "default" : "outline"}
                        size="sm"
                        disabled={starting}
                        onClick={() => changeMode(item.value)}
                        title={item.hint}
                        className="h-8 rounded-md"
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>

                  {mode === "tag" && tagLoading && (
                    <div className="flex gap-2">
                      <SkeletonBlock className="h-9 w-24 rounded-md" />
                      <SkeletonBlock className="h-9 w-24 rounded-md" />
                      <SkeletonBlock className="h-9 w-24 rounded-md" />
                    </div>
                  )}

                  {mode === "tag" && !tagLoading && usableTags.length === 0 && (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center">
                      <p className="text-sm font-semibold text-slate-700">
                        대화할 태그가 아직 없어요
                      </p>
                      <div className="mt-3 flex justify-center gap-2">
                        <Button type="button" size="sm" onClick={() => changeMode("general")}>
                          자유 주제
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => changeMode("opic")}
                        >
                          OPIc
                        </Button>
                      </div>
                    </div>
                  )}

                  {mode !== "tag" && (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                      {cards.map((card) => (
                        <button
                          key={card.label}
                          type="button"
                          disabled={starting}
                          onClick={() => start({ situation: card.situation, title: card.label })}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {card.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {mode === "tag" && usableTags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {usableTags.map((tag) => (
                        <button
                          key={tag.name}
                          type="button"
                          disabled={starting}
                          onClick={() => start({ tag: tag.name, title: `#${tag.name}` })}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          #{tag.name} <span className="text-xs text-slate-400">{tag.count}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {mode === "general" && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={freeTopic}
                        onChange={(event) => setFreeTopic(event.target.value)}
                        onKeyDown={(event) =>
                          event.key === "Enter" &&
                          freeTopic.trim() &&
                          start({ situation: freeTopic.trim(), title: freeTopic.trim() })
                        }
                        placeholder="직접 상황 입력"
                        className="h-10 bg-white"
                      />
                      <Button
                        type="button"
                        disabled={!freeTopic.trim() || starting}
                        onClick={() =>
                          start({ situation: freeTopic.trim(), title: freeTopic.trim() })
                        }
                        className="h-10 shrink-0"
                      >
                        시작
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="flex min-h-[320px] flex-col rounded-md border-slate-200 bg-white shadow-sm lg:min-h-0 lg:flex-1">
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <MessageScrollerProvider autoScroll defaultScrollPosition="end">
                <RoleplayScrollEffect signal={scrollSignal} />
                <MessageScroller className="min-h-0 flex-1">
                  <MessageScrollerViewport aria-label="롤플레잉 대화 기록">
                    <MessageScrollerContent
                      className="min-h-full px-3 py-3 md:px-4"
                      itemCount={scrollerItemCount}
                    >
                      {starting && (
                        <MessageScrollerItem messageId="roleplay-starting">
                          <div className="space-y-3">
                            <SkeletonBlock className="h-24 w-full rounded-md" />
                            <SkeletonBlock className="ml-auto h-24 w-5/6 rounded-md" />
                            <SkeletonBlock className="h-24 w-full rounded-md" />
                          </div>
                        </MessageScrollerItem>
                      )}
                      {!starting && !active && (
                        <MessageScrollerItem
                          messageId="roleplay-empty"
                          className="flex min-h-[320px] flex-1 items-center justify-center lg:min-h-full"
                        >
                          <div className="flex w-full items-center justify-center">
                            <EmptyState
                              title={user ? "상황을 골라 대화를 시작하세요" : "로그인이 필요합니다"}
                              description={
                                user
                                  ? "상단 또는 카드에서 시나리오를 선택하세요."
                                  : "로그인하면 원어민 AI와 영어로 대화할 수 있어요."
                              }
                            />
                          </div>
                        </MessageScrollerItem>
                      )}
                      {!starting &&
                        messages.map((message, index) => {
                          const isUserMessage = message.role === "user";
                          const canReplay = message.role === "bot" && message.text && !message.streaming;
                          return (
                            <MessageScrollerItem
                              key={`${message.role}-${index}`}
                              messageId={`roleplay-message-${index}`}
                              scrollAnchor={isUserMessage}
                            >
                              <div
                                className={`flex items-start gap-3 rounded-md border bg-white p-3 shadow-sm ${
                                  isUserMessage
                                    ? "border-brand-100"
                                    : "border-slate-200"
                                }`}
                              >
                                {isUserMessage ? (
                                  <div className="shrink-0">
                                    <MessageAvatar role="user" user={user} className="mt-0 h-10 w-10" />
                                  </div>
                                ) : (
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-amber-200 bg-amber-50 shadow-sm">
                                    <img
                                      src={tutorAvatar}
                                      alt=""
                                      aria-hidden="true"
                                      className="h-full w-full object-cover"
                                    />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="mb-1 flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-bold">
                                      {isUserMessage ? "You" : "Tutor"}
                                    </span>
                                    <span className="text-xs font-medium text-slate-400">
                                      {String(Math.floor((index + 1) / 2)).padStart(2, "0")}:
                                      {String(((index + 1) * 7) % 60).padStart(2, "0")}
                                    </span>
                                    {message.coaching && (
                                      <Badge
                                        variant="outline"
                                        className="ml-auto rounded-md border-rose-200 bg-rose-50 text-rose-600"
                                      >
                                        수정 제안 있음
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">
                                    {message.streaming && !message.text ? "답변 작성 중..." : message.text}
                                  </div>
                                  {message.coaching && (
                                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                                      {message.coaching}
                                    </div>
                                  )}
                                </div>
                                {canReplay && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => playAssistantVoice(message.text, { force: true })}
                                    className="h-9 w-9 shrink-0 rounded-full"
                                    aria-label="이 답변 다시 듣기"
                                    title="다시 듣기"
                                  >
                                    <Play className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </MessageScrollerItem>
                          );
                        })}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton>최근 답변 보기</MessageScrollerButton>
                </MessageScroller>
              </MessageScrollerProvider>
            </CardContent>
          </Card>

          {!summary && (
            <Card
              className={`shrink-0 rounded-md bg-white ${
                isVoiceTab && listening ? "border-rose-300 shadow-[0_0_0_1px_rgba(248,113,113,0.28)]" : "border-slate-200"
              }`}
            >
              <CardContent className="p-3">
                {isVoiceTab ? (
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                      <Button
                        type="button"
                        variant={listening ? "destructive" : "outline"}
                        onClick={listening ? stopListening : startListening}
                        disabled={!user || starting || streaming || reachedHardLimit}
                        className="h-10 shrink-0 rounded-md"
                      >
                        {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        {listening ? "녹음 중지" : "마이크 테스트"}
                      </Button>
                      <Input
                        value={voiceTranscript}
                        onChange={(event) => setVoiceTranscript(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && sendVoice()}
                        disabled={!user || !active || starting || streaming || reachedHardLimit}
                        placeholder={
                          reachedHardLimit
                            ? "대화를 마무리해주세요"
                            : active
                              ? "인식된 문장이 여기에 표시됩니다"
                              : "상황을 먼저 선택하세요"
                        }
                        className="h-10 flex-1 bg-white disabled:bg-slate-50"
                      />
                      <Button
                        type="button"
                        onClick={sendVoice}
                        disabled={
                          streaming ||
                          !user ||
                          !active ||
                          reachedHardLimit ||
                          !voiceTranscript.trim()
                        }
                        className="h-10 shrink-0 rounded-md"
                      >
                        <Send className="h-4 w-4" />
                        보내기
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setAutoSpeak((value) => !value)}
                        className="h-10 rounded-md"
                      >
                        {autoSpeak ? <Pause className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        {autoSpeak ? "일시정지" : "읽기 켬"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          speaking
                            ? stopSpeaking()
                            : playAssistantVoice(latestAssistantText, { force: true })
                        }
                        disabled={!latestAssistantText || streaming}
                        className="h-10 rounded-md"
                      >
                        {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        다시 듣기
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={resetConversation}
                        className="h-10 rounded-md"
                      >
                        <RotateCcw className="h-4 w-4" />
                        다시 고르기
                      </Button>
                      <Button
                        type="button"
                        variant={reachedCap || reachedHardLimit ? "default" : "outline"}
                        onClick={finish}
                        disabled={finishDisabled || !active}
                        className="h-10 rounded-md"
                      >
                        <Flag className="h-4 w-4" />
                        세션 종료
                      </Button>
                    </div>
                    {voiceNotice && !voiceError && (
                      <p className="text-xs font-medium text-emerald-600">{voiceNotice}</p>
                    )}
                    {voiceError && (
                      <p className="text-xs font-medium text-rose-600">{voiceError}</p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <Input
                      value={msg}
                      onChange={(event) => setMsg(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && send()}
                      disabled={!user || !active || starting || reachedHardLimit}
                      placeholder={
                        reachedHardLimit
                          ? "대화를 마무리해주세요"
                          : active
                            ? "영어로 대답하세요"
                            : "상황을 먼저 선택하세요"
                      }
                      className="h-11 flex-1 bg-white disabled:bg-slate-50"
                    />
                    <Button
                      type="button"
                      onClick={send}
                      disabled={sending || !user || !active || reachedHardLimit}
                      className="h-11 shrink-0 rounded-md px-5"
                    >
                      <Send className="h-4 w-4" />
                      보내기
                    </Button>
                    <Separator orientation="vertical" className="hidden h-8 md:block" />
                    <Button
                      type="button"
                      variant={reachedCap || reachedHardLimit ? "default" : "outline"}
                      onClick={finish}
                      disabled={finishDisabled || !active}
                      className="h-11 shrink-0 rounded-md"
                    >
                      <Flag className="h-4 w-4" />
                      세션 종료
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>

        <aside className="shrink-0 lg:min-h-0 lg:flex lg:shrink lg:flex-col">
          <Card className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-md border-slate-200 bg-white shadow-sm lg:min-h-0">
            <Tabs value={sideTab} onValueChange={setSideTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="m-3 mb-0 grid h-10 grid-cols-3 rounded-md bg-muted p-1">
                <TabsTrigger value="coach" className="rounded-sm text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  AI 코치
                </TabsTrigger>
                <TabsTrigger value="memo" className="rounded-sm text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  메모
                </TabsTrigger>
                <TabsTrigger value="notes" className="rounded-sm text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  학습 노트
                </TabsTrigger>
              </TabsList>

              <TabsContent value="coach" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
                <div className="space-y-3">
                  <section className="rounded-md border border-border bg-background p-3">
                    <div className="mb-3 flex items-center gap-2">
                      <Brain className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-bold">발음/표현 피드백</h3>
                    </div>
                    {coachingItems.length > 0 ? (
                      <div className="space-y-3">
                        {coachingItems.map((item) => (
                          <div
                            key={`coach-${item.index}`}
                            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
                          >
                            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-900">
                              <Sparkles className="h-3.5 w-3.5" />
                              최근 교정
                            </div>
                            <p className="whitespace-pre-wrap text-xs leading-5 text-amber-900">
                              {item.coaching}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed bg-muted/40 px-3 py-8 text-center text-sm text-muted-foreground">
                        교정이 생기면 여기에 표시됩니다.
                      </div>
                    )}
                  </section>

                  <section className="rounded-md border border-border bg-background p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-muted-foreground" />
                        <h3 className="text-sm font-bold">단어장에 저장</h3>
                      </div>
                      {summary && (
                        <Badge variant="outline" className="rounded-md border-emerald-200 text-emerald-700">
                          정리 완료
                        </Badge>
                      )}
                    </div>

                    {!summary && (
                      <div className="rounded-md border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                        세션을 종료하면 저장할 표현과 어휘를 선택할 수 있습니다.
                      </div>
                    )}

                    {summary && (
                      <div className="space-y-4">
                        {summary.summary && (
                          <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
                            <p className="mb-1 text-xs font-bold text-brand-700">대화 요약</p>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                              {summary.summary}
                            </p>
                          </div>
                        )}

                        {summary.expressions?.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold text-slate-500">유용한 표현</p>
                            {summary.expressions.map((expression, index) => (
                              <div
                                key={`expression-${index}`}
                                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                              >
                                <div className="font-semibold text-slate-900">{expression.en}</div>
                                {expression.ko && (
                                  <div className="mt-1 text-xs text-slate-500">{expression.ko}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {summary.vocab?.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-bold text-slate-500">어휘 선택</p>
                              <select
                                value={saveTag}
                                onChange={(event) => setSaveTag(event.target.value)}
                                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-brand-200"
                              >
                                <option value="">미지정</option>
                                {labels
                                  .filter((tag) => tag !== "미지정")
                                  .map((tag) => (
                                    <option key={tag} value={tag}>
                                      {tag}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            {summary.vocab.map((vocab, index) => (
                              <label
                                key={`vocab-${index}`}
                                className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                              >
                                <Checkbox
                                  checked={pickedVocab.has(index)}
                                  onCheckedChange={() => toggleVocab(index)}
                                  className="mt-1"
                                />
                                <span className="min-w-0">
                                  <span className="block font-semibold text-slate-900">
                                    {vocab.word}
                                  </span>
                                  {vocab.korean && (
                                    <span className="block text-xs text-slate-500">{vocab.korean}</span>
                                  )}
                                  {vocab.example && (
                                    <span className="block truncate text-xs text-slate-400">
                                      {vocab.example}
                                    </span>
                                  )}
                                </span>
                              </label>
                            ))}
                            <Button
                              type="button"
                              onClick={saveSelectedVocab}
                              disabled={saveWordsMutation.isPending || pickedVocab.size === 0}
                              className="w-full rounded-md"
                            >
                              {saveWordsMutation.isPending
                                ? "저장 중..."
                                : `선택한 ${pickedVocab.size}개 저장`}
                            </Button>
                            {savedCount != null && (
                              <p className="flex items-center gap-1 text-sm font-semibold text-emerald-600">
                                <CheckCircle2 className="h-4 w-4" />
                                {savedCount}개 저장됐어요.
                              </p>
                            )}
                          </div>
                        )}

                        <Button
                          type="button"
                          variant="outline"
                          onClick={resetConversation}
                          className="w-full rounded-md"
                        >
                          새 대화 시작
                        </Button>
                      </div>
                    )}
                  </section>
                </div>
              </TabsContent>

              <TabsContent value="memo" className="m-0 min-h-0 flex-1 p-3">
                <Textarea
                  value={memo}
                  onChange={(event) => setMemo(event.target.value)}
                  placeholder="대화 중 기억할 문장이나 피드백을 적어두세요."
                  className="h-full min-h-[420px] resize-none rounded-md bg-background"
                />
              </TabsContent>

              <TabsContent value="notes" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
                <LearningNotesTab user={user} />
              </TabsContent>
            </Tabs>
          </Card>
        </aside>
      </div>
    </div>
  );
}
