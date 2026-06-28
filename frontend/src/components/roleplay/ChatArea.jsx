import { useEffect, useRef } from "react";
import { Send, LogOut, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import MessageBubble from "./MessageBubble";

export default function ChatArea({
  session,
  messages,
  msg,
  setMsg,
  onSend,
  sendPending,
  onFinish,
  finishPending,
  onReset,
}) {
  const scrollRef = useRef(null);

  // 메시지가 추가될 때마다 최하단 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-[75vh] md:h-[80vh] border border-slate-100/90 rounded-2xl overflow-hidden bg-slate-50/30 shadow-sm animate-fadeIn">
      {/* 1. 채팅 헤더 */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between z-10">
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            회화 진행 중 • 레벨: {session?.level === "beginner" ? "입문" : session?.level === "advanced" ? "고급" : "중급"}
          </span>
          <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200 truncate">
            {session?.title || session?.scenario || "자유 대화"}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="h-8.5 text-xs rounded-xl border-slate-200 text-slate-500 hover:text-slate-700"
          >
            대화 리셋
          </Button>
          <Button
            onClick={onFinish}
            disabled={finishPending}
            className="h-8.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold gap-1 px-3 shadow"
          >
            <CheckCircle2 className="h-4 w-4" />
            {finishPending ? "종료 분석 중..." : "대화 완료"}
          </Button>
        </div>
      </div>

      {/* 2. 대화 말풍선 스크롤 영역 */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/20"
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} m={m} />
        ))}
        {sendPending && (
          <div className="flex justify-start mb-3 select-none animate-pulse pl-1.5">
            <span className="text-[10px] text-slate-400 font-bold">AI가 답변을 준비 중입니다...</span>
          </div>
        )}
      </div>

      {/* 3. 하단 메시지 입력창 */}
      <div className="bg-white border-t p-3 flex gap-2 items-center">
        <Input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="영어로 대화를 이어나가세요..."
          onKeyDown={(e) => e.key === "Enter" && !sendPending && onSend()}
          className="rounded-xl border-slate-200 focus-visible:ring-brand-500 flex-1 text-sm h-10.5 px-4"
        />
        <Button
          onClick={onSend}
          disabled={!msg.trim() || sendPending}
          className="bg-brand-600 hover:bg-brand-700 text-white rounded-xl h-10.5 w-10.5 p-0 flex items-center justify-center shadow hover:shadow-md shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
