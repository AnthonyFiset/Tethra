import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import { attachTerminal, fitTerminal } from "./registry";

interface TerminalViewProps {
  sessionId: string;
  /** Whether this pane/tab is the keyboard focus target. */
  active: boolean;
  /** When false, keep mounted but hide (tab stack). Pane mode stays visible. */
  visible?: boolean;
  color: string;
  /** Fill a split pane instead of absolute stacking. */
  pane?: boolean;
}

export function TerminalView({
  sessionId,
  active,
  visible = true,
  color,
  pane = false,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    attachTerminal(sessionId, container);
    let fitTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (!visible) return;
      window.clearTimeout(fitTimer);
      fitTimer = window.setTimeout(() => fitTerminal(sessionId), 180);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.clearTimeout(fitTimer);
    };
  }, [sessionId, visible]);

  useEffect(() => {
    if (active && visible) {
      requestAnimationFrame(() => fitTerminal(sessionId));
    }
  }, [active, visible, sessionId]);

  return (
    <div
      ref={containerRef}
      aria-label="SSH terminal"
      className={cn(
        "overflow-hidden bg-base px-3 py-2",
        pane
          ? "size-full"
          : cn(
              "absolute inset-0",
              visible ? "z-10 block" : "-z-10 invisible",
            ),
      )}
      style={{ borderTop: `1px solid ${color}` }}
    />
  );
}
