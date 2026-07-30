import { useEffect, useRef } from "react";
import { attachTerminal, fitTerminal } from "./registry";

interface TerminalViewProps {
  sessionId: string;
  active: boolean;
}

export function TerminalView({
  sessionId,
  active,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    attachTerminal(sessionId, container);
    const observer = new ResizeObserver(() => {
      if (active) fitTerminal(sessionId);
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [sessionId, active]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => fitTerminal(sessionId));
    }
  }, [active, sessionId]);

  return (
    <div
      className={`terminal-view ${active ? "terminal-view--active" : ""}`}
      ref={containerRef}
      aria-label="SSH terminal"
    />
  );
}
