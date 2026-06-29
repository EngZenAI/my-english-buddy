import { Skeleton } from "@/components/ui/skeleton";

export function LoadingSpinner({
  label = "불러오는 중",
  className = "text-muted-foreground",
  spinnerClassName = "border-slate-200 border-t-brand-600",
}) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span
        aria-hidden="true"
        className={`h-4 w-4 rounded-full border-2 animate-spin ${spinnerClassName}`}
      />
      {label}
    </span>
  );
}

export function SkeletonBlock({ className = "" }) {
  return <Skeleton className={className} />;
}

export function EmptyState({ title, description }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/50 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
