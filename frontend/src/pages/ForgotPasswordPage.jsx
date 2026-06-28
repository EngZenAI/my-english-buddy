import { usePasswordReset } from "../hooks/usePasswordReset";

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
    />
  );
}

function EmailStep({ flow }) {
  return (
    <>
      <label className="block text-sm text-slate-600 mb-1">이메일</label>
      <input
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
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-4
                   focus:outline-none focus:ring-2 focus:ring-brand-200"
      />

      <button
        onClick={flow.requestCode}
        disabled={flow.sendingCode || flow.verifyingCode || flow.resettingPassword}
        className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold
                   hover:bg-brand-700 disabled:opacity-70 disabled:cursor-not-allowed mb-3
                   inline-flex items-center justify-center gap-2"
      >
        {flow.sendingCode && <Spinner />}
        {flow.sendingCode
          ? "메일 전송 중"
          : flow.codeSent
            ? "인증 코드 재전송"
            : "인증 코드 받기"}
      </button>
    </>
  );
}

function CodeStep({ flow }) {
  if (!flow.codeSent) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-semibold text-slate-700">인증 코드 입력</p>
        <span
          className={`text-sm font-semibold ${
            flow.remainingSeconds > 0 ? "text-brand-600" : "text-rose-600"
          }`}
        >
          {flow.remainingSeconds > 0 ? flow.formatRemaining() : "만료됨"}
        </span>
      </div>

      <label className="block text-sm text-slate-600 mb-1">인증 코드</label>
      <input
        value={flow.code}
        onChange={(e) => flow.setCode(e.target.value)}
        disabled={flow.verifyingCode || flow.resettingPassword || flow.codeVerified}
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={9}
        placeholder="XXXX-XXXX"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3
                   focus:outline-none focus:ring-2 focus:ring-brand-200"
      />

      {flow.remainingSeconds <= 0 && (
        <p className="text-sm text-rose-600 mb-3">
          인증 시간이 만료되었습니다. 인증 코드를 다시 받아주세요.
        </p>
      )}

      <button
        onClick={flow.verifyCode}
        disabled={
          flow.sendingCode ||
          flow.verifyingCode ||
          flow.resettingPassword ||
          flow.codeVerified ||
          flow.remainingSeconds <= 0
        }
        className="w-full h-10 rounded-lg border border-slate-300 bg-white text-slate-900
                   font-semibold hover:bg-slate-50 disabled:opacity-70 disabled:cursor-not-allowed
                   inline-flex items-center justify-center gap-2 mb-4"
      >
        {flow.verifyingCode && <Spinner />}
        {flow.verifyingCode
          ? "확인 중"
          : flow.codeVerified
            ? "인증 완료"
            : "인증 코드 확인"}
      </button>
    </div>
  );
}

function PasswordStep({ flow }) {
  if (!flow.codeVerified) return null;

  return (
    <>
      <label className="block text-sm text-slate-600 mb-1">새 비밀번호</label>
      <input
        type="password"
        value={flow.password}
        onChange={(e) => flow.setPassword(e.target.value)}
        disabled={flow.resettingPassword}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3
                   focus:outline-none focus:ring-2 focus:ring-brand-200"
      />

      <label className="block text-sm text-slate-600 mb-1">새 비밀번호 확인</label>
      <input
        type="password"
        value={flow.confirm}
        onChange={(e) => flow.setConfirm(e.target.value)}
        disabled={flow.resettingPassword}
        onKeyDown={(e) =>
          e.key === "Enter" && !flow.resettingPassword && flow.confirmReset()
        }
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-4
                   focus:outline-none focus:ring-2 focus:ring-brand-200"
      />

      <button
        onClick={flow.confirmReset}
        disabled={
          flow.sendingCode ||
          flow.verifyingCode ||
          flow.resettingPassword ||
          flow.remainingSeconds <= 0
        }
        className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold
                   hover:bg-brand-700 disabled:opacity-70 disabled:cursor-not-allowed
                   inline-flex items-center justify-center gap-2"
      >
        {flow.resettingPassword && <Spinner />}
        {flow.resettingPassword ? "변경 중" : "비밀번호 변경"}
      </button>
    </>
  );
}

export default function ForgotPasswordPage({ onNavigate }) {
  const flow = usePasswordReset(() => onNavigate("login"));

  return (
    <div className="py-10">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-7 max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-1.5">비밀번호 찾기</h1>
        <p className="text-sm text-slate-500 mb-4">
          가입한 이메일로 발송된 10분간 유효한 인증 코드 8자리를 입력해주세요.
        </p>

        <EmailStep flow={flow} />
        <CodeStep flow={flow} />
        <PasswordStep flow={flow} />

        {flow.status && <p className="text-sm text-slate-500 mt-3">{flow.status}</p>}

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
