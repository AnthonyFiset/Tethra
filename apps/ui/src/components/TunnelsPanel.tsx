import { useEffect, useState } from "react";
import {
  onTunnelChanged,
  tunnelList,
  tunnelStart,
  tunnelStop,
  type TunnelStatusDto,
} from "../lib/ipc";
import { Button } from "./ui/Button";
import { cn } from "../lib/cn";

interface TunnelsPanelProps {
  sessionId: string;
  connected: boolean;
  agentForward?: string;
  agentForwardHint?: string;
  /** Compact chip strip + expandable list. */
  className?: string;
}

function stateClass(state: string): string {
  switch (state) {
    case "active":
      return "bg-success/15 text-success";
    case "error":
      return "bg-danger/15 text-danger";
    case "starting":
      return "bg-warning/15 text-warning";
    default:
      return "bg-hover text-fg-muted";
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function TunnelsPanel({
  sessionId,
  connected,
  agentForward,
  agentForwardHint,
  className,
}: TunnelsPanelProps): React.JSX.Element | null {
  const [tunnels, setTunnels] = useState<TunnelStatusDto[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!connected) {
      setTunnels([]);
      return;
    }
    let cancelled = false;
    void tunnelList(sessionId)
      .then((list) => {
        if (!cancelled) setTunnels(list);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, connected]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onTunnelChanged((status) => {
      if (status.sessionId !== sessionId) return;
      setTunnels((current) => {
        const idx = current.findIndex((t) => t.tunnelId === status.tunnelId);
        if (idx < 0) {
          if (status.tunnelId === "00000000-0000-0000-0000-000000000000") {
            return current;
          }
          return [...current, status];
        }
        const next = current.slice();
        next[idx] = status;
        return next;
      });
      if (status.state === "error" && status.error) {
        setError(status.error);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [sessionId]);

  if (!connected) return null;
  const showAgent = agentForward === "active" || agentForward === "unavailable";
  if (tunnels.length === 0 && !showAgent) return null;

  const activeCount = tunnels.filter((t) => t.state === "active").length;

  async function toggle(tunnel: TunnelStatusDto): Promise<void> {
    setError(undefined);
    setBusyId(tunnel.tunnelId);
    try {
      const next =
        tunnel.state === "active"
          ? await tunnelStop(sessionId, tunnel.tunnelId)
          : await tunnelStart(sessionId, tunnel.tunnelId);
      setTunnels((current) =>
        current.map((t) => (t.tunnelId === next.tunnelId ? next : t)),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className={cn("border-b border-line bg-elevated/40", className)}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-micro text-fg-muted hover:bg-hover/60"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="font-medium text-fg">
          {tunnels.length > 0 ? "Tunnels" : "Forwards"}
        </span>
        {tunnels.length > 0 && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
              activeCount > 0
                ? "bg-success/15 text-success"
                : "bg-hover text-fg-subtle",
            )}
          >
            {activeCount} active
          </span>
        )}
        {showAgent && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
              agentForward === "active"
                ? "bg-success/15 text-success"
                : "bg-warning/15 text-warning",
            )}
            title={agentForwardHint}
          >
            {agentForward === "active" ? "Agent on" : "Agent unavailable"}
          </span>
        )}
        <span className="ml-auto text-fg-subtle">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2">
          {showAgent && (
            <p
              className={cn(
                "text-micro",
                agentForward === "active" ? "text-fg-muted" : "text-warning",
              )}
            >
              {agentForward === "active"
                ? "SSH agent forwarding is active for this session."
                : (agentForwardHint ??
                  "agent forwarding unavailable — no local SSH agent")}
            </p>
          )}
          {error && (
            <p className="text-micro text-danger" role="alert">
              {error}
            </p>
          )}
          {tunnels.map((tunnel) => {
            const arrow = tunnel.direction === "remote" ? "←" : "→";
            const summary = `:${tunnel.bindPort} ${arrow} ${tunnel.targetHost}:${tunnel.targetPort}`;
            return (
              <div
                key={tunnel.tunnelId}
                className="flex flex-wrap items-center gap-2 rounded border border-line bg-base px-2.5 py-1.5"
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
                    stateClass(tunnel.state),
                  )}
                >
                  {tunnel.state}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ui text-fg">
                    {tunnel.label || summary}
                  </div>
                  <div className="truncate text-micro text-fg-subtle">
                    {tunnel.direction === "remote" ? "Remote" : "Local"}{" "}
                    {summary}
                    {tunnel.error ? ` — ${tunnel.error}` : ""}
                  </div>
                </div>
                {tunnel.localUrl && tunnel.state === "active" && (
                  <Button
                    type="button"
                    variant="subtle"
                    className="!px-2 !py-1 text-micro"
                    onClick={() => void copyText(tunnel.localUrl!)}
                  >
                    Copy
                  </Button>
                )}
                <Button
                  type="button"
                  variant="subtle"
                  className="!px-2 !py-1 text-micro"
                  disabled={busyId === tunnel.tunnelId}
                  onClick={() => void toggle(tunnel)}
                >
                  {tunnel.state === "active" ? "Stop" : "Start"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
