import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

// 비회원에게 "회원 전용 기능"임을 알리고 로그인으로 유도하는 배너
export default function MemberNotice({ feature = "이 기능", onRequireLogin }) {
  return (
    <Alert className="mb-4 flex items-center justify-between gap-3 border-amber-200 bg-amber-50 text-amber-900">
      <span className="inline-flex items-center gap-2 text-sm">
        <Lock className="h-4 w-4" />
        {feature}은(는) 회원 전용이에요. 로그인하면 바로 사용할 수 있어요.
      </span>
      <Button
        type="button"
        size="sm"
        onClick={onRequireLogin}
      >
        로그인
      </Button>
    </Alert>
  );
}
