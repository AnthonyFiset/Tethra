import {
  DownloadCloud,
  FolderOpen,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { HostSummaryDto } from "../lib/ipc";
import { cn } from "../lib/cn";
import { HostAvatar } from "./HostAvatar";
import { IconButton } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

interface SidebarProps {
  hosts: HostSummaryDto[];
  collapsed: boolean;
  drawerOpen: boolean;
  recoveryAvailable: boolean;
  connectingHostId?: string;
  openingFilesHostId?: string;
  onToggleCollapsed: () => void;
  onConnect: (host: HostSummaryDto) => void;
  onFiles: (host: HostSummaryDto) => void;
  onEdit: (host: HostSummaryDto) => void;
  onDelete: (host: HostSummaryDto) => void;
  onAddHost: () => void;
  onImport: () => void;
  onLock: () => void;
}

export function Sidebar({
  hosts,
  collapsed,
  drawerOpen,
  recoveryAvailable,
  connectingHostId,
  openingFilesHostId,
  onToggleCollapsed,
  onConnect,
  onFiles,
  onEdit,
  onDelete,
  onAddHost,
  onImport,
  onLock,
}: SidebarProps): React.JSX.Element {
  return (
    <aside
      className={cn(
        "z-30 flex min-h-0 flex-col border-r border-line bg-surface",
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:w-[min(84vw,280px)]",
        "max-md:shadow-2xl max-md:shadow-black/60 max-md:transition-transform",
        drawerOpen ? "max-md:translate-x-0" : "max-md:-translate-x-[102%]",
      )}
    >
      {collapsed ? (
        <RailHeader onToggleCollapsed={onToggleCollapsed} onAddHost={onAddHost} onImport={onImport} />
      ) : (
        <ExpandedHeader
          count={hosts.length}
          onToggleCollapsed={onToggleCollapsed}
          onAddHost={onAddHost}
          onImport={onImport}
        />
      )}

      <nav
        aria-label="Saved hosts"
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          collapsed ? "items-center gap-1 px-2 py-2" : "gap-0.5 px-2 py-1",
        )}
      >
        {hosts.length === 0 && !collapsed && (
          <p className="px-2 py-3 text-micro text-fg-subtle">
            No hosts yet. Add one or import your SSH config.
          </p>
        )}

        {hosts.map((host) =>
          collapsed ? (
            <Tooltip
              key={host.id}
              content={
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{host.label}</span>
                  <span className="text-fg-muted">
                    {host.username}@{host.hostname}:{host.port}
                  </span>
                </span>
              }
            >
              <button
                onClick={() => onConnect(host)}
                disabled={connectingHostId === host.id}
                className="cursor-pointer rounded-md p-1 transition-colors hover:bg-hover disabled:opacity-45"
              >
                <HostAvatar label={host.label} color={host.color} />
              </button>
            </Tooltip>
          ) : (
            <HostRow
              key={host.id}
              host={host}
              connecting={connectingHostId === host.id}
              openingFiles={openingFilesHostId === host.id}
              onConnect={onConnect}
              onFiles={onFiles}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ),
        )}
      </nav>

      <div
        className={cn(
          "border-t border-line",
          collapsed ? "flex justify-center p-2" : "p-3",
        )}
      >
        {collapsed ? (
          <Tooltip content="Lock vault">
            <IconButton label="Lock vault" onClick={onLock}>
              <Lock size={14} />
            </IconButton>
          </Tooltip>
        ) : (
          <p className="flex items-start gap-2 text-micro text-fg-subtle">
            {recoveryAvailable ? (
              <ShieldCheck size={13} className="mt-px shrink-0 text-success" />
            ) : (
              <ShieldAlert size={13} className="mt-px shrink-0 text-warning" />
            )}
            <span>
              Credentials stay in the encrypted vault.{" "}
              {recoveryAvailable
                ? "Keyring recovery is available."
                : "Recovery is not configured."}
            </span>
          </p>
        )}
      </div>
    </aside>
  );
}

function ExpandedHeader({
  count,
  onToggleCollapsed,
  onAddHost,
  onImport,
}: {
  count: number;
  onToggleCollapsed: () => void;
  onAddHost: () => void;
  onImport: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-10 items-center gap-2 border-b border-line px-3">
      <span className="text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
        Hosts
      </span>
      <span className="grid h-4 min-w-4 place-items-center rounded-full border border-line px-1 text-[10px] text-fg-muted">
        {count}
      </span>
      <div className="ml-auto flex items-center gap-0.5">
        <Tooltip content="Import SSH config" side="bottom">
          <IconButton label="Import SSH config" size="sm" onClick={onImport}>
            <DownloadCloud size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Add host" side="bottom">
          <IconButton label="Add host" size="sm" onClick={onAddHost}>
            <Plus size={15} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Collapse sidebar  ⌘B" side="bottom">
          <IconButton
            label="Collapse sidebar"
            size="sm"
            onClick={onToggleCollapsed}
          >
            <PanelLeftClose size={14} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

function RailHeader({
  onToggleCollapsed,
  onAddHost,
  onImport,
}: {
  onToggleCollapsed: () => void;
  onAddHost: () => void;
  onImport: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1 border-b border-line px-2 py-2">
      <Tooltip content="Expand sidebar  ⌘B">
        <IconButton label="Expand sidebar" onClick={onToggleCollapsed}>
          <PanelLeftOpen size={14} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Add host">
        <IconButton label="Add host" onClick={onAddHost}>
          <Plus size={15} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Import SSH config">
        <IconButton label="Import SSH config" onClick={onImport}>
          <DownloadCloud size={14} />
        </IconButton>
      </Tooltip>
    </div>
  );
}

function HostRow({
  host,
  connecting,
  openingFiles,
  onConnect,
  onFiles,
  onEdit,
  onDelete,
}: {
  host: HostSummaryDto;
  connecting: boolean;
  openingFiles: boolean;
  onConnect: (host: HostSummaryDto) => void;
  onFiles: (host: HostSummaryDto) => void;
  onEdit: (host: HostSummaryDto) => void;
  onDelete: (host: HostSummaryDto) => void;
}): React.JSX.Element {
  return (
    <div className="group relative flex items-center rounded-md transition-colors hover:bg-hover focus-within:bg-hover">
      <button
        onClick={() => onConnect(host)}
        disabled={connecting}
        title={`Connect to ${host.username}@${host.hostname}:${host.port}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left disabled:cursor-wait"
      >
        <HostAvatar label={host.label} color={host.color} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-medium text-fg">
            {host.label}
          </span>
          <span className="truncate text-micro text-fg-subtle">
            {connecting
              ? "Connecting…"
              : `${host.username}@${host.hostname}:${host.port}`}
          </span>
        </span>
      </button>

      <div className="absolute right-1.5 flex items-center gap-0.5 rounded-md bg-hover pl-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton
          label={`Browse files on ${host.label}`}
          size="sm"
          onClick={() => onFiles(host)}
          disabled={openingFiles}
        >
          <FolderOpen size={13} />
        </IconButton>
        <IconButton
          label={`Edit ${host.label}`}
          size="sm"
          onClick={() => onEdit(host)}
        >
          <Pencil size={13} />
        </IconButton>
        <IconButton
          label={`Delete ${host.label}`}
          size="sm"
          onClick={() => onDelete(host)}
          className="hover:text-danger"
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
    </div>
  );
}
