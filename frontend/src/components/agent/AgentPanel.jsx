import { useEffect, useRef, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import {
  AlertTriangle,
  BookOpenCheck,
  CircleHelp,
  ClipboardList,
  Loader2,
  MessageCircle,
  Minimize2,
  PencilLine,
  Send,
  Sparkles,
  Tags,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import englishBuddyLogo from "@/assets/english-buddy-logo.svg";
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
  AgentMessageList,
  AgentTypingMessage,
} from "./AgentUI";
import {
  PROPOSE_BULK_WORD_UPDATE,
  PROPOSE_DELETE_WORDS,
  PROPOSE_RENAME_LABEL,
} from "./actionTypes";
import { cleanAgentDisplayText } from "./displayText";
import { useAgent } from "./useAgent";
import { useFloatingWidget } from "./useFloatingWidget";

function AgentReaderPosition() {
  useMessageScrollerVisibility();
  return null;
}

const AGENT_MINIMIZED_KEY = "englishBuddy.agent.minimized";
const AGENT_POSITION_KEY = "englishBuddy.agent.launcherPosition";

const AGENT_HELP_ITEMS = [
  {
    Icon: ClipboardList,
    title: "오늘 학습 추천",
    body: "복습 예정 단어, 최근 학습 기록, 약점 단어를 보고 지금 할 일을 골라줍니다.",
    example: "예: 오늘 뭐 공부할까?",
    prompt: "오늘 뭐 공부할까?",
  },
  {
    Icon: BookOpenCheck,
    title: "퀴즈 바로 시작",
    body: "복습일이 지난 단어 또는 특정 태그를 기준으로 퀴즈 목표를 만들어줍니다.",
    example: "예: 복습할 단어로 퀴즈 시작해줘",
    prompt: "복습할 단어로 퀴즈 시작해줘",
  },
  {
    Icon: MessageCircle,
    title: "롤플레잉 추천",
    body: "상황 카드를 제안하고, 카드를 누르면 롤플레잉 탭으로 값이 넘어가 바로 시작됩니다.",
    example: "예: 롤플레잉 상황 추천해줘",
    prompt: "롤플레잉 상황 추천해줘",
  },
  {
    Icon: Tags,
    title: "단어장 정리",
    body: "태그 추가, 태그명 변경 제안, 단어장 점검 같은 정리 작업을 도와줍니다.",
    example: "예: 단어장 점검해줘",
    prompt: "단어장 점검해줘",
  },
  {
    Icon: Sparkles,
    title: "학습 기억 저장",
    body: "목표, 선호 주제, 자주 틀리는 패턴 같은 개인 학습 메모를 저장해 다음 추천에 반영합니다.",
    example: "예: 나는 비즈니스 회화를 우선 공부하고 싶어. 기억해줘",
    prompt: "내 영어 학습 목표를 기억해줘",
  },
];

function readMinimized() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AGENT_MINIMIZED_KEY) === "true";
}

