import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { queryKeys } from "@/queryClient";
import { isServerAgentTool } from "./actionTypes";
import { isAgentJobActive } from "./constants";

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
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [jobId, setJobId] = useState("");
  const [hasUnreadNotice, setHasUnreadNotice] = useState(false);

  const createMessage = (role, data) => {
    messageSeqRef.current += 1;
    return {
      id: `agent-message-${Date.now()}-${messageSeqRef.current}`,
      role,
      ...data,
    };
  };

  useEffect(() => {
    openRef.current = open;
    if (open) setHasUnreadNotice(false);
  }, [open]);

  const markUnreadIfClosed = () => {
    if (!openRef.current) setHasUnreadNotice(true);
  };

  const suggestionsQuery = useQuery({
    queryKey: queryKeys.agentSuggestions(user?.id || "", currentTab),
    queryFn: () => api.agentSuggestions(currentTab),
    enabled: Boolean(user) && !hidden,
    staleTime: 30_000,
  });

  const jobQuery = useQuery({
    queryKey: queryKeys.agentJob(jobId),
    queryFn: () => api.agentJob(jobId),
    enabled: Boolean(user && jobId),
    refetchInterval: (query) => (isAgentJobActive(query.state.data?.job) ? 1500 : false),
  });

  const chatMutation = useMutation({
    mutationFn: ({ message, recentMessages }) => api.agentChat(message, currentTab, recentMessages),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, createMessage("agent", data)]);
      markUnreadIfClosed();
      if (data?.job_id) setJobId(data.job_id);
      queryClient.invalidateQueries({ queryKey: ["agent", "suggestions"] });
    },
    onError: (error) => {
      setMessages((prev) => [
        ...prev,
        createMessage("agent", agentMessage(error?.message || "Agent 응답을 가져오지 못했어요.")),
      ]);
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
    setInput("");
    chatMutation.mutate({ message: clean, recentMessages: buildRecentMessages(messages) });
  };

  const runAction = (action) => {
    if (!user) {
      onRequireLogin?.();
      return;
    }
    if (!isServerAgentTool(action)) {
      onAction?.(action);
      setMessages((prev) => [
        ...prev,
        createMessage("agent", agentMessage("요청한 화면으로 이동했어요.")),
      ]);
      return;
    }
    if (action.destructive && !window.confirm("이 작업은 데이터를 삭제할 수 있습니다. 계속할까요?")) {
      return;
    }
    confirmMutation.mutate(action);
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
    hasNotice: Boolean(user && !open && hasUnreadNotice),
    busy: chatMutation.isPending || confirmMutation.isPending,
    sendMessage,
    runAction,
    toggleOpen,
  };
}
