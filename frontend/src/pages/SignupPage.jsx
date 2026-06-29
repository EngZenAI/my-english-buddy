import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import GoogleButton from "../components/GoogleButton";
import AuthCard from "@/components/auth/AuthCard";
import Spinner from "@/components/common/Spinner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupPage({ onNavigate, onOAuthStart }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const redirectTimerRef = useRef(null);

  const clearRedirectTimer = () => {
    if (!redirectTimerRef.current) return;
    window.clearTimeout(redirectTimerRef.current);
    redirectTimerRef.current = null;
  };

  useEffect(() => clearRedirectTimer, []);

  const submit = async () => {
    clearRedirectTimer();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password.trim() || !confirm.trim()) {
      setStatus("이메일과 비밀번호를 모두 입력해주세요.");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setStatus("이메일 형식을 확인해주세요.");
      return;
    }
    if (password.length < 8) {
      setStatus("비밀번호는 8자 이상으로 입력해주세요.");
      return;
    }
    if (password !== confirm) {
      setStatus("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    setStatus("");
    let redirectPending = false;
    try {
      const res = await api.register(trimmedEmail, password);
      if (res.ok) {
        setStatus("회원가입이 완료되었습니다. 로그인해주세요.");
        redirectPending = true;
        redirectTimerRef.current = window.setTimeout(() => {
          redirectTimerRef.current = null;
          onNavigate("login");
        }, 800);
      } else if (res.detail === "REGISTER_USER_ALREADY_EXISTS") {
        setStatus("이미 가입된 이메일입니다.");
      } else {
        setStatus("회원가입에 실패했습니다. 입력값을 확인해주세요.");
      }
    } catch {
      setStatus("회원가입 요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      if (!redirectPending) setLoading(false);
    }
  };

  return (
    <AuthCard
      eyebrow="Create account"
      title="회원가입"
      description="이메일과 비밀번호로 학습 계정을 만듭니다."
      footer={
        <Button
          type="button"
          variant="ghost"
          onClick={() => onNavigate("login")}
          disabled={loading}
          className="w-full"
        >
          이미 계정이 있으신가요? 로그인
        </Button>
      }
    >
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="signup-email">이메일</FieldLabel>
          <Input
            id="signup-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            placeholder="you@example.com"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="signup-password">비밀번호</FieldLabel>
          <Input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
          <FieldDescription>8자 이상으로 입력해주세요.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="signup-confirm">비밀번호 확인</FieldLabel>
          <Input
            id="signup-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
          />
        </Field>

        <Button type="button" onClick={submit} disabled={loading} className="w-full">
          {loading && <Spinner />}
          {loading ? "처리 중" : "계정 만들기"}
        </Button>
        <GoogleButton label="Google로 회원가입" onStart={onOAuthStart} disabled={loading} />

        {status && <FieldDescription>{status}</FieldDescription>}
      </div>
    </AuthCard>
  );
}
