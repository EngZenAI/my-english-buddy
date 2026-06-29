import { cn } from "@/lib/utils";

export default function Spinner({ className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin",
        className
      )}
    />
  );
}
