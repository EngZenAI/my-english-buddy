import { useEffect, useRef, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import { Loader2, Minimize2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import englishBuddyLogo from "@/assets/english-buddy-logo-cat.png";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller";
import { AGENT_QUICK_PROMPTS } from "./constants";
import {
  AgentActionButton,
  AgentCardList,
  AgentJobProgress,
  AgentMessageList,
  AgentTypingMessage,
} from "./AgentUI";
import { useAgent } from "./useAgent";
import { useFloatingWidget } from "./useFloatingWidget";

function AgentReaderPosition() {
  useMessageScrollerVisibility();
  return null;
}

const AGENT_MINIMIZED_KEY = "englishBuddy.agent.minimized";
const AGENT_POSITION_KEY = "englishBuddy.agent.launcherPosition";

function readMinimized() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AGENT_MINIMIZED_KEY) === "true";
}

function transformStyle(transform) {
  if (!transform) return undefined;
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`;
}

function AgentLauncher({ style, dragging, hasNotice, onClick }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: "agent-launcher" });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      style={{
        ...style,
        transform: transformStyle(transform),
      }}
      className={[
        "fixed z-40 flex h-14 w-14 touch-none items-center justify-center rounded-full border border-slate-200 bg-white text-emerald-700 shadow-lg will-change-transform hover:shadow-xl",
        dragging || isDragging ? "cursor-grabbing" : "cursor-grab",
      ].join(" ")}
      aria-label="Buddy Agent 열기"
      {...attributes}
      {...listeners}
    >
      <img
        src={englishBuddyLogo}
        alt=""
        aria-hidden="true"
        className="h-10 w-10"
      />
      {hasNotice && <span className="absolute right-0 top-0 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white" />}
    </button>
  );
}

export default function AgentPanel({
  user,
  currentTab,
  onRequireLogin,
  onAction,
  hidden = false,
}) {
  const [minimized, setMinimized] = useState(readMinimized);
  const [dragging, setDragging] = useState(false);
  const suppressClickRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 2 },
    }),
  );
  const { launcherStyle, panelStyle, moveBy } = useFloatingWidget({
    storageKey: AGENT_POSITION_KEY,
  });
  const {
    open,
    setOpen,
    input,
    setInput,
    messages,
    suggestions,
    suggestionsQuery,
    latestJob,
    visibleActions,
    hasNotice,
    busy,
    sendMessage,
    runAction,
    toggleOpen,
  } = useAgent({ user, currentTab, hidden, onRequireLogin, onAction });
  const sendFromPanel = (text) => {
    if (!text.trim() || busy) return;
    sendMessage(text);
  };
  const scrollerItemCount =
    messages.length +
    (busy ? 1 : 0) +
    (latestJob ? 1 : 0) +
    (visibleActions.length ? 1 : 0) +
    (!messages.length ? 1 : 0) +
    (!messages.length && suggestions?.cards?.length ? 1 : 0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AGENT_MINIMIZED_KEY, minimized ? "true" : "false");
  }, [minimized]);

  const minimizeAgent = () => {
    setOpen(false);
    setMinimized(true);
  };

  const handleDragStart = () => {
    setDragging(true);
  };

  const handleDragEnd = (event) => {
    setDragging(false);
    const delta = event?.delta || { x: 0, y: 0 };
    if (Math.hypot(delta.x || 0, delta.y || 0) > 0) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 250);
      moveBy(delta);
    }
  };

  const handleDragCancel = () => {
    setDragging(false);
  };

  const handleLauncherClick = (event) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      return;
    }
    toggleOpen();
  };

  if (hidden) return null;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-20 right-3 z-40 flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-lg hover:bg-slate-50 md:bottom-6"
        aria-label="최소화된 Buddy Agent 복원"
      >
        <img src={englishBuddyLogo} alt="" aria-hidden="true" className="h-6 w-6" />
        Agent
      </button>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <AgentLauncher
        style={launcherStyle}
        dragging={dragging}
        hasNotice={hasNotice}
        onClick={handleLauncherClick}
      />

      {open && (
        <section
          style={panelStyle}
          className="fixed z-40 flex max-h-[34rem] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">Buddy Agent</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                onClick={minimizeAgent}
                aria-label="Buddy Agent 최소화"
                title="Agent 최소화"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                onClick={() => setOpen(false)}
                aria-label="Buddy Agent 닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <MessageScrollerProvider
            autoScroll
            defaultScrollPosition="last-anchor"
            scrollPreviousItemPeek={48}
          >
            <AgentReaderPosition />
            <MessageScroller className="min-h-0 flex-1 rounded-none border-0 bg-slate-50">
              <MessageScrollerViewport aria-label="Buddy Agent 대화 기록">
                <MessageScrollerContent className="space-y-0 p-4" itemCount={scrollerItemCount} aria-busy={busy}>
                  {!messages.length && (
                    <MessageScrollerItem messageId="agent-suggestions-message">
                      <div className="rounded-lg bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
                        {suggestionsQuery.isPending ? "학습 상태를 확인하고 있어요." : suggestions?.message || "무엇을 도와드릴까요?"}
                      </div>
                    </MessageScrollerItem>
                  )}

                  {!messages.length && Boolean(suggestions?.cards?.length) && (
                    <MessageScrollerItem messageId="agent-suggestions-cards">
                      <AgentCardList cards={suggestions.cards} />
                    </MessageScrollerItem>
                  )}
                  <AgentMessageList messages={messages} user={user} />
                  {busy && <AgentTypingMessage user={user} />}
                  {latestJob && (
                    <MessageScrollerItem messageId={`agent-job-${latestJob.id || latestJob.job_id || "latest"}`}>
                      <AgentJobProgress job={latestJob} />
                    </MessageScrollerItem>
                  )}

                  {Boolean(visibleActions.length) && (
                    <MessageScrollerItem messageId="agent-visible-actions">
                      <div className="flex flex-wrap gap-2">
                        {visibleActions.map((action, index) => (
                          <AgentActionButton
                            key={`${action.type}-${action.label}-${index}`}
                            action={action}
                            disabled={busy}
                            onRun={runAction}
                          />
                        ))}
                      </div>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton>
                {busy ? "응답 중... · " : ""}최근 답변 보기
              </MessageScrollerButton>
            </MessageScroller>
          </MessageScrollerProvider>

          <div className="border-t border-slate-200 bg-white p-3">
            <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
              {AGENT_QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={busy}
                  onClick={() => sendFromPanel(prompt)}
                  className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendFromPanel(input);
              }}
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Buddy에게 요청하기"
                className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
              <Button type="submit" size="icon" disabled={busy || !input.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        </section>
      )}
    </DndContext>
  );
}
