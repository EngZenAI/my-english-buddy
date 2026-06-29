import { usePasswordReset } from "../hooks/usePasswordReset";
import AuthCard from "@/components/auth/AuthCard";
import Spinner from "@/components/common/Spinner";
import VerificationCodeInput from "@/components/auth/VerificationCodeInput";
import { CheckCircle2, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function EmailStep({ flow }) {
  return (
    <Field>
      <FieldLabel htmlFor="reset-email">가입 이메일</FieldLabel>
      <div className="flex gap-2">
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
          className="min-w-0"
        />
        <Button
          type="button"
          onClick={flow.requestCode}
          disabled={flow.sendingCode || flow.verifyingCode || flow.resettingPassword}
          className="shrink-0"
        >
          {flow.sendingCode ? (
            <Spinner />
          ) : flow.codeSent ? (
            <RefreshCw />
          ) : (
            <Mail />
          )}
          {flow.sendingCode ? "전송 중" : flow.codeSent ? "재전송" : "코드 받기"}
        </Button>
      </div>
      <FieldDescription>
        가입된 계정이면 10분 동안 사용할 수 있는 인증 코드가 발송됩니다.
      </FieldDescription>
    </Field>
  );
}

function CodeStep({ flow }) {
  if (!flow.codeSent) return null;

  return (
    <Field className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <FieldLabel htmlFor="reset-code">인증 코드</FieldLabel>
          <FieldDescription className="mt-1">
            {flow.email.trim()} 주소로 보낸 8자리 코드를 입력해주세요.
          </FieldDescription>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            flow.remainingSeconds > 0 ? "text-brand-600" : "text-rose-600"
          }`}
        >
          {flow.remainingSeconds > 0 ? flow.formatRemaining() : "만료됨"}
        </span>
      </div>

      <VerificationCodeInput
        id="reset-code"
        value={flow.code}
        onChange={flow.setCode}
        disabled={flow.verifyingCode || flow.resettingPassword || flow.codeVerified}
      />

      {flow.remainingSeconds <= 0 && (
        <p className="text-sm text-rose-600">
          인증 시간이 만료되었습니다. 인증 코드를 다시 받아주세요.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          onClick={flow.requestCode}
          disabled={flow.sendingCode || flow.verifyingCode || flow.resettingPassword}
        >
          {flow.sendingCode ? <Spinner /> : <RefreshCw />}
          다시 받기
        </Button>
        <Button
          type="button"
          onClick={flow.verifyCode}
          disabled={
            flow.sendingCode ||
            flow.verifyingCode ||
            flow.resettingPassword ||
            flow.codeVerified ||
            flow.remainingSeconds <= 0
          }
        >
          {flow.verifyingCode ? <Spinner /> : <ShieldCheck />}
          {flow.verifyingCode
            ? "확인 중"
            : flow.codeVerified
              ? "인증 완료"
              : "코드 확인"}
        </Button>
      </div>
    </Field>
  );
}

function PasswordStep({ flow }) {
  if (!flow.codeVerified) return null;

  return (
    <Field className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
        <CheckCircle2 className="h-4 w-4" />
        이메일 인증 완료
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="reset-password">새 비밀번호</FieldLabel>
        <Input
          id="reset-password"
          type="password"
          value={flow.password}
          onChange={(e) => flow.setPassword(e.target.value)}
          disabled={flow.resettingPassword}
        />
      </div>

      <div className="mt-3 space-y-1.5">
        <FieldLabel htmlFor="reset-confirm">새 비밀번호 확인</FieldLabel>
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
    </Field>
  );
}

export default function ForgotPasswordPage({ onNavigate }) {
  const flow = usePasswordReset(() => onNavigate("login"));

  return (
    <AuthCard
      eyebrow="Account recovery"
      title="비밀번호 재설정"
      description={
        flow.codeSent
          ? "메일함에서 인증 코드를 확인한 뒤 새 비밀번호를 설정합니다."
          : "가입 이메일을 확인하고 재설정 코드를 발송합니다."
      }
      footer={
        <Button
          type="button"
          variant="ghost"
          onClick={() => onNavigate("login")}
          className="w-full"
        >
          로그인으로 돌아가기
        </Button>
      }
    >
      <div className="space-y-4">
        <EmailStep flow={flow} />
        <CodeStep flow={flow} />
        <PasswordStep flow={flow} />

        {flow.status && (
          <Alert className="bg-background text-muted-foreground">
            {flow.status}
          </Alert>
        )}

      </div>
    </AuthCard>
  );
}
