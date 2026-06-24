// 비회원에게 "회원 전용 기능"임을 알리고 로그인으로 유도하는 배너
export default function MemberNotice({ feature = "이 기능", onRequireLogin }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3
                    flex items-center justify-between gap-3">
      <span className="text-sm text-amber-800">
        🔒 {feature}은(는) 회원 전용이에요. 로그인하면 바로 사용할 수 있어요.
      </span>
      <button
        onClick={onRequireLogin}
        className="rounded-lg bg-brand-600 text-white text-sm font-semibold px-3 h-8
                   whitespace-nowrap hover:bg-brand-700"
      >
        로그인
      </button>
    </div>
  );
}
