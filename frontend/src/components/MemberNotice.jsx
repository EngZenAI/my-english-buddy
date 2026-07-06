import { Button } from "@/components/ui/button";
import SystemNotice from "./common/SystemNotice";

// 비회원에게 회원 전용 기능임을 알리고 로그인으로 유도하는 배너
export default function MemberNotice({ message = "", children = null, feature = "이 기능", onRequireLogin }) {
  const content = children || message || `${feature} 기능은 회원 전용이에요. 로그인하면 바로 사용할 수 있어요.`;

  return (
    <SystemNotice
      className="mb-4"
      action={
        <Button type="button" size="sm" onClick={onRequireLogin} className="shrink-0">
          로그인
        </Button>
      }
    >
      {content}
    </SystemNotice>
  );
}
