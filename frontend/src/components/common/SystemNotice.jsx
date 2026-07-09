import { Alert, AlertDescription } from "../ui/alert";
import { BuddyLogo } from "./BuddyIcon";

export default function SystemNotice({ children, className = "", icon = true, action = null }) {
  return (
    <Alert
      className={`flex items-center justify-between gap-3 border-[#9ccfc4] bg-[#e7f3ef] px-4 py-3 text-slate-900 shadow-sm ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
        <BuddyLogo className="h-9 w-9 shrink-0" />
      )}
        <AlertDescription className="max-w-2xl text-sm font-semibold leading-6 text-slate-900">
          {children}
        </AlertDescription>
      </div>
      {action}
    </Alert>
  );
}
