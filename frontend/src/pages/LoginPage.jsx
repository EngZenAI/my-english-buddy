import { useState } from "react";
import { api } from "../api";
import GoogleButton from "../components/GoogleButton";

export default function LoginPage({ onNavigate, onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      setStatus("이메일과 비밀번호를 입력해주세요.");
      return;
    }
    const ok = await api.login(email, password);
    if (ok) {
      setStatus("로그인되었습니다.");
      onLoggedIn && (await onLoggedIn());
      onNavigate("home");
    } else {
      setStatus("이메일 또는 비밀번호를 확인해주세요.");
    }
  };

  return (
    <div className="py-10">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-7 max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-1.5">로그인</h1>
        <p className="text-sm text-slate-500 mb-4">
          저장한 단어장과 복습 흐름을 이어갑니다.
        </p>

        <label className="block text-sm text-slate-600 mb-1">이메일</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <label className="block text-sm text-slate-600 mb-1">비밀번호</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-4
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />

        <button
          onClick={submit}
          className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold
                     hover:bg-brand-700 mb-3"
        >
          로그인
        </button>
        <GoogleButton label="Google로 로그인" />

        {status && <p className="text-sm text-slate-500 mt-3">{status}</p>}

        <button
          onClick={() => onNavigate("signup")}
          className="w-full text-sm text-slate-500 hover:text-slate-700 mt-4"
        >
          계정이 없으신가요? 회원가입
        </button>
      </div>
    </div>
  );
}
