import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  FileText,
  LogIn,
  LogOut,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import englishBuddyLogo from "@/assets/english-buddy-logo-cat.png";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "englishBuddy.sidebarCollapsed";

const tabIcons = {
  search: Search,
  wordbook: BookMarked,
  articles: FileText,
  roleplay: MessagesSquare,
  quiz: ClipboardCheck,
};

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
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Persistence is optional; keep rendering if storage is blocked.
    }
  }, [collapsed]);

  const isHome = view === "home";

  // 현재 뷰 타이틀 가져오기 (모바일 헤더용)
  const getMobileTitle = () => {
    if (isHome) return "English Buddy";
    if (view === "login") return "로그인";
    if (view === "signup") return "회원가입";
    if (view === "forgot-password") return "비밀번호 찾기";
    if (view === "mypage") return "마이페이지";
    if (view === "auth-complete") return "로그인 완료";
    if (view === "admin") return "관리자";
    return "";
  };

  // 사용자 이니셜 구하기 (아바타용)
  const getUserInitials = () => {
    if (!user || !user.email) return "U";
    return user.email.substring(0, 2).toUpperCase();
  };

  const navItems = tabs.map((tab) => {
    return tab;
  });

  const goHome = () => setView("home");

  return (
    <>
      {/* ========================================================================= */}
      {/* 1. PC/데스크톱 네비게이션: 좌측 사이드바 (md 이상에서만 노출) */}
      {/* ========================================================================= */}
      <aside
        className={cn(
          "relative hidden h-dvh shrink-0 select-none flex-col justify-between overflow-hidden border-r border-[#e1ddd4] bg-[#f6f3ee] text-slate-700 shadow-[18px_0_40px_rgba(99,88,72,0.08)] transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-20" : "w-[290px]"
        )}
      >
        <div className={cn("relative flex min-h-0 flex-1 flex-col", collapsed ? "px-3 py-5" : "px-5 py-6")}>
          <div className={cn("mb-8 flex items-center", collapsed ? "justify-center" : "justify-between gap-3")}>
            {collapsed ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCollapsed(false)}
                className="h-10 w-10 rounded-lg text-slate-500 hover:bg-white hover:text-slate-900"
                aria-label="사이드바 펼치기"
                title="사이드바 펼치기"
              >
                <PanelLeftOpen className="h-5 w-5" />
              </Button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goHome}
                  className="flex min-w-0 items-center gap-3 rounded-lg text-left outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#2f7d73]/30"
                  title="English Buddy"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                    <img
                      src={englishBuddyLogo}
                      alt=""
                      aria-hidden="true"
                      className="block h-10 w-10 drop-shadow-[0_8px_18px_rgba(47,125,115,0.18)]"
                      draggable="false"
                    />
                  </span>
                  <span className="truncate text-xl font-extrabold tracking-tight text-slate-900">
                    English Buddy
                  </span>
                </button>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setCollapsed(true)}
                  className="h-9 w-9 shrink-0 rounded-lg text-slate-500 hover:bg-white hover:text-slate-900"
                  aria-label="사이드바 접기"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>

          <nav className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden pr-0.5">
            {navItems.map((tab) => {
              const Icon = tabIcons[tab.id] || Search;
              const isActive = isHome && value === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  title={collapsed ? tab.label : undefined}
                  onClick={() => {
                    setView("home");
                    onChange(tab.id);
                  }}
                  className={cn(
                    "group flex h-12 items-center rounded-xl text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#2f7d73]/30",
                    collapsed ? "justify-center px-0" : "gap-3 px-4",
                    isActive
                      ? "bg-white text-[#2f7d73] shadow-sm ring-1 ring-[#e7e1d7]"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-950"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                      isActive ? "bg-[#e7f3ef] text-[#2f7d73]" : "text-slate-500 group-hover:text-slate-900"
                    )}
                  >
                    <Icon className={cn("h-5 w-5", isActive ? "stroke-[2.4]" : "stroke-[1.9]")} />
                  </span>
                  {!collapsed && <span className="truncate">{tab.label}</span>}
                  {!collapsed && isActive && <ChevronRight className="ml-auto h-4 w-4 text-[#2f7d73]/70" />}
                </button>
              );
            })}
          </nav>
        </div>

        <div className={cn("relative border-t border-[#e1ddd4]", collapsed ? "px-3 py-4" : "p-5")}>
          {!collapsed && <Separator className="mb-4 bg-[#e1ddd4]" />}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex w-full min-w-0 items-center rounded-xl text-left outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-[#2f7d73]/30 data-[state=open]:bg-white",
                    collapsed ? "h-11 justify-center px-0" : "gap-3 px-2 py-2"
                  )}
                  title={collapsed ? user.email : undefined}
                  aria-label="계정 메뉴"
                >
                  <Avatar className="h-10 w-10 shrink-0 border border-[#e1ddd4]">
                    {user.avatar_url && (
                      <AvatarImage
                        src={user.avatar_url}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <AvatarFallback className="bg-[#e7f3ef] text-xs font-extrabold text-[#235f58]">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                  {!collapsed && (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-slate-900">{user.email}</div>
                        <div className="text-xs font-medium text-[#2f7d73]">로그인됨</div>
                      </div>
                      <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-500" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align={collapsed ? "center" : "end"}
                sideOffset={10}
                className="w-56 border-[#d8d0c3] bg-[#f2eee7] text-slate-800 shadow-[0_16px_36px_rgba(99,88,72,0.14)]"
              >
                <DropdownMenuLabel className="min-w-0">
                  <div className="truncate text-sm font-semibold">계정</div>
                  <div className="truncate text-xs font-normal text-slate-500">
                    {user.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-[#ded6ca]" />
                <DropdownMenuItem
                  onSelect={() => setView("mypage")}
                  className="focus:bg-[#e7f3ef] focus:text-[#235f58]"
                >
                  <Settings className="h-4 w-4" />
                  계정 설정
                </DropdownMenuItem>
                {user.is_superuser && (
                  <DropdownMenuItem
                    onSelect={() => navigate("/admin/learners")}
                    className="focus:bg-[#e7f3ef] focus:text-[#235f58]"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    관리자 페이지
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={onLogout}
                  className="text-destructive focus:bg-[#f8e7e3] focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              type="button"
              onClick={onLogin}
              className={cn(
                "bg-[#2f7d73] font-bold text-white shadow-[0_10px_24px_rgba(47,125,115,0.16)] hover:bg-[#286d65]",
                collapsed ? "h-11 w-11 rounded-xl p-0" : "h-11 w-full rounded-xl"
              )}
              aria-label="로그인"
            >
              <LogIn className="h-4 w-4" />
              {!collapsed && "로그인"}
            </Button>
          )}
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. 모바일 네비게이션: 상단 헤더 + 하단 탭 바 (md 미만에서만 노출) */}
      {/* ========================================================================= */}
      {/* 상단 미니 헤더 */}
      <header className="md:hidden sticky top-0 left-0 right-0 h-14 border-b border-[#e1ddd4] bg-[#f6f3ee]/95 backdrop-blur supports-[backdrop-filter]:bg-[#f6f3ee]/75 px-4 flex items-center justify-between z-40 select-none">
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
          <span className={`font-bold tracking-tight text-foreground ${isHome ? "text-lg text-[#2f7d73] font-extrabold" : "text-base"}`}>
            {getMobileTitle()}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {user ? (
            isHome && (
              <>
                {user.is_superuser && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate("/admin/learners")}
                    className="h-9 w-9 rounded-full border bg-slate-50 text-[#2f7d73]"
                    aria-label="관리자 페이지"
                  >
                    <ShieldCheck className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setView("mypage")}
                  className="h-9 w-9 rounded-full bg-slate-50 dark:bg-slate-900 border"
                >
                  <Avatar className="h-8 w-8">
                    {user.avatar_url && (
                      <AvatarImage
                        src={user.avatar_url}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <AvatarFallback className="bg-[#e7f3ef] text-[#235f58] text-[10px] font-bold">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </>
            )
          ) : (
            isHome && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onLogin}
                className="text-xs text-[#2f7d73] hover:text-[#235f58] hover:bg-brand-50 gap-1 rounded-full px-3"
              >
                <LogIn className="h-3.5 w-3.5" />
                로그인
              </Button>
            )
          )}
        </div>
      </header>

      {/* 하단 고정 캡슐 탭 바 (ref/image.png 디자인 이식) */}
      <nav className="md:hidden fixed bottom-4 left-4 right-4 h-15 bg-white/95 backdrop-blur border border-[#e1ddd4]/80 rounded-full flex items-center justify-around z-45 shadow-[0_10px_30px_rgba(99,88,72,0.10)] px-2.5">
        {tabs.map((tab) => {
          const Icon = tabIcons[tab.id] || Search;
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
                  ? "bg-[#e7f3ef] text-[#2f7d73] font-extrabold scale-100"
                  : "text-slate-400 hover:text-slate-600 p-2"
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
