import * as React from "react";
import { cn } from "@/lib/utils";

const ChartContainer = React.forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("h-64 w-full text-xs", className)}
    {...props}
  >
    {children}
  </div>
));
ChartContainer.displayName = "ChartContainer";

function ChartTooltipContent({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="min-w-32 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1.5 font-black text-slate-900">{label}</p>}
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={`${item.dataKey}-${item.name}`} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-500">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.name}
            </span>
            <span className="font-black text-slate-900">
              {formatter ? formatter(item.value, item.name, item) : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltipContent };
