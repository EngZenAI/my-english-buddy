import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { api } from "../api";
import GoogleButton from "../components/GoogleButton";
import AuthCard from "@/components/auth/AuthCard";
import Spinner from "@/components/common/Spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SPECIAL_PATTERN = /[^A-Za-z0-9]/;
const TERMS_TEXT = `# EngZenAI 서비스 이용약관

## 제1조 (목적)

이 약관은 EngZenAI(이하 "회사"라 함)이 제공하는 서비스의 이용과 관련하여 회사와 이용자 간의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.

## 제2조 (정의)

이 약관에서 사용하는 용어의 정의는 다음과 같습니다.
1. "서비스"란 회사가 제공하는 모든 서비스를 의미합니다.
2. "이용자"란 이 약관에 따라 회사가 제공하는 서비스를 이용하는 회원 및 비회원을 말합니다.
3. "회원"이란 회사에 개인정보를 제공하여 회원등록을 한 자로서, 회사의 정보를 지속적으로 제공받으며 회사가 제공하는 서비스를 계속적으로 이용할 수 있는 자를 말합니다.
4. "비회원"이란 회원에 가입하지 않고 회사가 제공하는 서비스를 이용하는 자를 말합니다.
5. "콘텐츠"란 회사 또는 이용자가 서비스 상에 게시한 모든 글, 사진, 동영상, 첨부파일, 링크 등을 말합니다.

## 제3조 (약관 외 준칙)

이 약관에서 정하지 아니한 사항은 전기통신사업법, 전자상거래 등에서의 소비자보호에 관한 법률, 개인정보 보호법 등 관련 법령의 규정과 일반적인 상관례에 의합니다.

## 제4조 (약관의 효력과 변경)

1. 이 약관은 서비스를 이용하고자 하는 모든 이용자에게 적용됩니다.
2. 회사는 필요한 경우 관련 법령을 위배하지 않는 범위에서 이 약관을 변경할 수 있습니다.
3. 회사가 약관을 변경할 경우에는 적용일자 및 변경사유를 명시하여 현행 약관과 함께 서비스 내 공지사항에 그 적용일자 7일 전부터 적용일자 전일까지 공지합니다. 다만, 이용자에게 불리한 약관의 변경의 경우에는 30일 전부터 공지합니다.
4. 이용자는 변경된 약관에 동의하지 않을 경우 서비스 이용을 중단하고 회원 탈퇴를 요청할 수 있습니다. 변경된 약관의 효력 발생일 이후에도 서비스를 계속 이용할 경우 약관의 변경사항에 동의한 것으로 간주됩니다.

## 제5조 (이용계약의 체결)

1. 이용계약은 이용자가 이 약관에 동의하고 회사가 정한 가입 양식에 따라 회원정보를 기입한 후 가입을 신청하고, 회사가 이를 승낙함으로써 체결됩니다.
2. 회사는 다음 각 호에 해당하는 신청에 대해서는 승낙을 하지 않거나 사후에 이용계약을 해지할 수 있습니다.
   회사는 이용신청 요건을 충족하는 모든 이용자의 신청을 승낙합니다.

## 제6조 (회원정보의 변경)

1. 회원은 개인정보 관리화면을 통하여 언제든지 본인의 개인정보를 열람하고 수정할 수 있습니다.
2. 회원은 회원가입 시 기재한 사항이 변경되었을 경우 온라인으로 수정을 하거나 전자우편 또는 기타 방법으로 회사에 그 변경사항을 알려야 합니다.
3. 제2항의 변경사항을 회사에 알리지 않아 발생한 불이익에 대하여 회사는 책임을 지지 않습니다.

## 제7조 (개인정보보호 의무)

회사는 관련 법령이 정하는 바에 따라 회원의 개인정보를 보호하기 위해 노력합니다. 개인정보의 보호 및 사용에 대해서는 관련 법령 및 회사의 개인정보처리방침이 적용됩니다.

## 제8조 (회원의 아이디 및 비밀번호의 관리에 대한 의무)

1. 회원의 아이디와 비밀번호에 관한 관리책임은 회원에게 있으며, 이를 제3자가 이용하도록 하여서는 안 됩니다.
2. 회사는 회원의 아이디가 개인정보 유출 우려가 있거나, 반사회적 또는 미풍양속에 어긋나거나 회사 및 회사의 운영자로 오인할 우려가 있는 경우, 해당 아이디의 이용을 제한할 수 있습니다.
3. 회원은 아이디 및 비밀번호가 도용되거나 제3자가 사용하고 있음을 인지한 경우에는 이를 즉시 회사에 통지하고 회사의 안내에 따라야 합니다.
4. 제3항의 경우에 해당 회원이 회사에 그 사실을 통지하지 않거나, 통지한 경우에도 회사의 안내에 따르지 않아 발생한 불이익에 대하여 회사는 책임을 지지 않습니다.

## 제9조 (이용자의 의무)

1. 이용자는 다음 행위를 하여서는 안 됩니다.
   1) 신청 또는 변경 시 허위 내용의 등록
   2) 타인의 정보 도용
   3) 회사가 게시한 정보의 변경
   4) 회사가 정한 정보 이외의 정보(컴퓨터 프로그램 등) 등의 송신 또는 게시
   5) 회사와 기타 제3자의 저작권 등 지식재산권에 대한 침해
   6) 회사 및 기타 제3자의 명예를 손상시키거나 업무를 방해하는 행위
   7) 외설 또는 폭력적인 메시지, 화상, 음성, 기타 공서양속에 반하는 정보를 서비스에 공개 또는 게시하는 행위
   8) 기타 불법적이거나 부당한 행위
2. 이용자는 관계법령, 이 약관의 규정, 이용안내 및 서비스와 관련하여 공지한 주의사항, 회사가 통지하는 사항 등을 준수하여야 하며, 기타 회사의 업무에 방해되는 행위를 하여서는 안 됩니다.

## 제10조 (서비스의 제공 및 변경)

1. 회사는 다음과 같은 서비스를 제공합니다.
   온라인 교육 콘텐츠 제공
2. 회사는 상당한 이유가 있는 경우에 운영상, 기술상의 필요에 따라 제공하고 있는 서비스를 변경할 수 있습니다.
3. 회사는 이용자에게 서비스를 제공함에 있어 관련 법령, 약관, 운영정책 및 공지사항 등에서 정한 바에 따라 무료 및 유료로 서비스를 제공합니다.

## 제11조 (서비스의 중단)

1. 회사는 컴퓨터 등 정보통신설비의 보수점검, 교체 및 고장, 통신의 두절 등의 사유가 발생한 경우에는 서비스의 제공을 일시적으로 중단할 수 있습니다.
2. 회사는 제1항의 사유로 서비스의 제공이 일시적으로 중단됨으로 인하여 이용자 또는 제3자가 입은 손해에 대하여 배상합니다. 단, 회사가 고의 또는 과실이 없음을 입증하는 경우에는 그러하지 아니합니다.
3. 사업종목의 전환, 사업의 포기, 업체 간의 통합 등의 이유로 서비스를 제공할 수 없게 되는 경우에는 회사는 제4조에 정한 방법으로 이용자에게 통지하고 당초 회사에서 제시한 조건에 따라 소비자에게 보상합니다.

## 제12조 (회원탈퇴 및 자격 상실 등)

1. 회원은 회사에 언제든지 탈퇴를 요청할 수 있으며 회사는 즉시 회원탈퇴를 처리합니다.
2. 회원이 다음 각 호의 사유에 해당하는 경우, 회사는 회원자격을 제한 및 정지시킬 수 있습니다.
   1) 가입 신청 시에 허위 내용을 등록한 경우
   2) 다른 사람의 서비스 이용을 방해하거나 그 정보를 도용하는 등 전자상거래 질서를 위협하는 경우
   3) 서비스를 이용하여 법령 또는 이 약관이 금지하거나 공서양속에 반하는 행위를 하는 경우
3. 회사가 회원 자격을 제한·정지시킨 후, 동일한 행위가 2회 이상 반복되거나 30일 이내에 그 사유가 시정되지 아니하는 경우 회사는 회원자격을 상실시킬 수 있습니다.
4. 회사가 회원자격을 상실시키는 경우에는 회원등록을 말소합니다. 이 경우 회원에게 이를 통지하고, 회원등록 말소 전에 최소한 30일 이상의 기간을 정하여 소명할 기회를 부여합니다.

## 제13조 (정보의 제공 및 광고의 게재)

회사는 회원에게 서비스 이용에 필요한 정보를 공지사항이나 전자우편 등의 방법으로 제공할 수 있습니다. 다만, 회사는 회원이 동의하지 않는 한 영리목적의 광고성 정보를 제공하지 않습니다.

## 제14조 (서비스 이용시간)

1. 서비스 이용은 회사의 업무상 또는 기술상 특별한 지장이 없는 한 연중무휴, 1일 24시간 운영을 원칙으로 합니다.
2. 회사는 서비스를 일정범위로 분할하여 각 범위별로 이용가능 시간을 별도로 정할 수 있습니다. 이 경우 그 내용을 사전에 공지합니다.

## 제15조 (서비스 이용 제한)

1. 회사는 전시, 사변, 천재지변 또는 이에 준하는 국가비상사태가 발생하거나 발생할 우려가 있는 경우와 전기통신사업법에 의한 기간통신사업자가 전기통신 서비스를 중지하는 등 기타 불가항력적 사유가 있는 경우에는 서비스의 전부 또는 일부를 제한하거나 중지할 수 있습니다.
2. 회사는 제1항에 의한 서비스 중단의 경우에는 상당한 기간 내에 그 사유를 공지하고, 사전에 공지할 수 없는 부득이한 사유가 있는 경우에는 사후에 공지합니다.

## 제16조 (유료서비스의 이용)

1. 회사는 무료서비스 이외에 유료서비스를 제공할 수 있습니다.
2. 유료서비스의 이용에 관한 사항은 해당 서비스에 대한 구체적인 안내에 따릅니다.
3. 회원이 유료서비스를 이용하기 위해서는 회사가 정한 방법에 따라 요금을 지불하여야 합니다.

## 제17조 (포인트 및 쿠폰)

회사는 현재 포인트 제도를 운영하지 않습니다.

회사는 현재 쿠폰 제도를 운영하지 않습니다.

## 제18조 (환불)

1. 회원이 유료서비스 이용 중 회사의 책임 있는 사유로 서비스를 이용하지 못한 경우, 회사는 회원이 지불한 금액에 대하여 이용하지 못한 기간에 해당하는 금액을 환불합니다.
2. 회원이 유료서비스 이용 중 회원의 변심 또는 실수로 인해 환불을 요청하는 경우, 회사는 환불 규정에 따라 환불을 처리합니다.
3. 환불 시에는 서비스 이용 기간, 결제 수단, 결제 대행사의 정책 등에 따라 환불 금액이 달라질 수 있습니다.

## 제19조 (유료서비스의 결제 등)

1. 회원은 유료서비스 이용 시 다음 각 호의 결제수단을 이용할 수 있습니다.
   카드결제
2. 회사는 결제의 이행을 위하여 반드시 필요한 회원의 개인정보를 추가적으로 요구할 수 있으며, 회원은 회사가 요구하는 개인정보를 정확하게 제공하여야 합니다.
3. 회사는 회원이 결제한 대금에 대하여 전자세금계산서를 발행합니다.

## 제20조 (책임제한)

1. 회사는 천재지변 또는 이에 준하는 불가항력으로 인하여 서비스를 제공할 수 없는 경우에는 서비스 제공에 관한 책임이 면제됩니다.
2. 회사는 회원의 귀책사유로 인한 서비스 이용의 장애에 대하여는 책임을 지지 않습니다.
3. 회사는 회원이 서비스를 이용하여 기대하는 수익을 상실한 것에 대하여 책임을 지지 않으며, 그 밖의 서비스를 통하여 얻은 자료로 인한 손해에 관하여 책임을 지지 않습니다.
4. 회사는 회원이 게재한 정보, 자료, 사실의 신뢰도, 정확성 등 내용에 관하여는 책임을 지지 않습니다.
5. 회사는 회원 간 또는 회원과 제3자 상호간에 서비스를 매개로 하여 거래 등을 한 경우에는 책임이 면제됩니다.

## 제21조 (준거법 및 재판관할)

1. 회사와 회원 간 제기된 소송은 대한민국법을 준거법으로 합니다.
2. 회사와 회원 간 발생한 분쟁에 관한 소송은 회사 소재지 관할법원의 관할로 합니다.

## 제22조 (기타)

1. 이 약관에 명시되지 않은 사항은 관련 법령의 규정에 따릅니다.
2. 회사는 필요한 경우 특정 서비스에 관하여 별도의 이용약관 및 정책을 둘 수 있으며, 해당 내용이 이 약관과 상충할 경우에는 별도의 이용약관 및 정책이 우선하여 적용됩니다.`;

