import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const MessageScroller = React.forwardRef(
  ({ className, contentClassName, children, ...props }, ref) => {
    const viewportRef = React.useRef(null);

    React.useImperativeHandle(ref, () => ({
      scrollToBottom() {
        const viewport = viewportRef.current;
        if (!viewport) return;
        viewport.scrollTop = viewport.scrollHeight;
      },
      get viewport() {
        return viewportRef.current;
      },
    }));

    return (
      <ScrollAreaPrimitive.Root
        className={cn(
          "relative overflow-hidden rounded-lg border border-border bg-muted/30",
          className
        )}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          ref={viewportRef}
          className="h-full w-full rounded-[inherit]"
        >
          <div className={cn("space-y-3 p-3", contentClassName)}>{children}</div>
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    );
  }
);
MessageScroller.displayName = "MessageScroller";

export { MessageScroller };
