import { ChevronLeft, User, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MobileHeader({
  user,
  view,
  tab,
  onBack,
  onMyPage,
  onLogin,
  onLogout,
}) {
  const isHome = view === "home";

  // 현재 뷰에 맞는 타이틀 반환
  const getTitle = () => {
    if (isHome) return "English Buddy";
    if (view === "login") return "로그인";
    if (view === "signup") return "회원가입";
    if (view === "forgot-password") return "비밀번호 찾기";
    if (view === "mypage") return "마이페이지";
    return "";
  };

  return (
    <header className="sticky top-0 left-0 right-0 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 flex items-center justify-between z-40">
      <div className="flex items-center gap-2">
        {!isHome && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="h-9 w-9 rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        <span className={`font-bold tracking-tight text-foreground ${isHome ? "text-lg text-brand-600 dark:text-brand-400 font-extrabold" : "text-base"}`}>
          {getTitle()}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {user ? (
          <>
            {isHome && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onMyPage}
                className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                title="마이페이지"
              >
                <User className="h-5 w-5" />
              </Button>
            )}
            {!isHome && view === "mypage" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onLogout}
                className="text-xs text-muted-foreground hover:text-destructive gap-1"
              >
                <LogOut className="h-3.5 w-3.5" />
                로그아웃
              </Button>
            )}
          </>
        ) : (
          isHome && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onLogin}
              className="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 gap-1 rounded-full px-3"
            >
              <LogIn className="h-3.5 w-3.5" />
              로그인
            </Button>
          )
        )}
      </div>
    </header>
  );
}
