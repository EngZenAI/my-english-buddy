import { useState } from "react";
import { api } from "../api";
import GoogleButton from "../components/GoogleButton";

const REMEMBERED_LOGIN_ID_KEY = "englishBuddy.loginId";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
    />
  );
}

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
          disabled={loading}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <label className="block text-sm text-slate-600 mb-1">비밀번호</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-4
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-4">
          <input
            type="checkbox"
            checked={rememberLoginId}
            onChange={(e) => setRememberLoginId(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          로그인 ID 기억하기
        </label>

        <button
          onClick={submit}
          disabled={loading}
          className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold
                     hover:bg-brand-700 disabled:opacity-70 disabled:cursor-not-allowed mb-3
                     inline-flex items-center justify-center gap-2"
        >
          {loading && <Spinner />}
          {loading ? "로그인 중" : "로그인"}
        </button>
        <GoogleButton label="Google로 로그인" onStart={onOAuthStart} disabled={loading} />

        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button
            onClick={() => onNavigate("find-id")}
            className="text-slate-500 hover:text-slate-700"
          >
            아이디 찾기
          </button>
          <span className="text-slate-300">|</span>
          <button
            onClick={() => onNavigate("forgot-password")}
            className="text-slate-500 hover:text-slate-700"
          >
            비밀번호 찾기
          </button>
        </div>

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