function transformStyle(transform) {
  if (!transform) return undefined;
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`;
}

function describePendingAction(action) {
  const payload = action?.payload || {};
  if (action?.type === PROPOSE_DELETE_WORDS) {
    const count = Array.isArray(payload.ids) ? payload.ids.length : 0;
    return count ? `${count}개 단어가 단어장에서 삭제됩니다.` : "선택한 단어가 단어장에서 삭제됩니다.";
  }
  if (action?.type === PROPOSE_BULK_WORD_UPDATE) {
    const count = Array.isArray(payload.items) ? payload.items.length : 0;
    return count ? `${count}개 단어의 저장값이 변경됩니다.` : "단어장 저장값이 변경됩니다.";
  }
  if (action?.type === PROPOSE_RENAME_LABEL) {
    const oldName = payload.old_name || "기존 태그";
    const newName = payload.new_name || "새 태그";
    return `"${oldName}" 태그 이름이 "${newName}"(으)로 변경됩니다.`;
  }
  return "실행하면 변경 사항이 바로 반영됩니다.";
}

function pendingDialogCopy(action) {
  if (action?.type === PROPOSE_DELETE_WORDS) {
    return {
      Icon: AlertTriangle,
      title: "삭제 작업을 실행할까요?",
      description: "되돌릴 수 없는 작업입니다. 한번 더 확인해 주세요.",
      iconClass: "bg-amber-100 text-amber-700",
      boxClass: "border-amber-200 bg-amber-50 text-amber-950",
      detailClass: "text-amber-800",
      buttonClass: "bg-amber-700 text-white hover:bg-amber-800",
    };
  }
  if (action?.type === PROPOSE_BULK_WORD_UPDATE || action?.type === PROPOSE_RENAME_LABEL) {
    return {
      Icon: PencilLine,
      title: "변경 사항을 적용할까요?",
      description: "Agent가 제안한 수정값이 단어장에 바로 저장됩니다.",
      iconClass: "bg-teal-100 text-teal-700",
      boxClass: "border-teal-200 bg-teal-50 text-teal-950",
      detailClass: "text-teal-800",
      buttonClass: "bg-teal-700 text-white hover:bg-teal-800",
    };
  }
  return {
    Icon: AlertTriangle,
    title: "작업을 실행할까요?",
    description: "실행하면 변경 사항이 바로 반영됩니다.",
    iconClass: "bg-slate-100 text-slate-700",
    boxClass: "border-slate-200 bg-slate-50 text-slate-950",
    detailClass: "text-slate-700",
    buttonClass: "",
  };
}

function AgentHelpDialog({ open, busy, onOpenChange, onRequest }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CircleHelp className="h-4 w-4" />
            </span>
            Buddy Agent로 할 수 있는 일
          </DialogTitle>
          <DialogDescription>
            아래 작업은 Agent에게 바로 요청할 수 있습니다. 실행 전 확인이 필요한 변경은 한 번 더 물어봅니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          {AGENT_HELP_ITEMS.map(({ Icon, title, body, example, prompt }) => (
            <button
              key={title}
              type="button"
              disabled={busy}
              onClick={() => onRequest(prompt)}
              className="group rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 group-hover:bg-white group-hover:text-emerald-700">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{title}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">{body}</span>
                  <span className="mt-2 block rounded-md bg-slate-50 px-2 py-1.5 text-xs leading-5 text-slate-700">
                    {example}
                  </span>
                  <span className="mt-2 block text-xs font-medium text-emerald-700">요청하기</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
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
        "fixed z-40 flex h-14 w-14 touch-none items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700 shadow-lg will-change-transform hover:shadow-xl",
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
  const [helpOpen, setHelpOpen] = useState(false);
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
    pendingAction,
    hasNotice,
    busy,
    sendMessage,
    runAction,
    confirmPendingAction,
    cancelPendingAction,
    toggleOpen,
  } = useAgent({ user, currentTab, hidden, onRequireLogin, onAction });
  const sendFromPanel = (text) => {
    if (!text.trim() || busy) return;
    sendMessage(text);
  };
  const requestFromHelp = (text) => {
    setHelpOpen(false);
    setOpen(true);
    sendFromPanel(text);
  };
  const scrollerItemCount =
    messages.length +
    (busy ? 1 : 0) +
    (visibleActions.length ? 1 : 0) +
    (!messages.length ? 1 : 0) +
    (!messages.length && suggestions?.cards?.length ? 1 : 0);
  const pendingCopy = pendingDialogCopy(pendingAction);
  const PendingIcon = pendingCopy.Icon;

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
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white">
                <img
                  src={englishBuddyLogo}
                  alt=""
                  aria-hidden="true"
                  className="h-8 w-8"
                />
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-900">Buddy Agent</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                onClick={() => setHelpOpen(true)}
                aria-label="Buddy Agent 도움말"
                title="Agent로 할 수 있는 일"
              >
                <CircleHelp className="h-4 w-4" />
              </button>
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
                      <AgentCardList
                        cards={suggestions.cards}
                        actions={suggestions.actions || []}
                        disabled={busy || Boolean(pendingAction)}
                        onRun={runAction}
                      />
                    </MessageScrollerItem>
                  )}
                  <AgentMessageList
                    messages={messages}
                    user={user}
                    disabled={busy || Boolean(pendingAction)}
                    onRunAction={runAction}
                    latestJob={latestJob}
                  />
                  {busy && <AgentTypingMessage user={user} />}

                  {Boolean(visibleActions.length) && (
                    <MessageScrollerItem messageId="agent-visible-actions">
                      <div className="flex flex-wrap gap-2">
                        {visibleActions.map((action, index) => (
                          <AgentActionButton
                            key={`${action.type}-${action.label}-${index}`}
                            action={action}
                            disabled={busy || Boolean(pendingAction)}
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

      <AgentHelpDialog
        open={helpOpen}
        busy={busy}
        onOpenChange={setHelpOpen}
        onRequest={requestFromHelp}
      />

      <Dialog
        open={Boolean(pendingAction)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) cancelPendingAction();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${pendingCopy.iconClass}`}>
                <PendingIcon className="h-4 w-4" />
              </span>
              {pendingCopy.title}
            </DialogTitle>
            <DialogDescription>{pendingCopy.description}</DialogDescription>
          </DialogHeader>
          <div className={`rounded-lg border px-3 py-2.5 text-sm ${pendingCopy.boxClass}`}>
            <div className="font-semibold">{cleanAgentDisplayText(pendingAction?.label) || "Agent 작업"}</div>
            <div className={`mt-1 text-xs leading-5 ${pendingCopy.detailClass}`}>
              {describePendingAction(pendingAction)}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelPendingAction}>
              취소
            </Button>
            <Button
              type="button"
              onClick={confirmPendingAction}
              disabled={busy}
              className={pendingCopy.buttonClass}
            >
              실행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}
