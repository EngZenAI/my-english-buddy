import { useState } from "react";
import { api } from "../api";
import GoogleButton from "../components/GoogleButton";

export default function SignupPage({ onNavigate }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");

  const submit = async () => {
    if (!email.trim() || !password.trim() || !confirm.trim()) {
      setStatus("이메일과 비밀번호를 모두 입력해주세요.");
      return;
    }
    if (password !== confirm) {
      setStatus("비밀번호가 일치하지 않습니다.");
      return;
    }
    const res = await api.register(email, password);
    if (res.ok) {
      setStatus("회원가입이 완료되었습니다. 로그인해주세요.");
      setTimeout(() => onNavigate("login"), 800);
    } else if (res.detail === "REGISTER_USER_ALREADY_EXISTS") {
      setStatus("이미 가입된 이메일입니다.");
    } else {
      setStatus("회원가입에 실패했습니다. 입력값을 확인해주세요.");
    }
  };

  return (
    <div className="py-10">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-7 max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-1.5">회원가입</h1>
        <p className="text-sm text-slate-500 mb-4">
          이메일과 비밀번호로 학습 계정을 만듭니다.
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
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <label className="block text-sm text-slate-600 mb-1">비밀번호 확인</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-4
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />

        <button
          onClick={submit}
          className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold
                     hover:bg-brand-700 mb-3"
        >
          계정 만들기
        </button>
        <GoogleButton label="Google로 회원가입" />

        {status && <p className="text-sm text-slate-500 mt-3">{status}</p>}

        <button
          onClick={() => onNavigate("login")}
          className="w-full text-sm text-slate-500 hover:text-slate-700 mt-4"
        >
          이미 계정이 있으신가요? 로그인
        </button>
      </div>
    </div>
  );
}
