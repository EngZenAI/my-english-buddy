export const REALTIME_IDLE_TIMEOUT_MS = 60_000;
export const REALTIME_MAX_CONNECTION_MS = 55 * 60_000;
export const REALTIME_DISCONNECT_GRACE_MS = 5_000;
export const REALTIME_CONNECT_TIMEOUT_MS = 15_000;

export function buildRealtimeHistoryEvents(messages) {
  return (messages || [])
    .filter(
      (message) =>
        (message?.role === "user" || message?.role === "bot") &&
        message.text?.trim() &&
        !message.streaming &&
        !message.interrupted,
    )
    .map((message) => ({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: message.role === "bot" ? "assistant" : "user",
        content: [
          {
            type: message.role === "bot" ? "output_text" : "input_text",
            text: message.text.trim(),
          },
        ],
      },
    }));
}

export function realtimeErrorInfo(error) {
  const detail = error?.detail;
  if (detail && typeof detail === "object") {
    return {
      code: detail.code || "realtime_unavailable",
      message: detail.message || "음성 대화에 연결하지 못했습니다.",
      retryable: detail.retryable !== false,
      requestId: detail.request_id || "",
    };
  }
  return {
    code: "realtime_unavailable",
    message: error?.message || "음성 대화에 연결하지 못했습니다.",
    retryable: true,
    requestId: "",
  };
}

export function cleanupRealtimeResources(resources) {
  if (!resources || resources.cleaned) return false;
  resources.cleaned = true;

  resources.abortController?.abort?.();
  if (resources.channel) {
    resources.channel.onopen = null;
    resources.channel.onmessage = null;
    resources.channel.onerror = null;
    resources.channel.onclose = null;
    resources.channel.close?.();
  }
  if (resources.peer) {
    resources.peer.ontrack = null;
    resources.peer.onconnectionstatechange = null;
    resources.peer.oniceconnectionstatechange = null;
    resources.peer.close?.();
  }
  resources.mediaStream?.getTracks?.().forEach((track) => track.stop());
  if (resources.audio) {
    resources.audio.onplaying = null;
    resources.audio.onpause = null;
    resources.audio.pause?.();
    resources.audio.srcObject = null;
  }
  return true;
}
