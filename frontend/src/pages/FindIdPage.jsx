import { useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const REMEMBERED_LOGIN_ID_KEY = "englishBuddy.loginId";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function FindIdPage({ onNavigate }) {
  const rememberedEmail = localStorage.getItem(REMEMBERED_LOGIN_ID_KEY) || "";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");

  const submit = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setStatus("가입할 때 사용한 이메일을 입력해주세요.");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setStatus("이메일 형식을 확인해주세요.");
      return;
    }
    setStatus(`입력한 이메일 ${trimmedEmail}이 로그인 ID입니다.`);
  };

  return (
    <AuthCard
      eyebrow="Find account"
      title="아이디 찾기"
      description="이 앱의 로그인 ID는 가입한 이메일 주소입니다."
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
        {rememberedEmail && (
          <Alert className="border-brand-100 bg-brand-50 text-slate-700">
            기억된 로그인 ID: <span className="font-semibold">{rememberedEmail}</span>
          </Alert>
        )}

        <Field>
          <FieldLabel htmlFor="find-id-email">가입 이메일</FieldLabel>
          <Input
            id="find-id-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="you@example.com"
          />
        </Field>

        <Button
          type="button"
          onClick={submit}
          className="w-full"
        >
          로그인 ID 확인
        </Button>

        {status && <FieldDescription>{status}</FieldDescription>}
      </div>
    </AuthCard>
  );
}
