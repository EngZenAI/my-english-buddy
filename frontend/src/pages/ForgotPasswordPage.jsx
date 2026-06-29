import { usePasswordReset } from "../hooks/usePasswordReset";
import AuthCard from "@/components/auth/AuthCard";
import Spinner from "@/components/common/Spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function EmailStep({ flow }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="reset-email">이메일</Label>
        <Input
          id="reset-email"
          value={flow.email}
          onChange={(e) => flow.setEmail(e.target.value)}
          disabled={flow.sendingCode || flow.codeSent}
          onKeyDown={(e) =>
            e.key === "Enter" &&
            !flow.sendingCode &&
            !flow.codeSent &&
            flow.requestCode()
          }
          placeholder="you@example.com"
        />
      </div>

      <Button
        type="button"
        onClick={flow.requestCode}
        disabled={flow.sendingCode || flow.verifyingCode || flow.resettingPassword}
        className="w-full"
      >
        {flow.sendingCode && <Spinner />}
        {flow.sendingCode
          ? "메일 전송 중"
          : flow.codeSent
            ? "인증 코드 재전송"
            : "인증 코드 받기"}
      </Button>
    </>
  );
}

function CodeStep({ flow }) {
  if (!flow.codeSent) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-semibold text-slate-700">인증 코드 입력</p>
        <span
          className={`text-sm font-semibold ${
            flow.remainingSeconds > 0 ? "text-brand-600" : "text-rose-600"
          }`}
        >
          {flow.remainingSeconds > 0 ? flow.formatRemaining() : "만료됨"}
        </span>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reset-code">인증 코드</Label>
        <Input
          id="reset-code"
          value={flow.code}
          onChange={(e) => flow.setCode(e.target.value)}
          disabled={flow.verifyingCode || flow.resettingPassword || flow.codeVerified}
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={9}
          placeholder="XXXX-XXXX"
        />
      </div>

      {flow.remainingSeconds <= 0 && (
        <p className="mb-3 mt-3 text-sm text-rose-600">
          인증 시간이 만료되었습니다. 인증 코드를 다시 받아주세요.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={flow.verifyCode}
        disabled={
          flow.sendingCode ||
          flow.verifyingCode ||
          flow.resettingPassword ||
          flow.codeVerified ||
          flow.remainingSeconds <= 0
        }
        className="mb-4 mt-3 w-full"
      >
        {flow.verifyingCode && <Spinner />}
        {flow.verifyingCode
          ? "확인 중"
          : flow.codeVerified
            ? "인증 완료"
            : "인증 코드 확인"}
      </Button>
    </div>
  );
}

function PasswordStep({ flow }) {
  if (!flow.codeVerified) return null;

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="reset-password">새 비밀번호</Label>
        <Input
          id="reset-password"
          type="password"
          value={flow.password}
          onChange={(e) => flow.setPassword(e.target.value)}
          disabled={flow.resettingPassword}
        />
      </div>

      <div className="mt-3 space-y-1.5">
        <Label htmlFor="reset-confirm">새 비밀번호 확인</Label>
        <Input
          id="reset-confirm"
          type="password"
          value={flow.confirm}
          onChange={(e) => flow.setConfirm(e.target.value)}
          disabled={flow.resettingPassword}
          onKeyDown={(e) =>
            e.key === "Enter" && !flow.resettingPassword && flow.confirmReset()
          }
        />
      </div>

      <Button
        type="button"
        onClick={flow.confirmReset}
        disabled={
          flow.sendingCode ||
          flow.verifyingCode ||
          flow.resettingPassword ||
          flow.remainingSeconds <= 0
        }
        className="mt-4 w-full"
      >
        {flow.resettingPassword && <Spinner />}
        {flow.resettingPassword ? "변경 중" : "비밀번호 변경"}
      </Button>
    </>
  );
}

export default function ForgotPasswordPage({ onNavigate }) {
  const flow = usePasswordReset(() => onNavigate("login"));

  return (
    <AuthCard
      title="비밀번호 찾기"
      description="가입한 이메일로 발송된 10분간 유효한 인증 코드 8자리를 입력해주세요."
    >
      <div className="space-y-3">
        <EmailStep flow={flow} />
        <CodeStep flow={flow} />
        <PasswordStep flow={flow} />

        {flow.status && <p className="text-sm text-muted-foreground">{flow.status}</p>}

        <Button
          type="button"
          variant="ghost"
          onClick={() => onNavigate("login")}
          className="w-full"
        >
          로그인으로 돌아가기
        </Button>
      </div>
    </AuthCard>
  );
}
