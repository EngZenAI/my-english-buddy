import { Home, LogIn, LogOut, UserRound, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MainNav({
  user,
  onHome,
  onMyPage,
  onLogin,
  onSignup,
  onLogout,
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pb-3">
      <Button type="button" variant="outline" size="sm" onClick={onHome}>
        <Home />
        홈
      </Button>
      {user ? (
        <>
          <Button type="button" variant="outline" size="sm" onClick={onMyPage}>
            <UserRound />
            마이페이지
          </Button>
          <span className="max-w-60 truncate text-sm text-muted-foreground">
            로그인됨: {user.email}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onLogout}>
            <LogOut />
            로그아웃
          </Button>
        </>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" onClick={onLogin}>
            <LogIn />
            로그인
          </Button>
          <Button type="button" size="sm" onClick={onSignup}>
            <UserPlus />
            회원가입
          </Button>
        </>
      )}
    </div>
  );
}
