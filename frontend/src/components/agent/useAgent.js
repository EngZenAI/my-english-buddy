import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { queryKeys } from "@/queryClient";
import {
  PROPOSE_BULK_WORD_UPDATE,
  PROPOSE_DELETE_WORDS,
  PROPOSE_RENAME_LABEL,
  isServerAgentTool,
} from "./actionTypes";
import { isAgentJobActive } from "./constants";

const CONFIRM_ACTION_TYPES = new Set([
  PROPOSE_BULK_WORD_UPDATE,
  PROPOSE_DELETE_WORDS,
  PROPOSE_RENAME_LABEL,
]);

const agentMessage = (message, extra = {}) => ({
  role: "agent",
  message,
  cards: [],
  actions: [],
  ...extra,
});

function compactAction(action) {
  return {
    type: action?.type || "",
    label: action?.label || "",
    payload: action?.payload && typeof action.payload === "object" ? action.payload : {},
  };
}

function buildRecentMessages(messages) {
  return messages.slice(-6).map((item) => ({
    role: item.role === "user" ? "user" : "agent",
    content: String(item.message || "").slice(0, 700),
    actions: item.role === "agent" ? (item.actions || []).slice(0, 4).map(compactAction) : [],
  })).filter((item) => item.content);
}

export function useAgent({ user, currentTab, hidden, onRequireLogin, onAction }) {
  const queryClient = useQueryClient();
  const messageSeqRef = useRef(0);
  const openRef = useRef(false);
  const userIdRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [jobId, setJobId] = useState("");
  const [hasUnreadNotice, setHasUnreadNotice] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const pendingActionRef = useRef(null);

  const createMessage = (role, data) => {
    messageSeqRef.current += 1;
    return {
      id: `agent-message-${Date.now()}-${messageSeqRef.current}`,
      role,
      ...data,
    };
  };

  const resetSession = () => {
    pendingActionRef.current = null;
    setPendingAction(null);
    setMessages([]);
    setInput("");
    setJobId("");
    setHasUnreadNotice(false);
  };

  useEffect(() => {
    openRef.current = open;
    if (open) setHasUnreadNotice(false);
  }, [open]);

  useEffect(() => {
    const userId = user?.id || "";
    if (userIdRef.current === null) {
      userIdRef.current = userId;
      return;
    }
    if (userIdRef.current === userId) return;
    userIdRef.current = userId;
    resetSession();
    setOpen(false);
  }, [user?.id]);

  const markUnreadIfClosed = () => {
    if (!openRef.current) setHasUnreadNotice(true);
  };

  const suggestionsQuery = useQuery({
    queryKey: queryKeys.agentSuggestions(user?.id || ""),
    queryFn: () => api.agentSuggestions(),
    enabled: Boolean(user) && !hidden,
    staleTime: 0,
  });

  const jobQuery = useQuery({
    queryKey: queryKeys.agentJob(jobId),
    queryFn: () => api.agentJob(jobId),
    enabled: Boolean(user && jobId),
    refetchInterval: (query) => (isAgentJobActive(query.state.data?.job) ? 1500 : false),
  });

  const chatMutation = useMutation({
    mutationFn: ({ message, tab, recentMessages }) => api.agentChat(message, tab, recentMessages),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, createMessage("agent", data)]);
      markUnreadIfClosed();
      if (data?.job_id) setJobId(data.job_id);
      queryClient.invalidateQueries({ queryKey: ["agent", "suggestions"] });
    },
    onError: (error, variables) => {
      setMessages((prev) => [
        ...prev,
        createMessage("agent", agentMessage(error?.message || "Agent 응답을 가져오지 못했어요.")),
      ]);
      setInput((current) => current || variables?.draftText || "");
      markUnreadIfClosed();
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (action) => api.agentConfirmAction(action),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, createMessage("agent", data)]);
      markUnreadIfClosed();
      if (data?.job_id) setJobId(data.job_id);
      queryClient.invalidateQueries({ queryKey: ["agent"] });
      queryClient.invalidateQueries({ queryKey: ["words"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
      queryClient.invalidateQueries({ queryKey: ["mypage"] });
    },
    onError: (error) => {
      setMessages((prev) => [
        ...prev,
        createMessage("agent", agentMessage(error?.message || "작업을 실행하지 못했어요.")),
      ]);
      markUnreadIfClosed();
    },
  });

  const suggestions = suggestionsQuery.data;
  const visibleActions = useMemo(() => {
    const latestAgentMessage = [...messages].reverse().find((item) => item.role === "agent");
    if (latestAgentMessage) return latestAgentMessage.actions || [];
    if (messages.length) return [];
    return suggestions?.actions || [];
  }, [messages, suggestions]);

  const sendMessage = (text) => {
    const clean = text.trim();
    if (!clean || chatMutation.isPending) return;
    if (!user) {
      onRequireLogin?.();
      return;
    }
    setMessages((prev) => [...prev, createMessage("user", { message: clean })]);
    setInput((current) => (current === text ? "" : current));
    chatMutation.mutate({
      message: clean,
      tab: currentTab,
      draftText: text,
      recentMessages: buildRecentMessages(messages),
    });
  };

  const runAction = (action) => {
    if (!user) {
      onRequireLogin?.();
      return;
    }
    if (pendingActionRef.current || confirmMutation.isPending) return;
    if (!isServerAgentTool(action)) {
      onAction?.(action);
      setMessages((prev) => [
        ...prev,
        createMessage("agent", agentMessage("요청한 화면으로 이동했어요.")),
      ]);
      return;
    }
    if (action.requires_confirmation || action.destructive || CONFIRM_ACTION_TYPES.has(action.type)) {
      pendingActionRef.current = action;
      setPendingAction(action);
      return;
    }
    confirmMutation.mutate(action);
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;
    const action = pendingAction;
    pendingActionRef.current = null;
    setPendingAction(null);
    confirmMutation.mutate(action);
  };

  const cancelPendingAction = () => {
    pendingActionRef.current = null;
    setPendingAction(null);
  };

  const toggleOpen = () => {
    if (!user) {
      onRequireLogin?.();
      return;
    }
    setOpen((value) => !value);
  };

  return {
    open,
    setOpen,
    input,
    setInput,
    messages,
    suggestions,
    suggestionsQuery,
    latestJob: jobQuery.data?.job,
    visibleActions,
    pendingAction,
    hasNotice: Boolean(user && !open && hasUnreadNotice),
    busy: chatMutation.isPending || confirmMutation.isPending,
    sendMessage,
    runAction,
    resetSession,
    confirmPendingAction,
    cancelPendingAction,
    toggleOpen,
  };
}
