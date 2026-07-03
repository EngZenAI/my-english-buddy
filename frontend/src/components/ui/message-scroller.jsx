import * as React from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

const MessageScrollerContext = React.createContext(null);

function isNearEnd(element, threshold = 72) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function MessageScrollerProvider({
  autoScroll = false,
  defaultScrollPosition = "end",
  scrollPreviousItemPeek,
  children,
}) {
  const viewportRef = React.useRef(null);
  const shouldStickToEndRef = React.useRef(true);
  const [atEnd, setAtEnd] = React.useState(true);

  const updatePosition = React.useCallback(() => {
    const viewport = viewportRef.current;
    const nextAtEnd = isNearEnd(viewport);
    shouldStickToEndRef.current = nextAtEnd;
    setAtEnd(nextAtEnd);
  }, []);

  const scrollToEnd = React.useCallback(({ behavior = "smooth" } = {}) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    shouldStickToEndRef.current = true;
    setAtEnd(true);
  }, []);

  const value = React.useMemo(
    () => ({
      atEnd,
      autoScroll,
      defaultScrollPosition,
      scrollPreviousItemPeek,
      scrollToEnd,
      shouldStickToEndRef,
      updatePosition,
      viewportRef,
    }),
    [atEnd, autoScroll, defaultScrollPosition, scrollPreviousItemPeek, scrollToEnd, updatePosition]
  );

  return (
    <MessageScrollerContext.Provider value={value}>
      {children}
    </MessageScrollerContext.Provider>
  );
}

function useMessageScroller() {
  const context = React.useContext(MessageScrollerContext);
  if (!context) {
    return {
      atEnd: true,
      scrollToEnd: () => {},
    };
  }
  return context;
}

function useMessageScrollerScrollable() {
  const { viewportRef } = useMessageScroller();
  const viewport = viewportRef?.current;
  return Boolean(viewport && viewport.scrollHeight > viewport.clientHeight);
}

function useMessageScrollerVisibility() {
  const { atEnd, updatePosition } = useMessageScroller();

  React.useEffect(() => {
    updatePosition?.();
  }, [updatePosition]);

  return {
    active: !atEnd,
    visible: !atEnd,
  };
}

function MessageScroller({ className, ...props }) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/30",
        className
      )}
      {...props}
    />
  );
}

function MessageScrollerViewport({ className, ...props }) {
  const { viewportRef, updatePosition } = useMessageScroller();

  React.useLayoutEffect(() => {
    updatePosition?.();
  }, [updatePosition]);

  return (
    <div
      ref={viewportRef}
      onScroll={updatePosition}
      className={cn("min-h-0 flex-1 overflow-y-auto rounded-[inherit]", className)}
      {...props}
    />
  );
}

function MessageScrollerContent({ className, spacerClassName, ...props }) {
  const {
    autoScroll,
    defaultScrollPosition,
    scrollToEnd,
    shouldStickToEndRef,
    updatePosition,
  } = useMessageScroller();
  const contentRef = React.useRef(null);

  React.useLayoutEffect(() => {
    if (defaultScrollPosition === "end" || defaultScrollPosition === "last-anchor") {
      scrollToEnd({ behavior: "auto" });
    }
  }, [defaultScrollPosition, scrollToEnd]);

  React.useLayoutEffect(() => {
    if (!autoScroll || !shouldStickToEndRef.current) {
      updatePosition?.();
      return;
    }
    scrollToEnd({ behavior: "auto" });
  }, [autoScroll, props.children, scrollToEnd, updatePosition]);

  return (
    <div
      ref={contentRef}
      className={cn("flex flex-col gap-3 p-3", className)}
      {...props}
    >
      {props.children}
      <div aria-hidden="true" className={cn("shrink-0", spacerClassName)} />
    </div>
  );
}

function MessageScrollerItem({ className, messageId, scrollAnchor, ...props }) {
  return (
    <div
      className={cn("min-w-0", className)}
      data-message-id={messageId}
      data-scroll-anchor={scrollAnchor ? "" : undefined}
      {...props}
    />
  );
}

function MessageScrollerButton({ className, children = "최근 답변 보기", ...props }) {
  const { atEnd, scrollToEnd } = useMessageScroller();

  return (
    <button
      type="button"
      data-active={atEnd ? "false" : "true"}
      onClick={() => scrollToEnd()}
      className={cn(
        "absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm transition hover:bg-emerald-50 inert:pointer-events-none inert:opacity-0 data-[active=false]:pointer-events-none data-[active=false]:opacity-0",
        className
      )}
      {...props}
    >
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
      {children}
    </button>
  );
}

export {
  MessageScroller,
  MessageScrollerProvider,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
