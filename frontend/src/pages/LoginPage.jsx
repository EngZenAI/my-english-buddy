import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
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

export default function LoginPage({ onNavigate, onAuthenticated, onOAuthStart, onHome }) {
  const rememberedEmail = localStorage.getItem(REMEMBERED_LOGIN_ID_KEY) || "";
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [rememberLoginId, setRememberLoginId] = useState(Boolean(rememberedEmail));
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const trimmedEmail = email.trim();
    setEmailError("");
    setPasswordError("");
    setStatus("");

    if (!trimmedEmail) {
      setEmailError("이메일을 입력해주세요.");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError("이메일 형식을 확인해주세요.");
      return;
    }
    if (!password.trim()) {
      setPasswordError("비밀번호를 입력해주세요.");
      return;
    }

    setLoading(true);
    let ok = false;
    try {
      ok = await api.login(trimmedEmail, password);
    } catch {
      setStatus("로그인 요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
      setLoading(false);
      return;
    }

    if (!ok) {
      setPasswordError("이메일 또는 비밀번호가 올바르지 않습니다.");
      setLoading(false);
      return;
    }

    if (rememberLoginId) {
      localStorage.setItem(REMEMBERED_LOGIN_ID_KEY, trimmedEmail);
    } else {
      localStorage.removeItem(REMEMBERED_LOGIN_ID_KEY);
    }

    try {
      const result = onAuthenticated ? await onAuthenticated() : { ok: true };
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
      title="로그인"
      onHome={onHome}
      activeMode="login"
      onModeChange={(mode) => mode === "signup" && onNavigate("signup")}
      footer={
        <Button
          type="button"
          variant="ghost"
          onClick={() => onNavigate("signup")}
          disabled={loading}
          className="w-full text-slate-600"
        >
          계정이 없으신가요? <span className="font-bold text-[#0f8b83]">회원가입</span>
        </Button>
      }
    >
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="login-email" className="text-slate-700">이메일</FieldLabel>
          <Input
            id="login-email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError("");
            }}
            disabled={loading}
            placeholder="you@example.com"
            className={emailError ? "border-rose-400 focus-visible:ring-rose-200" : "focus-visible:ring-[#0f8b83]/25"}
          />
          {emailError && <p className="text-sm font-medium text-rose-600">{emailError}</p>}
        </Field>

        <Field>
          <FieldLabel htmlFor="login-password" className="text-slate-700">비밀번호</FieldLabel>
          <div className="relative">
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError("");
              }}
              disabled={loading}
              onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
              className={`pr-10 ${passwordError ? "border-rose-400 focus-visible:ring-rose-200" : "focus-visible:ring-[#0f8b83]/25"}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {passwordError && <p className="text-sm font-medium text-rose-600">{passwordError}</p>}
        </Field>

        <FieldLabel className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={rememberLoginId}
            onCheckedChange={(checked) => setRememberLoginId(checked === true)}
          />
          로그인 ID 기억하기
        </FieldLabel>

        <Button
          type="button"
          onClick={submit}
          disabled={loading}
          className="h-12 w-full bg-[#0f8b83] text-base font-bold hover:bg-[#0b756f]"
        >
          {loading && <Spinner />}
          {loading ? "로그인 중" : "로그인"}
        </Button>

        <div className="flex items-center gap-3 py-1 text-xs font-semibold text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          또는
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <GoogleButton label="Google 계정으로 계속하기" onStart={onOAuthStart} disabled={loading} />

        <div className="flex items-center justify-center text-sm">
          <Button type="button" variant="link" onClick={() => onNavigate("forgot-password")} className="h-auto p-0 text-slate-500">
            비밀번호 찾기
          </Button>
        </div>

        {status && <FieldDescription className="text-rose-600">{status}</FieldDescription>}
      </div>
    </AuthCard>
  );
}
