import * as React from "react";
import { Lightbulb, UserRound } from "lucide-react";
import englishBuddyLogo from "@/assets/english-buddy-logo.svg";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function getUserInitials(user) {
  if (!user?.email) return "U";
  return user.email.substring(0, 2).toUpperCase();
}

function MessageAvatar({ role, user, className }) {
  const isUser = role === "user";
  return (
    <Avatar
      className={cn(
        "mt-0.5 h-8 w-8",
        isUser
          ? "border border-primary/20 bg-primary text-primary-foreground"
          : "bg-transparent text-muted-foreground",
        className
      )}
    >
      {isUser && user?.avatar_url && (
        <AvatarImage src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback
        className={cn(
          "bg-transparent text-xs font-bold",
          isUser ? "text-primary-foreground" : "text-muted-foreground"
        )}
      >
        {isUser ? (
          user?.email ? getUserInitials(user) : <UserRound className="h-4 w-4" />
        ) : (
          <img src={englishBuddyLogo} alt="" aria-hidden="true" className="h-5 w-5" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}

function MessageTyping({ label = "답변 작성 중" }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      {label && <span>{label}</span>}
      <span className="inline-flex gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
      </span>
    </span>
  );
}

function MessageCoaching({ className, children }) {
  if (!children) return null;
  return (
    <div
      className={cn(
        "mt-2 flex max-w-[min(36rem,92%)] items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 shadow-sm",
        className
      )}
    >
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function Message({
  role = "assistant",
  user,
  children,
  coaching,
  loading = false,
  loadingLabel = "답변 작성 중",
  className,
}) {
  const isUser = role === "user";

  return (
    <div className={cn("flex w-full gap-2", isUser && "justify-end", className)}>
      {!isUser && <MessageAvatar role={role} user={user} />}
      <div className={cn("flex min-w-0 max-w-[82%] flex-col", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm",
            isUser
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md border border-border bg-background text-foreground"
          )}
        >
          <div className="whitespace-pre-wrap break-words">
            {loading ? <MessageTyping label={loadingLabel} /> : children}
          </div>
        </div>
        {!isUser && <MessageCoaching>{coaching}</MessageCoaching>}
      </div>
      {isUser && <MessageAvatar role={role} user={user} />}
    </div>
  );
}

export { Message, MessageAvatar, MessageCoaching, MessageTyping };
