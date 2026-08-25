import { useEffect } from "react";
import type { HostSummaryDto } from "../lib/ipc";
import { setBlockSessionContext } from "../terminal/blocks";
import { PromptPanel } from "./PromptPanel";
import { TerminalView } from "../terminal/TerminalView";

interface SessionViewProps {
  sessionId: string;
  host?: HostSummaryDto;
  cwd?: string;
  gitBranch?: string;
  connected: boolean;
  active: boolean;
  visible?: boolean;
  color: string;
  pane?: boolean;
  findOpen?: boolean;
  waiting?: boolean;
  waitingMessage?: string;
  isAgentSession?: boolean;
  onReview?: () => void;
  onJumpToAgent?: () => void;
  onFindOpen?: () => void;
  onFindClose?: () => void;
  onPaste?: (text: string) => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onClose?: () => void;
  onAssist?: () => void;
  sessionStartedAt?: string;
}

export function SessionView({
  sessionId,
  host,
  cwd,
  gitBranch,
  connected,
  active,
  visible,
  color,
  pane,
  findOpen,
  waiting,
  waitingMessage,
  isAgentSession,
  onReview,
  onJumpToAgent,
  onFindOpen,
  onFindClose,
  onPaste,
  onSplitRight,
  onSplitDown,
  onClose,
  onAssist,
  sessionStartedAt,
}: SessionViewProps): React.JSX.Element {
  const metaParts: string[] = [];
  if (connected) metaParts.push("tmux");
  if (sessionStartedAt) {
    metaParts.push(`up ${formatUptime(sessionStartedAt)}`);
  }
  if (host) metaParts.push(host.hostname);

  useEffect(() => {
    setBlockSessionContext(sessionId, {
      waiting,
      waitingMessage,
      isAgentSession,
      onReview,
      onJumpToAgent,
    });
  }, [
    sessionId,
    waiting,
    waitingMessage,
    isAgentSession,
    onReview,
    onJumpToAgent,
  ]);

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-visible">
        <TerminalView
          sessionId={sessionId}
          active={active}
          visible={visible}
          color={color}
          pane={pane}
          findOpen={findOpen}
          onFindOpen={onFindOpen}
          onFindClose={onFindClose}
          onPaste={onPaste}
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
          onClose={onClose}
          onAssist={onAssist}
          chrome="session"
        />
        {!connected ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-base/70">
            <p className="font-mono text-[13px] text-fg-muted">
              Connecting to {host?.label ?? host?.hostname ?? "host"}…
            </p>
          </div>
        ) : null}
      </div>
      <PromptPanel
        sessionId={sessionId}
        active={active && connected && (visible ?? true)}
        cwd={cwd}
        gitBranch={gitBranch}
        meta={metaParts.length > 0 ? metaParts.join(" · ") : undefined}
      />
    </div>
  );
}

function formatUptime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}
