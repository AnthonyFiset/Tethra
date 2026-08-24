import type { HostSummaryDto } from "../lib/ipc";
import { SurfaceShell } from "../surfaces/SurfaceShell";
import { hostTileAvatarStyle } from "../lib/tagColors";
import { Button } from "./ui/Button";

interface FilesViewProps {
  hosts: HostSummaryDto[];
  openingFilesHostId?: string;
  onOpenFiles: (host: HostSummaryDto) => void;
  onClose: () => void;
}

/** Pick a host to browse files over SFTP. */
export function FilesView({
  hosts,
  openingFilesHostId,
  onOpenFiles,
  onClose,
}: FilesViewProps): React.JSX.Element {
  return (
    <SurfaceShell
      title="Files"
      description="Browse remote files over SFTP. Pick a host to open a file browser tab."
      onClose={onClose}
    >
      {hosts.length === 0 ? (
        <p className="m-0 text-ui text-fg-muted">
          Add a host first, then return here to browse its filesystem.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {hosts.map((host) => {
            const avatar = hostTileAvatarStyle(host.color);
            const busy = openingFilesHostId === host.id;
            return (
              <li key={host.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpenFiles(host)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-hover disabled:opacity-50"
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-[10px] text-sm font-bold"
                    style={avatar}
                  >
                    {host.label.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui font-medium text-fg">
                      {host.label}
                    </span>
                    <span className="block truncate font-mono text-micro text-fg-muted">
                      {host.username}@{host.hostname}
                    </span>
                  </span>
                  <span className="text-micro text-fg-subtle">
                    {busy ? "Opening…" : "Browse"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Button className="mt-4" variant="subtle" onClick={onClose}>
        Back to hosts
      </Button>
    </SurfaceShell>
  );
}
