import {
  AlertTriangle,
  CheckCircle2,
  CircleArrowRight,
  Info,
  Loader2,
  PencilLine,
  PlusCircle,
  Save,
  Tag,
  Trash2,
} from "lucide-react";
import { Message } from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import {
  ADD_LABEL,
  PROPOSE_BULK_WORD_UPDATE,
  PROPOSE_DELETE_WORDS,
  PROPOSE_RENAME_LABEL,
  SAVE_AGENT_MEMORY,
  SAVE_WORDS,
  START_AGENT_JOB,
  isClientAgentAction,
} from "./actionTypes";
import { agentJobProgressPercent, isAgentJobActive } from "./constants";
import { cleanAgentDisplayText } from "./displayText";

function actionButtonStyle(action) {
  if (action.type === PROPOSE_DELETE_WORDS) {
    return {
      Icon: Trash2,
      className: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
      title: "삭제 작업 실행",
    };
  }
  if (action.type === PROPOSE_BULK_WORD_UPDATE || action.type === PROPOSE_RENAME_LABEL) {
    return {
      Icon: PencilLine,
      className: "border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100",
      title: "변경 사항 적용",
    };
  }
  if (action.destructive) {
    return {
      Icon: AlertTriangle,
      className: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
      title: "주의가 필요한 작업 실행",
    };
  }
  if (action.type === ADD_LABEL) {
    return {
      Icon: Tag,
      className: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
      title: "태그 추가",
    };
  }
  if (action.type === SAVE_WORDS || action.type === SAVE_AGENT_MEMORY) {
    return {
      Icon: Save,
      className: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
      title: "저장",
    };
  }
  if (action.type === START_AGENT_JOB) {
    return {
      Icon: PlusCircle,
      className: "border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100",
      title: "Agent 작업 시작",
    };
  }
  if (isClientAgentAction(action)) {
    return {
      Icon: CircleArrowRight,
      className: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100",
      title: "화면 이동 또는 학습 시작",
    };
  }
  return {
    Icon: Info,
    className: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    title: "서버 작업 실행",
  };
}

