import type { HostSummaryDto } from "../lib/ipc";
import { cn } from "../lib/cn";
import { SurfaceShell } from "../surfaces/SurfaceShell";
import { Button } from "./ui/Button";

interface TunnelsViewProps {
  hosts: HostSummaryDto[];
  activeTunnelCount: number;
  onClose: () => void;
}

/** All configured port forwards across the vault. */
export function TunnelsView({
  hosts,
  activeTunnelCount,
  onClose,
}: TunnelsViewProps): React.JSX.Element {
  const rows = hosts.flatMap((host) =>
    host.tunnels.map((tunnel) => ({ host, tunnel })),
  );

  return (
    <SurfaceShell
      title="Tunnels"
      description="Port forwards defined on your hosts. Start and stop live tunnels from an open session."
      onClose={onClose}
    >
      <div className="mb-4 flex items-center gap-2 text-micro text-fg-muted">
        <span className="rounded-full border border-line px-2 py-0.5">
          {activeTunnelCount} active
        </span>
        <span>{rows.length} configured</span>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-ui text-fg-muted">
          No tunnels configured yet. Add port forwards on a host, then open a
          terminal session to start them.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map(({ host, tunnel }) => (
            <li
              key={`${host.id}-${tunnel.id}`}
              className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-ui font-medium text-fg">{tunnel.label}</div>
                <div className="font-mono text-micro text-fg-muted">
                  {host.label} · {tunnel.direction === "local" ? "local" : "remote"}{" "}
                  :{tunnel.bindPort} → {tunnel.targetHost}:{tunnel.targetPort}
                </div>
              </div>
              {tunnel.autoStart && (
                <span className="rounded border border-line px-1.5 py-px text-[10px] text-fg-subtle">
                  auto
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button className="mt-4" variant="subtle" onClick={onClose}>
        Back to hosts
      </Button>
    </SurfaceShell>
  );
}