function RuleItem({ ok, children }) {
  return (
    <span className={ok ? "inline-flex items-center gap-1 text-[#0f8b83]" : "inline-flex items-center gap-1 text-slate-400"}>
      <Check className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

function TermsBody() {
  return (
    <div className="max-h-[46vh] space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 pr-3 text-sm leading-6 text-slate-600">
      {TERMS_TEXT.split("\n").map((line, index) => {
        const text = line.trim();
        if (!text) return <div key={index} className="h-1" />;
        if (text.startsWith("# ")) {
          return (
            <h3 key={index} className="text-base font-extrabold text-slate-950">
              {text.replace(/^#\s+/, "")}
            </h3>
          );
        }
        if (text.startsWith("## ")) {
          return (
            <h4 key={index} className="pt-2 text-sm font-bold text-[#0f8b83]">
              {text.replace(/^##\s+/, "")}
            </h4>
          );
        }
        const isNested = /^\d+\)/.test(text);
        return (
          <p key={index} className={isNested ? "pl-4" : ""}>
            {text}
          </p>
        );
      })}
    </div>
  );
}

export default function SignupPage({ onNavigate, onOAuthStart, onHome }) {
  const [email, setEmail] = useState("");
  const [emailChecked, setEmailChecked] = useState(false);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsCheckedInDialog, setTermsCheckedInDialog] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const redirectTimerRef = useRef(null);

  const trimmedEmail = email.trim();
  const emailFormatOk = EMAIL_PATTERN.test(trimmedEmail);
  const passwordRules = useMemo(
    () => ({
      length: password.length >= 8,
      special: SPECIAL_PATTERN.test(password),
    }),
    [password]
  );
  const passwordValid = passwordRules.length && passwordRules.special;
  const confirmValid = Boolean(confirm) && password === confirm;
  const canSubmit = emailChecked && emailAvailable && passwordValid && confirmValid && termsAgreed && !loading;

  const clearRedirectTimer = () => {
    if (!redirectTimerRef.current) return;
    window.clearTimeout(redirectTimerRef.current);
    redirectTimerRef.current = null;
  };

  useEffect(() => clearRedirectTimer, []);

  const resetEmailCheck = (nextEmail) => {
    setEmail(nextEmail);
    setEmailChecked(false);
    setEmailAvailable(false);
    setEmailMessage("");
  };

  const checkEmail = async () => {
    setEmailMessage("");
    setEmailChecked(false);
    setEmailAvailable(false);

    if (!trimmedEmail) {
      setEmailMessage("이메일을 입력해주세요.");
      return;
    }
    if (!emailFormatOk) {
      setEmailMessage("이메일 형식을 확인해주세요.");
      return;
    }

    setCheckingEmail(true);
    try {
      const result = await api.emailExists(trimmedEmail);
      setEmailChecked(true);
      setEmailAvailable(!result.exists);
      setEmailMessage(result.exists ? "이미 가입된 이메일입니다." : "사용할 수 있는 이메일입니다.");
    } catch {
      setEmailMessage("이메일 중복 확인에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setCheckingEmail(false);
    }
  };

  const submit = async () => {
    clearRedirectTimer();
    setStatus("");

    if (!emailChecked || !emailAvailable) {
      setEmailMessage("이메일 중복 확인을 먼저 완료해주세요.");
      return;
    }
    if (!passwordValid) {
      setStatus("비밀번호 조건을 확인해주세요.");
      return;
    }
    if (!confirmValid) {
      setStatus("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (!termsAgreed) {
      setStatus("서비스 약관에 동의해주세요.");
      return;
    }

    setLoading(true);
    let redirectPending = false;
    try {
      const res = await api.register(trimmedEmail, password);
      if (res.ok) {
        setStatus("회원가입이 완료되었습니다. 로그인해주세요.");
        redirectPending = true;
        redirectTimerRef.current = window.setTimeout(() => {
          redirectTimerRef.current = null;
          onNavigate("login");
        }, 800);
      } else if (res.detail === "REGISTER_USER_ALREADY_EXISTS") {
        setEmailChecked(true);
        setEmailAvailable(false);
        setEmailMessage("이미 가입된 이메일입니다.");
      } else {
        setStatus("회원가입에 실패했습니다. 입력값을 확인해주세요.");
      }
    } catch {
      setStatus("회원가입 요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      if (!redirectPending) setLoading(false);
    }
  };

  return (
    <AuthCard
      title="회원가입"
      onHome={onHome}
      activeMode="signup"
      onModeChange={(mode) => mode === "login" && onNavigate("login")}
      privacyNotice="이메일 주소와 학습 기능에 필요한 정보만 안전하게 저장해요."
      footer={
        <Button
          type="button"
          variant="ghost"
          onClick={() => onNavigate("login")}
          disabled={loading}
          className="w-full text-slate-600"
        >
          이미 계정이 있으신가요? <span className="font-bold text-[#0f8b83]">로그인</span>
        </Button>
      }
    >
      <div className="space-y-4">
        <GoogleButton label="Google 계정으로 가입하기" onStart={onOAuthStart} disabled={loading} />

        <div className="flex items-center gap-3 py-1 text-xs font-semibold text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          또는
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <Field>
          <FieldLabel htmlFor="signup-email" className="text-slate-700">이메일 *</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="signup-email"
              value={email}
              onChange={(e) => resetEmailCheck(e.target.value)}
              disabled={loading}
              placeholder="you@example.com"
              className={`min-w-0 ${emailChecked && emailAvailable ? "border-[#0f8b83] focus-visible:ring-[#0f8b83]/20" : emailMessage && !emailAvailable ? "border-rose-400 focus-visible:ring-rose-200" : ""}`}
            />
            <Button
              type="button"
              variant="outline"
              onClick={checkEmail}
              disabled={loading || checkingEmail || !emailFormatOk}
              className="h-10 shrink-0 border-[#0f8b83]/30 px-3 font-bold text-[#0f8b83] hover:bg-[#eefaf8]"
            >
              {checkingEmail ? <Spinner /> : "중복 확인"}
            </Button>
          </div>
          {emailMessage && (
            <p className={`text-sm font-medium ${emailAvailable ? "text-[#0f8b83]" : "text-rose-600"}`}>
              {emailMessage}
            </p>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="signup-password" className="text-slate-700">비밀번호 *</FieldLabel>
          <div className="relative">
            <Input
              id="signup-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="pr-10 focus-visible:ring-[#0f8b83]/25"
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
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <RuleItem ok={passwordRules.length}>8자 이상</RuleItem>
            <RuleItem ok={passwordRules.special}>특수문자 포함</RuleItem>
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="signup-confirm" className="text-slate-700">비밀번호 확인 *</FieldLabel>
          <div className="relative">
            <Input
              id="signup-confirm"
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
              className={`pr-10 ${confirm && !confirmValid ? "border-rose-400 focus-visible:ring-rose-200" : "focus-visible:ring-[#0f8b83]/25"}`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label={showConfirm ? "비밀번호 확인 숨기기" : "비밀번호 확인 보기"}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {confirm && !confirmValid && <p className="text-sm font-medium text-rose-600">비밀번호가 일치하지 않습니다.</p>}
        </Field>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">서비스 약관 동의</p>
              <p className="mt-0.5 text-xs text-slate-500">
                필수 약관을 확인한 뒤 동의해주세요.
              </p>
            </div>
            <Button
              type="button"
              variant={termsAgreed ? "secondary" : "outline"}
              onClick={() => {
                setTermsCheckedInDialog(termsAgreed);
                setTermsOpen(true);
              }}
              className="shrink-0"
            >
              {termsAgreed ? "동의 완료" : "약관 보기"}
            </Button>
          </div>
        </div>

        <Button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="h-12 w-full bg-[#0f8b83] text-base font-bold hover:bg-[#0b756f] disabled:bg-[#c7d8f8] disabled:text-white"
        >
          {loading && <Spinner />}
          {loading ? "처리 중" : "계정 만들기"}
        </Button>

        {status && <FieldDescription className={status.includes("완료") ? "text-[#0f8b83]" : "text-rose-600"}>{status}</FieldDescription>}
      </div>

      <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>서비스 이용 동의</DialogTitle>
            <DialogDescription>
              약관을 확인한 뒤 필수 동의에 체크해주세요.
            </DialogDescription>
            <p className="text-xs font-medium text-slate-400">
              최종 업데이트: 2026.07.01
            </p>
          </DialogHeader>
          <TermsBody />
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Checkbox
              checked={termsCheckedInDialog}
              onCheckedChange={(checked) => setTermsCheckedInDialog(checked === true)}
            />
            위 내용을 확인했고 필수 약관에 동의합니다.
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTermsOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              disabled={!termsCheckedInDialog}
              onClick={() => {
                setTermsAgreed(true);
                setTermsOpen(false);
              }}
              className="bg-[#0f8b83] hover:bg-[#0b756f]"
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthCard>
  );
}
