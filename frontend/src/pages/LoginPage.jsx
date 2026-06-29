import { useState } from "react";
import { api } from "../api";
import GoogleButton from "../components/GoogleButton";
import AuthCard from "@/components/auth/AuthCard";
import Spinner from "@/components/common/Spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const REMEMBERED_LOGIN_ID_KEY = "englishBuddy.loginId";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage({ onNavigate, onAuthenticated, onOAuthStart }) {
  const rememberedEmail = localStorage.getItem(REMEMBERED_LOGIN_ID_KEY) || "";
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [rememberLoginId, setRememberLoginId] = useState(Boolean(rememberedEmail));
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password.trim()) {
      setStatus("로그인 ID와 비밀번호를 입력해주세요.");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setStatus("이메일 형식의 로그인 ID를 입력해주세요.");
      return;
    }

    setLoading(true);
    setStatus("");
    let ok = false;
    try {
      ok = await api.login(trimmedEmail, password);
    } catch {
      setLoading(false);
      setStatus("로그인 요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    if (!ok) {
      setLoading(false);
      setStatus("이메일 또는 비밀번호를 확인해주세요.");
      return;
    }

    if (rememberLoginId) {
      localStorage.setItem(REMEMBERED_LOGIN_ID_KEY, trimmedEmail);
    } else {
      localStorage.removeItem(REMEMBERED_LOGIN_ID_KEY);
    }

    try {
      const result = onAuthenticated
        ? await onAuthenticated()
        : { ok: true };
      if (result?.ok === false) {
        setStatus(result.message || "로그인 상태를 확인하지 못했습니다. 다시 시도해주세요.");
      }
    } catch {
      setStatus("로그인 상태를 확인하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="로그인"
      description="저장한 단어장과 복습 흐름을 이어갑니다."
      footer={
        <Button
          type="button"
          variant="ghost"
          onClick={() => onNavigate("signup")}
          disabled={loading}
          className="w-full"
        >
          계정이 없으신가요? 회원가입
        </Button>
      }
    >
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="login-email">이메일</FieldLabel>
          <Input
            id="login-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            placeholder="you@example.com"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="login-password">비밀번호</FieldLabel>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
          />
        </Field>
        <FieldLabel className="flex items-center gap-2 text-muted-foreground">
          <Checkbox
            checked={rememberLoginId}
            onCheckedChange={(checked) => setRememberLoginId(checked === true)}
          />
          로그인 ID 기억하기
        </FieldLabel>

        <Button type="button" onClick={submit} disabled={loading} className="w-full">
          {loading && <Spinner />}
          {loading ? "로그인 중" : "로그인"}
        </Button>
        <GoogleButton label="Google로 로그인" onStart={onOAuthStart} disabled={loading} />

        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <Button
            type="button"
            variant="link"
            onClick={() => onNavigate("find-id")}
          >
            아이디 찾기
          </Button>
          <span className="text-border">|</span>
          <Button
            type="button"
            variant="link"
            onClick={() => onNavigate("forgot-password")}
          >
            비밀번호 찾기
          </Button>
        </div>

        {status && <FieldDescription>{status}</FieldDescription>}
      </div>
    </AuthCard>
  );
}
