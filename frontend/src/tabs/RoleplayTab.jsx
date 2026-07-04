import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mic, MicOff, RotateCcw, Send, Volume2, VolumeX } from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";
import LearningNotesTab from "./LearningNotesTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Message } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
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
  const [subTab, setSubTab] = useState("play"); // play | voice | notes
  const [level, setLevel] = useState("intermediate");
  const [mode, setMode] = useState("opic");
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [ttsSource, setTtsSource] = useState("idle"); // idle | generating | cache | generated | browser | error
  const [voiceError, setVoiceError] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [freeTopic, setFreeTopic] = useState("");
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
  const scrollerItemCount =
    messages.length + (starting ? 1 : 0) + (!starting && !active ? 1 : 0);

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
      const detail = error?.message
        ? ` (${error.message.replace(/\s+/g, " ").slice(0, 120)})`
        : "";
      if (fallbackStarted) {
        setVoiceError(`AI 음성 생성에 실패해 기기 내장 음성으로 재생 중입니다.${detail}`);
      } else {
        setTtsSource("error");
        setVoiceError(`AI 음성 생성에 실패했고, 이 브라우저는 기기 내장 음성도 지원하지 않아요.${detail}`);
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

  const startListening = () => {
    if (!user || !active || starting || streaming || reachedHardLimit) return;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("이 브라우저는 음성 인식을 지원하지 않아요. Chrome 또는 Edge에서 사용해주세요.");
      return;
    }
    stopSpeaking();
    setVoiceError("");
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
    setListening(true);
    recognition.start();
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

      {/* 롤플레잉 내부 탭: 대화 / 음성채팅 / 학습노트 */}
      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {[
          { id: "play", label: "대화하기" },
          { id: "voice", label: "음성채팅(Beta)" },
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

      {(subTab === "play" || subTab === "voice") && (
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
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              {LEVELS.find((l) => l.value === level)?.label}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              {MODES.find((m) => m.value === mode)?.label}
            </span>
            {session.title && (
              <span
                title={session.title}
                className="max-w-[220px] truncate rounded-full bg-brand-50 px-2 py-0.5 text-brand-700"
              >
                {session.title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!summary && !showFinishNotice && (
              <button
                onClick={finish}
                disabled={finishDisabled}
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
                disabled={finishDisabled}
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

      {isVoiceTab && !summary && (
        <div
          className={`mb-3 rounded-lg border px-4 py-3 ${
            voicePhase.tone === "destructive"
              ? "border-rose-200 bg-rose-50"
              : voicePhase.tone === "warning"
                ? "border-amber-200 bg-amber-50"
                : voicePhase.tone === "primary"
                  ? "border-brand-200 bg-brand-50"
                  : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p
                className={`text-sm font-semibold ${
                  voicePhase.tone === "destructive"
                    ? "text-rose-800"
                    : voicePhase.tone === "warning"
                      ? "text-amber-800"
                      : voicePhase.tone === "primary"
                        ? "text-brand-700"
                        : "text-slate-700"
                }`}
              >
                {voicePhase.title}
              </p>
              <p
                className={`mt-1 text-xs ${
                  voicePhase.tone === "destructive"
                    ? "text-rose-700"
                    : voicePhase.tone === "warning"
                      ? "text-amber-700"
                      : voicePhase.tone === "primary"
                        ? "text-brand-700"
                        : "text-slate-500"
                }`}
              >
                {voicePhase.description}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {speaking && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={stopSpeaking}
                  className="h-8"
                >
                  <VolumeX className="h-4 w-4" />
                  멈춤
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {isVoiceTab && (
        <p className="mb-1.5 text-xs font-medium text-slate-500">대화 기록</p>
      )}

      {/* ── 채팅 영역 ─────────────────────────────────────── */}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <RoleplayScrollEffect signal={scrollSignal} />
        <MessageScroller className={isVoiceTab ? "h-[280px]" : "h-[420px]"}>
          <MessageScrollerViewport aria-label="롤플레잉 대화 기록">
            <MessageScrollerContent className="min-h-full" itemCount={scrollerItemCount}>
              {starting && (
                <MessageScrollerItem messageId="roleplay-starting">
                  <div className="space-y-3">
                    <SkeletonBlock className="h-12 w-3/4 rounded-2xl" />
                    <SkeletonBlock className="ml-auto h-10 w-1/2 rounded-2xl" />
                    <SkeletonBlock className="h-16 w-5/6 rounded-2xl" />
                  </div>
                </MessageScrollerItem>
              )}
              {!starting && !active && (
                <MessageScrollerItem messageId="roleplay-empty">
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
                </MessageScrollerItem>
              )}
              {!starting &&
                messages.map((m, i) => {
                  const canReplay =
                    isVoiceTab && m.role === "bot" && m.text && !m.streaming;
                  return (
                    <MessageScrollerItem
                      key={`${m.role}-${i}`}
                      messageId={`roleplay-message-${i}`}
                      scrollAnchor={m.role === "user"}
                    >
                      <Message
                        role={m.role === "user" ? "user" : "assistant"}
                        user={user}
                        coaching={m.coaching}
                        loading={m.streaming && !m.text}
                      >
                        {canReplay ? (
                          <div className="flex items-start gap-2">
                            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                              {m.text}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => playAssistantVoice(m.text, { force: true })}
                              className="-mr-1 -mt-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                              aria-label="이 답변 다시 듣기"
                              title="다시 듣기"
                            >
                              <Volume2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          m.text
                        )}
                      </Message>
                    </MessageScrollerItem>
                  );
                })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton>최근 답변 보기</MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>

      {/* 입력창: 대화 시작 후에만 활성화 (정리 화면에선 숨김) */}
      {!summary && !isVoiceTab && (
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

      {!summary && isVoiceTab && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Button
              type="button"
              variant={listening ? "destructive" : "default"}
              onClick={listening ? stopListening : startListening}
              disabled={!user || !active || starting || streaming || reachedHardLimit}
              className="h-11 shrink-0"
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {listening ? "녹음 중지" : "말하기"}
            </Button>
            <Input
              value={voiceTranscript}
              onChange={(e) => setVoiceTranscript(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendVoice()}
              disabled={!user || !active || starting || streaming || reachedHardLimit}
              placeholder={
                reachedHardLimit
                  ? "토큰 보호를 위해 대화를 마무리해주세요"
                  : active
                    ? "인식된 문장이 여기에 표시됩니다"
                    : "위에서 상황을 먼저 선택하세요"
              }
              className="h-11 flex-1 bg-background disabled:bg-muted"
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
              className="h-11 shrink-0 px-4"
            >
              <Send className="h-4 w-4" />
              전송
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAutoSpeak((v) => !v)}
              className="h-11 shrink-0"
            >
              {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {autoSpeak ? "읽기 켬" : "읽기 끔"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                speaking ? stopSpeaking() : playAssistantVoice(latestAssistantText, { force: true })
              }
              disabled={!latestAssistantText || streaming}
              className="h-11 shrink-0"
            >
              {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {speaking ? "AI 멈춤" : "AI 다시 듣기"}
            </Button>
          </div>
          {voiceError && (
            <p className="mt-2 text-xs font-medium text-rose-600">{voiceError}</p>
          )}
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
