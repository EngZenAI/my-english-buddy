import {
  AlertTriangle,
  CheckCircle2,
  CircleArrowRight,
  Loader2,
} from "lucide-react";
import { Message } from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import { PROPOSE_DELETE_WORDS, isClientAgentAction } from "./actionTypes";
import { agentJobProgressPercent, isAgentJobActive } from "./constants";

export function AgentActionButton({ action, disabled, onRun }) {
  const danger = action.destructive || action.type === PROPOSE_DELETE_WORDS;
  const clientAction = isClientAgentAction(action);
  const Icon = clientAction ? CircleArrowRight : null;

  return (
    <button
      type="button"
      disabled={disabled}
      title={clientAction ? "화면 이동 또는 학습 시작" : "서버 작업 실행"}
      onClick={() => onRun(action)}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition",
        danger
          ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
          : clientAction
            ? "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {action.label}
    </button>
  );
}

export function AgentCardList({ cards = [] }) {
  if (!cards.length) return null;
  return (
    <div className="grid gap-2">
      {cards.map((card, index) => (
        <div key={`${card.title}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-sm font-semibold text-slate-900">{card.title}</div>
          {card.body && <div className="mt-1 text-xs leading-5 text-slate-600">{card.body}</div>}
        </div>
      ))}
    </div>
  );
}

export function AgentMessageList({ messages = [], user }) {
  return messages.map((item, index) => (
    <MessageScrollerItem
      key={item.id || `${item.role}-${index}`}
      messageId={item.id || `agent-message-${index}`}
      scrollAnchor={item.role === "user"}
    >
      <Message role={item.role === "user" ? "user" : "assistant"} user={user}>
        {item.role === "agent" ? (
          <div className="space-y-2 whitespace-normal">
            <div className="whitespace-pre-wrap">{item.message}</div>
            <AgentCardList cards={item.cards || []} />
            {Boolean(item.tool_results?.length) && (
              <div className="flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                서버 작업 결과가 반영되었습니다.
              </div>
            )}
          </div>
        ) : (
          item.message
        )}
      </Message>
    </MessageScrollerItem>
  ));
}

export function AgentTypingMessage({ user }) {
  return (
    <MessageScrollerItem messageId="agent-typing-message">
      <Message role="assistant" user={user} loading loadingLabel="" />
    </MessageScrollerItem>
  );
}

export function AgentJobProgress({ job }) {
  if (!job) return null;
  const active = isAgentJobActive(job);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center gap-2 font-medium text-slate-900">
        {active ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        )}
        {job.message || "Agent 작업"}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${agentJobProgressPercent(job)}%` }} />
      </div>
      {job.status === "failed" && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          {job.error || "작업 실패"}
        </div>
      )}
      {job.status === "completed" && job.result_json && (
        <div className="mt-2 text-xs leading-5 text-slate-600">
          단어 {job.result_json.word_count || 0}개 점검, 복습 예정 {job.result_json.due_review_count || 0}개
        </div>
      )}
    </div>
  );
}
