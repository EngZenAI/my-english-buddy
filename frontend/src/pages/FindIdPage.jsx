import { useState } from "react";

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
    <div className="py-10">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-7 max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-1.5">아이디 찾기</h1>
        <p className="text-sm text-slate-500 mb-4">
          이 앱의 로그인 ID는 가입한 이메일 주소입니다.
        </p>

        {rememberedEmail && (
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-slate-700 mb-4">
            기억된 로그인 ID: <span className="font-semibold">{rememberedEmail}</span>
          </div>
        )}

        <label className="block text-sm text-slate-600 mb-1">가입 이메일</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-4
                     focus:outline-none focus:ring-2 focus:ring-brand-200"
        />

        <button
          onClick={submit}
          className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold
                     hover:bg-brand-700 mb-3"
        >
          로그인 ID 확인
        </button>

        {status && <p className="text-sm text-slate-500 mt-3">{status}</p>}

        <button
          onClick={() => onNavigate("login")}
          className="w-full text-sm text-slate-500 hover:text-slate-700 mt-4"
        >
          로그인으로 돌아가기
        </button>
      </div>
    </div>
  );
}