export function AgentActionButton({ action, disabled, onRun }) {
  const style = actionButtonStyle(action);
  const Icon = style.Icon;
  const label = cleanAgentDisplayText(action.label);

  return (
    <button
      type="button"
      disabled={disabled}
      title={style.title}
      onClick={() => onRun(action)}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition",
        style.className,
        disabled ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

function cardAction(card, actions, index, cardCount) {
  if (card?.action && typeof card.action === "object") return card.action;
  if (card?.payload?.action && typeof card.payload.action === "object") return card.payload.action;
  if (actions.length !== cardCount) return null;
  return actions[index] || null;
}

export function AgentCardList({ cards = [], actions = [], disabled = false, onRun }) {
  if (!cards.length) return null;
  return (
    <div className="grid gap-2">
      {cards.map((card, index) => {
        const action = cardAction(card, actions, index, cards.length);
        const clickable = Boolean(action && onRun);
        const content = (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-sm font-semibold text-slate-900">{cleanAgentDisplayText(card.title)}</div>
              {clickable && <CircleArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />}
            </div>
            {card.body && (
              <div className="mt-1 text-xs leading-5 text-slate-600">
                {cleanAgentDisplayText(card.body)}
              </div>
            )}
          </>
        );

        if (!clickable) {
          return (
            <div key={`${card.title}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
              {content}
            </div>
          );
        }

        return (
          <button
            key={`${card.title}-${index}`}
            type="button"
            disabled={disabled}
            onClick={() => onRun(action)}
            className="rounded-lg border border-sky-100 bg-white p-3 text-left transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

export function AgentMessageList({ messages = [], user, disabled = false, onRunAction, latestJob = null }) {
  return messages.map((item, index) => (
    <MessageScrollerItem
      key={item.id || `${item.role}-${index}`}
      messageId={item.id || `agent-message-${index}`}
      scrollAnchor={item.role === "user"}
    >
      <Message role={item.role === "user" ? "user" : "assistant"} user={user}>
        {item.role === "agent" ? (
          <div className="space-y-2 whitespace-normal">
            <div className="whitespace-pre-wrap">{cleanAgentDisplayText(item.message)}</div>
            <AgentCardList
              cards={item.cards || []}
              actions={item.actions || []}
              disabled={disabled}
              onRun={onRunAction}
            />
            {item.job_id && latestJob?.id === item.job_id && (
              <AgentJobProgress job={latestJob} inline />
            )}
            {Boolean(item.tool_results?.length) && (
              <div className="flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                결과가 반영되었습니다.
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

function auditCount(result, key, fallbackListKey) {
  const value = Number(result?.[key] || 0);
  if (value) return value;
  const items = result?.[fallbackListKey];
  return Array.isArray(items) ? items.length : 0;
}

function auditPreview(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .slice(0, 5)
    .map((item) => item?.word)
    .filter(Boolean)
    .join(", ");
}

function WordbookAuditResult({ result, inline = false }) {
  const wordCount = Number(result?.word_count || 0);
  const dueCount = Number(result?.due_review_count || 0);
  const missingExampleCount = auditCount(result, "missing_example_count", "missing_examples");
  const missingDefinitionCount = auditCount(result, "missing_definition_count", "missing_definitions");
  const untaggedCount = auditCount(result, "untagged_count", "untagged_words");
  const issueCount = missingExampleCount + missingDefinitionCount + untaggedCount;
  const items = [
    { label: "전체 단어", value: wordCount },
    { label: "복습 예정", value: dueCount },
    { label: "예문 없음", value: missingExampleCount },
    { label: "영어뜻 없음", value: missingDefinitionCount },
    { label: "미지정 태그", value: untaggedCount },
  ];
  const previews = [
    ["예문 보강", auditPreview(result?.missing_examples)],
    ["뜻 보강", auditPreview(result?.missing_definitions)],
    ["태그 정리", auditPreview(result?.untagged_words)],
  ].filter(([, value]) => value);

  return (
    <div className={inline ? "mt-3 border-t border-slate-100 pt-3" : "mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3"}>
      <div className="text-xs font-semibold text-emerald-950">단어장 상태</div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className={inline ? "rounded-md bg-slate-50 px-2.5 py-2" : "rounded-md border border-white/80 bg-white px-2.5 py-2"}>
            <div className="text-[11px] font-medium text-slate-500">{item.label}</div>
            <div className="mt-0.5 text-sm font-bold text-slate-950">{item.value}개</div>
          </div>
        ))}
      </div>
      {previews.length > 0 && (
        <div className="mt-3 space-y-1.5 text-xs leading-5 text-slate-700">
          {previews.map(([label, value]) => (
            <div key={label}>
              <span className="font-semibold text-slate-900">{label}: </span>
              {value}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 text-xs leading-5 text-emerald-800">
        {issueCount
          ? "예문, 영어뜻, 태그가 비어 있는 단어부터 정리하면 퀴즈와 롤플레잉 품질이 좋아집니다."
          : "빈 예문, 영어뜻, 미지정 태그가 없어 현재 단어장 상태가 좋습니다."}
      </div>
    </div>
  );
}

export function AgentJobProgress({ job, inline = false }) {
  if (!job) return null;
  const active = isAgentJobActive(job);
  const failed = job.status === "failed";
  return (
    <div className={inline ? "text-sm" : "rounded-lg border border-slate-200 bg-white p-3 text-sm"}>
      <div className={`flex items-center gap-2 font-medium ${failed ? "text-red-700" : "text-slate-900"}`}>
        {active ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : failed ? (
          <AlertTriangle className="h-4 w-4 text-red-600" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        )}
        {job.message || "Agent 작업"}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full transition-all ${failed ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${agentJobProgressPercent(job)}%` }}
        />
      </div>
      {job.status === "failed" && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          {job.error || "작업 실패"}
        </div>
      )}
      {job.status === "completed" && job.result_json && <WordbookAuditResult result={job.result_json} inline={inline} />}
    </div>
  );
}
