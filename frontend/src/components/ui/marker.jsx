import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const markerVariants = cva(
  "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-background text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        primary: "border-transparent bg-primary/10 text-primary",
        warning: "border-amber-200 bg-amber-50 text-amber-800",
        destructive: "border-rose-200 bg-rose-50 text-rose-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Marker = React.forwardRef(
  ({ className, variant, icon: Icon, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(markerVariants({ variant }), className)}
      {...props}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
);
Marker.displayName = "Marker";

function MarkerGroup({ className, ...props }) {
  return <div className={cn("flex flex-wrap items-center gap-1.5", className)} {...props} />;
}

export { Marker, MarkerGroup, markerVariants };
