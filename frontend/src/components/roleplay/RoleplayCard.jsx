import { Compass, Sparkles, BookOpen, AlertCircle, MessageSquare, HelpCircle, PhoneCall, Hotel, Milestone, Receipt, CalendarRange, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// 상황극 카드별 아이콘 매핑 (데코레이션용)
const CARD_DECO_ICONS = {
  "예약 미루기 📞": PhoneCall,
  "hotel front desk 🏨": Hotel,
  "친구와 약속 변경 🗓️": CalendarRange,
  "환불 요청 🛍️": Receipt,
  "식당 예약 🍽️": Milestone,
  "길 안내 받기 🗺️": MapPinned,
};

export default function RoleplayCard({
  levels,
  selectedLevel,
  setSelectedLevel,
  modes,
  selectedMode,
  setSelectedMode,
  cards,
  onStartRoleplay,
  usableTags,
  tagLoading,
  freeTopic,
  setFreeTopic,
  onStartFreeTopic,
  user,
}) {
  return (
    <div className="space-y-6 select-none animate-fadeIn">
      {/* 1. 레벨 & 모드 설정 바 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4.5 bg-slate-50/50 dark:bg-slate-900/30 rounded-[20px] border border-slate-100/80">
        {/* 난이도 레벨 */}
        <div className="space-y-1.5 flex-1">
          <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">회화 레벨 설정</label>
          <div className="flex gap-1.5">
            {levels.map((lvl) => (
              <button
                key={lvl.value}
                onClick={() => setSelectedLevel(lvl.value)}
                className={`h-8.5 px-4 rounded-full text-xs font-bold transition-all ${
                  selectedLevel === lvl.value
                    ? "bg-[#5c6bf2] text-white shadow-sm"
                    : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 dark:bg-slate-950"
                }`}
              >
                {lvl.label}
              </button>
            ))}
          </div>
        </div>

        {/* 대화 모드 */}
        <div className="space-y-1.5 flex-1">
          <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">주제 카테고리</label>
          <div className="flex gap-1.5">
            {modes.map((md) => (
              <button
                key={md.value}
                onClick={() => setSelectedMode(md.value)}
                className={`h-8.5 px-4 rounded-full text-xs font-bold transition-all ${
                  selectedMode === md.value
                    ? "bg-[#5c6bf2] text-white shadow-sm"
                    : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 dark:bg-slate-950"
                }`}
                title={md.hint}
              >
                {md.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. 조건별 카드/입력 화면 렌더링 */}
      {selectedMode === "general" && (
        <Card className="shadow-sm border-slate-100 rounded-[24px] p-5 space-y-3.5 animate-fadeIn">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Compass className="h-4 w-4 text-[#5c6bf2]" />
              자유 대화 상황 설정
            </label>
            <textarea
              rows={3}
              value={freeTopic}
              onChange={(e) => setFreeTopic(e.target.value)}
              placeholder="예: 커피숍에서 직원에게 디카페인 아이스 라떼 주문하고 휘핑 추가하기"
              className="w-full rounded-2xl border border-slate-200 px-3.5 py-3 text-xs outline-none focus:ring-1 focus:ring-[#5c6bf2] resize-none leading-relaxed bg-background"
            />
          </div>
          <Button
            onClick={onStartFreeTopic}
            disabled={!freeTopic.trim() || !user}
            className="w-full h-11 bg-[#5c6bf2] hover:bg-[#4958df] text-white rounded-full text-xs font-bold shadow"
          >
            🚀 자유 주제 대화 시작하기
          </Button>
        </Card>
      )}

      {selectedMode === "tag" && (
        <div className="space-y-3 animate-fadeIn">
          <h4 className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-[#5c6bf2]" />
            내 단어장 태그 기반 대화 (학습한 단어가 최소 1개 이상인 태그)
          </h4>
          
          {tagLoading ? (
            <div className="flex gap-2">
              <div className="h-8 w-16 bg-slate-100 rounded-full animate-pulse" />
              <div className="h-8 w-20 bg-slate-100 rounded-full animate-pulse" />
            </div>
          ) : usableTags.length === 0 ? (
            <Card className="border-dashed border-slate-200 bg-slate-50/20 rounded-[24px] flex flex-col items-center justify-center p-8 text-center min-h-[150px]">
              <AlertCircle className="h-8 w-8 text-slate-300 mb-2" />
              <h5 className="font-semibold text-slate-700 text-xs">사용할 수 있는 태그가 없습니다</h5>
              <p className="text-[10px] text-slate-400 mt-1 max-w-xs leading-normal">
                단어장에 태그를 지정하여 단어를 등록한 후 이용 가능합니다. (미지정 제외)
              </p>
            </Card>
          ) : (
            <div className="flex flex-wrap gap-2">
              {usableTags.map((tag) => (
                <button
                  key={tag.name}
                  onClick={() => onStartRoleplay(tag.name, `tag:${tag.name}`)}
                  className="rounded-full bg-white hover:bg-brand-50 border border-slate-200 hover:border-brand-200 text-slate-700 hover:text-brand-700 px-4.5 h-9.5 text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
                >
                  <span>🏷️ {tag.name}</span>
                  <Badge variant="secondary" className="bg-slate-100 hover:bg-slate-100 text-slate-500 text-[9px] font-bold px-1.5 py-0">
                    {tag.count}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedMode === "opic" && (
        <div className="space-y-3.5 animate-fadeIn">
          <h4 className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[#5c6bf2] fill-indigo-100" />
            상황극 시나리오 목록
          </h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {cards.map((card, idx) => {
              const DecoIcon = CARD_DECO_ICONS[card.label] || HelpCircle;
              // 진행률 값 예시 생성 (ref 디자인 100% 매칭)
              const fakeProgress = idx % 2 === 0 ? "01/30" : "00/30";

              return (
                <Card
                  key={card.label}
                  onClick={() => onStartRoleplay(card.label, card.situation)}
                  className="relative cursor-pointer overflow-hidden rounded-[24px] border-0 bg-gradient-to-br from-[#5c6bf2] to-[#7f8dfd] text-white hover:scale-[1.01] hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-300 p-6 flex flex-col justify-between min-h-[140px] h-full"
                >
                  {/* 카드 데코 일러스트 아이콘 오버레이 */}
                  <div className="absolute -right-3 -bottom-3 opacity-[0.12] pointer-events-none">
                    <DecoIcon className="h-28 w-28 text-white stroke-[1.8]" />
                  </div>

                  {/* 캡슐 진행도 배지 */}
                  <div className="flex justify-between items-start">
                    <span className="font-extrabold text-sm tracking-tight leading-normal max-w-[70%]">
                      {card.label}
                    </span>
                    <span className="bg-white/20 dark:bg-black/20 text-white rounded-full text-[9px] font-bold px-2 py-0.5 tracking-wider backdrop-blur-sm">
                      {fakeProgress}
                    </span>
                  </div>
                  
                  {/* 하단 시작 버튼 */}
                  <div className="mt-6 flex justify-start">
                    <button
                      type="button"
                      className="bg-white hover:bg-slate-50 text-[#5c6bf2] font-extrabold text-[11px] px-5.5 py-1.5 rounded-full shadow-sm transition-all"
                    >
                      Start
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
