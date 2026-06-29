import { useState } from "react";
import { api } from "../api";
import GoogleButton from "../components/GoogleButton";
import AuthCard from "@/components/auth/AuthCard";
import Spinner from "@/components/common/Spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupPage({ onNavigate, onOAuthStart }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
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
    try {
      const res = await api.register(trimmedEmail, password);
      if (res.ok) {
        setStatus("회원가입이 완료되었습니다. 로그인해주세요.");
        setTimeout(() => onNavigate("login"), 800);
      } else if (res.detail === "REGISTER_USER_ALREADY_EXISTS") {
        setStatus("이미 가입된 이메일입니다.");
      } else {
        setStatus("회원가입에 실패했습니다. 입력값을 확인해주세요.");
      }
    } catch {
      setStatus("회원가입 요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="회원가입" description="이메일과 비밀번호로 학습 계정을 만듭니다.">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="signup-email">이메일</Label>
          <Input
            id="signup-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-password">비밀번호</Label>
          <Input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-confirm">비밀번호 확인</Label>
          <Input
            id="signup-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
          />
        </div>

        <Button type="button" onClick={submit} disabled={loading} className="w-full">
          {loading && <Spinner />}
          {loading ? "처리 중" : "계정 만들기"}
        </Button>
        <GoogleButton label="Google로 회원가입" onStart={onOAuthStart} disabled={loading} />

        {status && <p className="text-sm text-muted-foreground">{status}</p>}

        <Button
          type="button"
          variant="ghost"
          onClick={() => onNavigate("login")}
          className="w-full"
        >
          이미 계정이 있으신가요? 로그인
        </Button>
      </div>
    </AuthCard>
  );
}
