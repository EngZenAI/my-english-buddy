import { describe, expect, it, vi } from "vitest";
import {
  REALTIME_DISCONNECT_GRACE_MS,
  REALTIME_CONNECT_TIMEOUT_MS,
  REALTIME_IDLE_TIMEOUT_MS,
  REALTIME_MAX_CONNECTION_MS,
  buildRealtimeHistoryEvents,
  cleanupRealtimeResources,
  realtimeErrorInfo,
} from "./realtimeRoleplay";

describe("Realtime roleplay lifecycle helpers", () => {
  it("uses the agreed idle, disconnect, and maximum connection limits", () => {
    expect(REALTIME_IDLE_TIMEOUT_MS).toBe(60_000);
    expect(REALTIME_DISCONNECT_GRACE_MS).toBe(5_000);
    expect(REALTIME_CONNECT_TIMEOUT_MS).toBe(15_000);
    expect(REALTIME_MAX_CONNECTION_MS).toBe(55 * 60_000);
  });

  it("restores only complete conversation messages in chronological order", () => {
    const events = buildRealtimeHistoryEvents([
      { role: "user", text: "Hello" },
      { role: "bot", text: "Hi there" },
      { role: "bot", text: "partial", streaming: true },
      { role: "bot", text: "interrupted", interrupted: true },
      { role: "user", text: "   " },
      { role: "system", text: "hidden" },
    ]);

    expect(events).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      },
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hi there" }],
        },
      },
    ]);
  });

  it("cleans every WebRTC resource exactly once", () => {
    const abort = vi.fn();
    const channelClose = vi.fn();
    const peerClose = vi.fn();
    const trackStop = vi.fn();
    const audioPause = vi.fn();
    const resources = {
      abortController: { abort },
      channel: { close: channelClose, onopen: vi.fn(), onmessage: vi.fn() },
      peer: { close: peerClose, ontrack: vi.fn(), onconnectionstatechange: vi.fn() },
      mediaStream: { getTracks: () => [{ stop: trackStop }] },
      audio: { pause: audioPause, srcObject: {} },
      cleaned: false,
    };

    expect(cleanupRealtimeResources(resources)).toBe(true);
    expect(cleanupRealtimeResources(resources)).toBe(false);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(channelClose).toHaveBeenCalledTimes(1);
    expect(peerClose).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(audioPause).toHaveBeenCalledTimes(1);
    expect(resources.audio.srcObject).toBeNull();
  });

  it("keeps structured bootstrap errors for retry UI", () => {
    expect(
      realtimeErrorInfo({
        detail: {
          code: "realtime_unavailable",
          message: "다시 시도해주세요.",
          retryable: true,
          request_id: "req_123",
        },
      }),
    ).toEqual({
      code: "realtime_unavailable",
      message: "다시 시도해주세요.",
      retryable: true,
      requestId: "req_123",
    });
  });
});
