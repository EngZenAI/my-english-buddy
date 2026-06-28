import { Volume2, Lightbulb } from "lucide-react";
import AudioButton from "@/components/AudioButton";

export default function MessageBubble({ m }) {
  const isUser = m.role === "user";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"} mb-4.5 select-none animate-fadeIn`}>
      <div className={`flex flex-col max-w-[75%] ${isUser ? "items-end" : "items-start"} gap-1.5`}>
        {/* 발신자 이름 표시 */}
        <span className="text-[9px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">
          {isUser ? "YOU" : "AI BUDDY"}
        </span>

        {/* 꼬리가 달린 팝 메신저 말풍선 본체 (ref/image copy 4.png 디자인 이식) */}
        <div
          className={`relative px-4.5 py-3 rounded-[20px] shadow-[0_2px_12px_rgba(0,0,0,0.015)] leading-relaxed text-xs ${
            isUser
              ? "bg-[#5c6bf2] text-white rounded-tr-none bubble-tail-right"
              : "bg-[#eff2fe] dark:bg-slate-900 border-0 text-slate-800 dark:text-slate-100 rounded-tl-none bubble-tail-left"
          }`}
        >
          <div className="flex justify-between items-start gap-4">
            <div className="flex flex-col min-w-0">
              <span className="whitespace-pre-wrap font-semibold tracking-tight">{m.text}</span>
              
              {/* 봇 메시지 하단에 한국어 해석/코칭 은은하게 오버레이 (ref 이미지 감성) */}
              {!isUser && m.coaching && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 leading-normal font-semibold border-t border-slate-200/40 pt-1 flex items-start gap-1">
                  <Lightbulb className="h-3 w-3 shrink-0 mt-0.5 text-indigo-400 fill-indigo-100" />
                  {m.coaching}
                </span>
              )}
            </div>
            
            {/* 음성 발음 버튼 */}
            <div className="shrink-0 pt-0.5 opacity-80 hover:opacity-100 transition-opacity">
              <AudioButton word={m.text} lang="en" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
