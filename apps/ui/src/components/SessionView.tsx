import { useEffect, useState } from "react";
import type { HostSummaryDto } from "../lib/ipc";
import {
  sessionScreenApp,
  setBlockSessionContext,
  subscribeBlockChanges,
} from "../terminal/blocks";
import { focusTerminal } from "../terminal/registry";
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

  // Full-screen app (Claude Code, Codex, vim…) owns the session: drop the
  // prompt panel entirely so the terminal gets the rows and keys go straight
  // to xterm. The panel returns on the next shell prompt.
  const [screenApp, setScreenApp] = useState(() => sessionScreenApp(sessionId));
  useEffect(() => {
    setScreenApp(sessionScreenApp(sessionId));
    return subscribeBlockChanges(sessionId, () => {
      setScreenApp(sessionScreenApp(sessionId));
    });
  }, [sessionId]);
  useEffect(() => {
    if (screenApp && active && (visible ?? true)) focusTerminal(sessionId);
  }, [screenApp, active, visible, sessionId]);

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
      {screenApp ? null : (
        <PromptPanel
          sessionId={sessionId}
          active={active && connected && (visible ?? true)}
          cwd={cwd}
          gitBranch={gitBranch}
          meta={metaParts.length > 0 ? metaParts.join(" · ") : undefined}
        />
      )}
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
