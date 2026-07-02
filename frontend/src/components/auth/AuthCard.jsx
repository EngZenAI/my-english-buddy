import { ShieldCheck } from "lucide-react";
import englishBuddyLogo from "@/assets/english-buddy-logo.svg";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function AuthCard({
  title,
  description,
  children,
  footer,
  activeMode,
  onModeChange,
  onHome,
  privacyNotice,
}) {
  const showModeTabs = Boolean(activeMode && onModeChange);

  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(circle_at_top,#f6f3ea_0,#fbfaf7_45%,#f7f5ef_100%)] px-4 py-8 sm:py-10">
      <div className="w-full max-w-md">
        <Card className="overflow-hidden rounded-xl border-[#ddd8cf] bg-white/95 shadow-[0_20px_50px_rgba(72,64,49,0.12)]">
          <CardHeader className="space-y-5 p-8 pb-5">
            <div className="flex items-start justify-center">
              <button
                type="button"
                onClick={onHome}
                className="flex min-w-0 items-center gap-3 rounded-lg text-left outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#0f8b83]/25"
                aria-label="홈으로 이동"
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center">
                  <img
                    src={englishBuddyLogo}
                    alt=""
                    aria-hidden="true"
                    className="h-14 w-14"
                    draggable="false"
                  />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-2xl font-extrabold tracking-normal text-[#0f8b83]">
                    English Buddy
                  </p>
                </div>
              </button>
            </div>

            {showModeTabs && (
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {[
                  { id: "login", label: "로그인" },
                  { id: "signup", label: "회원가입" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onModeChange(item.id)}
                    className={cn(
                      "h-11 rounded-md text-sm font-bold transition-colors",
                      activeMode === item.id
                        ? "bg-[#0f8b83] text-white shadow-sm"
                        : "text-slate-500 hover:bg-white hover:text-slate-900"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <div>
              <CardTitle className="text-xl text-slate-950">{title}</CardTitle>
              {description && (
                <CardDescription className="mt-1.5 leading-6">
                  {description}
                </CardDescription>
              )}
            </div>
          </CardHeader>

          <CardContent className="px-8 pb-6">{children}</CardContent>

          {privacyNotice && (
            <div className="mx-8 border-t border-slate-100 py-4">
              <div className="flex items-start gap-2 rounded-lg bg-[#f0faf8] px-3 py-2.5 text-sm text-[#23655f]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-5">{privacyNotice}</p>
              </div>
            </div>
          )}

          {footer && (
            <CardFooter className="border-t border-slate-100 bg-slate-50/70 px-8 py-4">
              {footer}
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
