import { useCallback, useEffect, useState } from "react";

const DEFAULT_MARGIN = 16;
const DEFAULT_SIZE = 56;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function viewportSize() {
  if (typeof window === "undefined") return { width: 1280, height: 720 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function defaultPosition({ margin, size }) {
  const viewport = viewportSize();
  return {
    x: Math.max(margin, viewport.width - size - margin),
    y: Math.max(margin, viewport.height - size - 80),
  };
}

function clampPosition(position, { margin, size }) {
  const viewport = viewportSize();
  return {
    x: clamp(position.x, margin, Math.max(margin, viewport.width - size - margin)),
    y: clamp(position.y, margin, Math.max(margin, viewport.height - size - margin)),
  };
}

function readPosition(storageKey, options) {
  if (typeof window === "undefined") return defaultPosition(options);
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return clampPosition(saved, options);
    }
  } catch {
    window.localStorage.removeItem(storageKey);
  }
  return defaultPosition(options);
}

export function useFloatingWidget({
  storageKey,
  margin = DEFAULT_MARGIN,
  size = DEFAULT_SIZE,
  panelGap = 16,
  panelMaxWidth = 384,
  panelMaxHeight = 544,
  panelViewportOffset = 160,
}) {
  const options = { margin, size };
  const [position, setPosition] = useState(() => readPosition(storageKey, options));

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleResize = () => {
      setPosition((current) => clampPosition(current, options));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [margin, size]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(position));
  }, [position, storageKey]);

  const moveBy = useCallback((delta) => {
    setPosition((current) => clampPosition({
      x: current.x + (delta?.x || 0),
      y: current.y + (delta?.y || 0),
    }, options));
  }, [margin, size]);

  const launcherStyle = {
    left: position.x,
    top: position.y,
  };

  const viewport = viewportSize();
  const panelWidth = Math.max(280, Math.min(panelMaxWidth, viewport.width - margin * 2));
  const panelHeight = Math.max(280, Math.min(panelMaxHeight, viewport.height - panelViewportOffset));
  const panelStyle = {
    left: clamp(
      position.x + size - panelWidth,
      margin,
      Math.max(margin, viewport.width - panelWidth - margin),
    ),
    top: clamp(
      position.y - panelHeight - panelGap,
      margin,
      Math.max(margin, viewport.height - panelHeight - margin),
    ),
    width: panelWidth,
    height: panelHeight,
  };

  return {
    launcherStyle,
    panelStyle,
    moveBy,
  };
}
