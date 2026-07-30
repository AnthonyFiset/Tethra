import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import { attachTerminal, fitTerminal } from "./registry";

interface TerminalViewProps {
  sessionId: string;
  active: boolean;
  color: string;
}

export function TerminalView({
  sessionId,
  active,
  color,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    attachTerminal(sessionId, container);
    let fitTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (!active) return;
      window.clearTimeout(fitTimer);
      fitTimer = window.setTimeout(() => fitTerminal(sessionId), 180);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.clearTimeout(fitTimer);
    };
  }, [sessionId, active]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => fitTerminal(sessionId));
    }
  }, [active, sessionId]);

  return (
    <div
      ref={containerRef}
      aria-label="SSH terminal"
      // Inactive tabs stay mounted so scrollback and the PTY survive switching.
      className={cn(
        "absolute inset-0 overflow-hidden bg-base px-3 py-2",
        active ? "z-10 block" : "-z-10 invisible",
      )}
      style={{ borderTop: `1px solid ${color}` }}
    />
  );
}
