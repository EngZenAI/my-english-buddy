import { Search, BookOpen, PenLine, MessageCircle, User, LogIn, LogOut, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function ResponsiveNav({
  tabs,
  value,
  onChange,
  user,
  view,
  setView,
  onLogin,
  onLogout,
}) {
  const icons = {
    search: Search,
    wordbook: BookOpen,
    quiz: PenLine,
    roleplay: MessageCircle,
  };

  const isHome = view === "home";

  // 현재 뷰 타이틀 가져오기 (모바일 헤더용)
  const getMobileTitle = () => {
    if (isHome) return "English Buddy";
    if (view === "login") return "로그인";
    if (view === "signup") return "회원가입";
    if (view === "find-id") return "아이디 찾기";
    if (view === "forgot-password") return "비밀번호 찾기";
    if (view === "mypage") return "마이페이지";
    return "";
  };

  // 사용자 이니셜 구하기 (아바타용)
  const getUserInitials = () => {
    if (!user || !user.email) return "U";
    return user.email.substring(0, 2).toUpperCase();
  };

  return (
    <>
      {/* ========================================================================= */}
      {/* 1. PC/데스크톱 네비게이션: 좌측 사이드바 (md 이상에서만 노출) */}
      {/* ========================================================================= */}
      <aside className="hidden md:flex flex-col justify-between w-64 h-screen border-r bg-card p-5 shrink-0 select-none">
        <div className="flex flex-col gap-6">
          {/* 로고 영역 */}
          <div 
            onClick={() => setView("home")}
            className="flex items-center gap-2 px-2 cursor-pointer"
          >
            <Compass className="h-6 w-6 text-[#5c6bf2] stroke-[2.5]" />
            <span className="font-extrabold text-lg text-slate-800 dark:text-slate-100 tracking-tight">
              English Buddy
            </span>
          </div>

          {/* 탭 목록 */}
          <nav className="flex flex-col gap-1.5">
            {tabs.map((tab) => {
              const Icon = icons[tab.id] || Search;
              const isActive = isHome && value === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setView("home");
                    onChange(tab.id);
                  }}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-200 text-sm font-semibold ${
                    isActive
                      ? "bg-[#eff2fe] text-[#5c6bf2] dark:bg-indigo-950/40 dark:text-indigo-300"
                      : "text-slate-500 hover:text-slate-800 hover:bg-[#eff2fe]/30 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <Icon className={`h-4.5 w-4.5 ${isActive ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* 하단 유저 프로필 및 계정 관련 액션 */}
        <div className="border-t pt-4 flex flex-col gap-2">
          {user ? (
            <div className="flex flex-col gap-3">
              <div 
                onClick={() => setView("mypage")}
                className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors ${
                  view === "mypage" 
                    ? "bg-[#eff2fe] dark:bg-indigo-950/20" 
                    : "hover:bg-slate-50 dark:hover:bg-slate-900/50"
                }`}
              >
                <Avatar className="h-9 w-9 border border-[#eff2fe]">
                  <AvatarFallback className="bg-[#eff2fe] text-[#5c6bf2] text-xs font-bold">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-slate-400 font-medium">마이페이지</span>
                  <span className="text-sm text-slate-700 dark:text-slate-300 font-semibold truncate">
                    {user.email}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onLogout}
                className="w-full justify-start text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 gap-2 px-3 h-9 rounded-lg"
              >
                <LogOut className="h-4 w-4" />
                로그아웃
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={onLogin}
              className="w-full bg-[#5c6bf2] hover:bg-[#4958df] text-white shadow-sm flex items-center justify-center gap-2 py-2.5 h-10 rounded-xl font-bold text-sm transition-all"
            >
              <LogIn className="h-4 w-4" />
              로그인
            </Button>
          )}
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. 모바일 네비게이션: 상단 헤더 + 하단 탭 바 (md 미만에서만 노출) */}
      {/* ========================================================================= */}
      {/* 상단 미니 헤더 */}
      <header className="md:hidden sticky top-0 left-0 right-0 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 flex items-center justify-between z-40 select-none">
        <div className="flex items-center gap-2">
          {!isHome && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setView("home")}
              className="h-9 w-9 rounded-full"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <span className={`font-bold tracking-tight text-foreground ${isHome ? "text-lg text-[#5c6bf2] dark:text-indigo-400 font-extrabold" : "text-base"}`}>
            {getMobileTitle()}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {user ? (
            isHome && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setView("mypage")}
                className="h-9 w-9 rounded-full bg-slate-50 dark:bg-slate-900 border"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-[#eff2fe] text-[#5c6bf2] text-[10px] font-bold">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            )
          ) : (
            isHome && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onLogin}
                className="text-xs text-[#5c6bf2] hover:text-[#4958df] hover:bg-brand-50 gap-1 rounded-full px-3"
              >
                <LogIn className="h-3.5 w-3.5" />
                로그인
              </Button>
            )
          )}
        </div>
      </header>

      {/* 하단 고정 캡슐 탭 바 (ref/image.png 디자인 이식) */}
      <nav className="md:hidden fixed bottom-4 left-4 right-4 h-15 bg-white/95 dark:bg-slate-950/95 backdrop-blur border border-slate-100/80 rounded-full flex items-center justify-around z-45 shadow-[0_8px_30px_rgba(0,0,0,0.06)] px-2.5">
        {tabs.map((tab) => {
          const Icon = icons[tab.id] || Search;
          const isActive = isHome && value === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setView("home");
                onChange(tab.id);
              }}
              className={`flex items-center gap-1.5 py-2 px-3.5 rounded-full transition-all duration-300 ${
                isActive
                  ? "bg-[#eff2fe] text-[#5c6bf2] dark:bg-indigo-950/50 dark:text-indigo-300 font-extrabold scale-100"
                  : "text-slate-400 hover:text-slate-600 dark:text-slate-600 p-2"
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
              {isActive && <span className="text-[11px] tracking-tight">{tab.label}</span>}
            </button>
          );
        })}
      </nav>
    </>
  );
}

// Compass 아이콘
function Compass({ className, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}
