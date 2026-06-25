import { useEffect, useState } from "react";
import { api } from "../api";

export const CODE_TTL_SECONDS = 10 * 60;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RESET_UNAVAILABLE_MESSAGE =
  "도메인 등록 후 이메일 인증 코드 발송을 이용할 수 있습니다. 지금은 개발팀에게 문의해주세요.";

function validateCode(code) {
  if (!code) return "이메일로 받은 6자리 인증 코드를 입력해주세요.";
  if (!/^\d{6}$/.test(code)) return "인증 코드는 숫자 6자리입니다.";
  return "";
}

export function usePasswordReset(onComplete) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeVerified, setCodeVerified] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  useEffect(() => {
    if (!codeSent) return undefined;
    const timer = window.setInterval(() => {
      setRemainingSeconds((seconds) => Math.max(seconds - 1, 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [codeSent]);

  const formatRemaining = () => {
    const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, "0");
    const seconds = String(remainingSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  const setSanitizedCode = (value) => {
    setCode(value.replace(/\D/g, "").slice(0, 6));
    setCodeVerified(false);
  };

  const requestCode = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setStatus("가입한 이메일을 입력해주세요.");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setStatus("이메일 형식을 확인해주세요.");
      return;
    }

    setCodeSent(true);
    setCode("");
    setPassword("");
    setConfirm("");
    setCodeVerified(false);
    setRemainingSeconds(CODE_TTL_SECONDS);
    setSendingCode(true);
    setStatus("인증 코드 발송을 요청하고 있습니다.");

    const res = await api.requestPasswordReset(trimmedEmail);
    setSendingCode(false);

    if (res.ok) {
      setStatus(
        res.delivery === "debug"
          ? "개발 모드에서는 백엔드 로그에 6자리 인증 코드가 출력됩니다."
          : "가입된 계정이면 6자리 인증 코드가 발송됩니다."
      );
    } else if (
      res.detail === "PASSWORD_RESET_UNAVAILABLE" ||
      String(res.detail || "").includes("SMTP")
    ) {
      setStatus(PASSWORD_RESET_UNAVAILABLE_MESSAGE);
    } else {
      setStatus("요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  };

  const verifyCode = async () => {
    const trimmedCode = code.trim();
    if (remainingSeconds <= 0) {
      setStatus("인증 시간이 만료되었습니다. 인증 코드를 다시 받아주세요.");
      return;
    }
    const codeError = validateCode(trimmedCode);
    if (codeError) {
      setStatus(codeError);
      return;
    }

    setVerifyingCode(true);
    setStatus("");
    const res = await api.verifyPasswordResetCode(email.trim(), trimmedCode);
    setVerifyingCode(false);

    if (res.ok) {
      setCodeVerified(true);
      setStatus("인증이 완료되었습니다. 새 비밀번호를 입력해주세요.");
    } else {
      setCodeVerified(false);
      setStatus("인증 코드가 만료되었거나 일치하지 않습니다.");
    }
  };

  const confirmReset = async () => {
    const trimmedCode = code.trim();
    if (remainingSeconds <= 0) {
      setStatus("인증 시간이 만료되었습니다. 인증 코드를 다시 받아주세요.");
      return;
    }
    const codeError = validateCode(trimmedCode);
    if (codeError) {
      setStatus(codeError);
      return;
    }
    if (!codeVerified) {
      setStatus("인증 코드를 먼저 확인해주세요.");
      return;
    }
    if (!password.trim() || !confirm.trim()) {
      setStatus("새 비밀번호를 입력해주세요.");
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

    setResettingPassword(true);
    setStatus("");
    const res = await api.confirmPasswordReset(email.trim(), trimmedCode, password);
    setResettingPassword(false);

    if (res.ok) {
      setStatus("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.");
      window.setTimeout(onComplete, 900);
    } else {
      setStatus("인증 코드가 만료되었거나 일치하지 않습니다.");
    }
  };

  return {
    email,
    setEmail,
    code,
    setCode: setSanitizedCode,
    password,
    setPassword,
    confirm,
    setConfirm,
    status,
    codeSent,
    codeVerified,
    remainingSeconds,
    sendingCode,
    verifyingCode,
    resettingPassword,
    formatRemaining,
    requestCode,
    verifyCode,
    confirmReset,
  };
}
