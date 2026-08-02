import {
  DownloadCloud,
  Folder,
  FolderKanban,
  FolderOpen,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Radio,
  ShieldCheck,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import type {
  HostSummaryDto,
  ProjectSummaryDto,
  RunningSessionSummaryDto,
} from "../lib/ipc";
import { cn } from "../lib/cn";
import { HostAvatar, DEFAULT_HOST_COLOR } from "./HostAvatar";
import type { TabDescriptor } from "./TabBar";
import { IconButton } from "./ui/Button";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/ContextMenu";
import { Tooltip } from "./ui/Tooltip";

interface SidebarProps {
  hosts: HostSummaryDto[];
  projects: ProjectSummaryDto[];
  runningSessions: RunningSessionSummaryDto[];
  /** Open tabs in this window (Workspace session tree). */
  openTabs: TabDescriptor[];
  activeTabId?: string;
  collapsed: boolean;
  drawerOpen: boolean;
  recoveryAvailable: boolean;
  connectingHostId?: string;
  openingFilesHostId?: string;
  openingProjectId?: string;
  onToggleCollapsed: () => void;
  onConnect: (host: HostSummaryDto) => void;
  onFiles: (host: HostSummaryDto) => void;
  onEdit: (host: HostSummaryDto) => void;
  onDelete: (host: HostSummaryDto) => void;
  onAddHost: () => void;
  onImport: () => void;
  onOpenProject: (project: ProjectSummaryDto) => void;
  onEditProject: (project: ProjectSummaryDto) => void;
  onDeleteProject: (project: ProjectSummaryDto) => void;
  onAddProject: () => void;
  onReattach: (session: RunningSessionSummaryDto) => void;
  onEndSession: (session: RunningSessionSummaryDto) => void;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onLock: () => void;
  /** Map agent id → display name. */
  agentLabel?: (agentId: string | null | undefined) => string;
}

export function Sidebar({
  hosts,
  projects,
  runningSessions,
  openTabs,
  activeTabId,
  collapsed,
  drawerOpen,
  recoveryAvailable,
  connectingHostId,
  openingFilesHostId,
  openingProjectId,
  onToggleCollapsed,
  onConnect,
  onFiles,
  onEdit,
  onDelete,
  onAddHost,
  onImport,
  onOpenProject,
  onEditProject,
  onDeleteProject,
  onAddProject,
  onReattach,
  onEndSession,
  onSelectTab,
  onCloseTab,
  onLock,
  agentLabel = (id) => id ?? "agent",
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
        <RailHeader
          onToggleCollapsed={onToggleCollapsed}
          onAddHost={onAddHost}
          onAddProject={onAddProject}
          onImport={onImport}
        />
      ) : (
        <ExpandedHeader
          hostCount={hosts.length}
          projectCount={projects.length}
          runningCount={runningSessions.length}
          openCount={openTabs.length}
          onToggleCollapsed={onToggleCollapsed}
          onAddHost={onAddHost}
          onAddProject={onAddProject}
          onImport={onImport}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {openTabs.length > 0 && (
          <nav
            aria-label="Open sessions"
            className={cn(
              "flex flex-col border-b border-line",
              collapsed ? "items-center gap-1 px-2 py-2" : "gap-0.5 px-2 py-1",
            )}
          >
            {!collapsed && (
              <span className="px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-fg-subtle uppercase">
                Open
              </span>
            )}
            {openTabs.map((tab) =>
              collapsed ? (
                <Tooltip key={tab.sessionId} content={tab.title}>
                  <button
                    onClick={() => onSelectTab(tab.sessionId)}
                    className={cn(
                      "relative cursor-pointer rounded-md p-1 transition-colors hover:bg-hover",
                      tab.sessionId === activeTabId && "bg-active",
                    )}
                  >
                    {tab.sessionId === activeTabId && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full"
                        style={{
                          backgroundColor: tab.color ?? DEFAULT_HOST_COLOR,
                        }}
                      />
                    )}
                    <span
                      className="grid h-7 w-7 place-items-center rounded-md bg-elevated"
                      style={{ color: tab.color ?? undefined }}
                    >
                      {tab.kind === "sftp" ? (
                        <Folder size={14} />
                      ) : (
                        <TerminalSquare size={14} />
                      )}
                    </span>
                  </button>
                </Tooltip>
              ) : (
                <OpenTabRow
                  key={tab.sessionId}
                  tab={tab}
                  active={tab.sessionId === activeTabId}
                  onSelect={onSelectTab}
                  onClose={onCloseTab}
                />
              ),
            )}
          </nav>
        )}

        {runningSessions.length > 0 && (
          <nav
            aria-label="Running sessions"
            className={cn(
              "flex flex-col border-b border-line",
              collapsed ? "items-center gap-1 px-2 py-2" : "gap-0.5 px-2 py-1",
            )}
          >
            {!collapsed && (
              <span
                className="px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-fg-subtle uppercase"
                title="Click to reattach · × kills the session on the host"
              >
                Running
              </span>
            )}
            {runningSessions.map((session) =>
              collapsed ? (
                <Tooltip
                  key={session.id}
                  content={`${session.projectName} on ${session.hostLabel}`}
                >
                  <button
                    onClick={() => onReattach(session)}
                    disabled={openingProjectId === session.projectId}
                    className="cursor-pointer rounded-md p-1 transition-colors hover:bg-hover disabled:opacity-45"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-elevated text-success">
                      <Radio size={14} />
                    </span>
                  </button>
                </Tooltip>
              ) : (
                <RunningRow
                  key={session.id}
                  session={session}
                  opening={openingProjectId === session.projectId}
                  onReattach={onReattach}
                  onEnd={onEndSession}
                  agentLabel={agentLabel}
                />
              ),
            )}
          </nav>
        )}

        <nav
          aria-label="Projects"
          className={cn(
            "flex flex-col border-b border-line",
            collapsed ? "items-center gap-1 px-2 py-2" : "gap-0.5 px-2 py-1",
          )}
        >
          {!collapsed && (
            <span className="px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-fg-subtle uppercase">
              Projects
            </span>
          )}
          {projects.length === 0 && !collapsed && (
            <p className="px-2 py-2 text-micro text-fg-subtle">
              No projects yet. Add one to open → cd → launch.
            </p>
          )}
          {projects.map((project) =>
            collapsed ? (
              <Tooltip key={project.id} content={project.name}>
                <button
                  onClick={() => onOpenProject(project)}
                  disabled={openingProjectId === project.id}
                  className="cursor-pointer rounded-md p-1 transition-colors hover:bg-hover disabled:opacity-45"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-elevated text-fg-muted">
                    <FolderKanban size={14} />
                  </span>
                </button>
              </Tooltip>
            ) : (
              <ProjectRow
                key={project.id}
                project={project}
                hosts={hosts}
                opening={openingProjectId === project.id}
                onOpen={onOpenProject}
                onEdit={onEditProject}
                onDelete={onDeleteProject}
              />
            ),
          )}
        </nav>

        <nav
          aria-label="Saved hosts"
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            collapsed ? "items-center gap-1 px-2 py-2" : "gap-0.5 px-2 py-1",
          )}
        >
          {!collapsed && (
            <span className="px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-fg-subtle uppercase">
              Hosts
            </span>
          )}
          {hosts.length === 0 && !collapsed && (
            <p className="px-2 py-2 text-micro text-fg-subtle">
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
                  className="relative cursor-pointer rounded-md p-1 transition-colors hover:bg-hover disabled:opacity-45"
                >
                  <span
                    aria-hidden="true"
                    className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full"
                    style={{
                      backgroundColor: host.color ?? DEFAULT_HOST_COLOR,
                    }}
                  />
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
      </div>

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
  hostCount,
  projectCount,
  runningCount,
  openCount,
  onToggleCollapsed,
  onAddHost,
  onAddProject,
  onImport,
}: {
  hostCount: number;
  projectCount: number;
  runningCount: number;
  openCount: number;
  onToggleCollapsed: () => void;
  onAddHost: () => void;
  onAddProject: () => void;
  onImport: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-10 items-center gap-2 border-b border-line px-3">
      <span className="text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
        Vault
      </span>
      <span className="grid h-4 min-w-4 place-items-center rounded-full border border-line px-1 text-[10px] text-fg-muted">
        {openCount + projectCount + hostCount + runningCount}
      </span>
      <div className="ml-auto flex items-center gap-0.5">
        <Tooltip content="Import SSH config" side="bottom">
          <IconButton label="Import SSH config" size="sm" onClick={onImport}>
            <DownloadCloud size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Add project" side="bottom">
          <IconButton label="Add project" size="sm" onClick={onAddProject}>
            <FolderKanban size={14} />
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
  onAddProject,
  onImport,
}: {
  onToggleCollapsed: () => void;
  onAddHost: () => void;
  onAddProject: () => void;
  onImport: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1 border-b border-line px-2 py-2">
      <Tooltip content="Expand sidebar  ⌘B">
        <IconButton label="Expand sidebar" onClick={onToggleCollapsed}>
          <PanelLeftOpen size={14} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Add project">
        <IconButton label="Add project" onClick={onAddProject}>
          <FolderKanban size={14} />
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

function OpenTabRow({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: TabDescriptor;
  active: boolean;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "group relative flex items-center rounded-md transition-colors hover:bg-hover focus-within:bg-hover",
        active && "bg-active/60",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(tab.sessionId)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-elevated"
          style={{ color: tab.color ?? undefined }}
        >
          {tab.kind === "sftp" ? (
            <Folder size={14} />
          ) : (
            <TerminalSquare size={14} />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-medium text-fg">{tab.title}</span>
          <span className="truncate text-micro text-fg-subtle">
            {tab.kind === "sftp"
              ? "Files"
              : tab.kind === "local"
                ? "Local"
                : "Terminal"}
            {!tab.connected ? " · disconnected" : ""}
          </span>
        </span>
      </button>
      <div className="absolute right-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton
          label={`Close ${tab.title}`}
          size="sm"
          onClick={() => onClose(tab.sessionId)}
        >
          <X size={13} />
        </IconButton>
      </div>
    </div>
  );
}

function RunningRow({
  session,
  opening,
  onReattach,
  onEnd,
  agentLabel,
}: {
  session: RunningSessionSummaryDto;
  opening: boolean;
  onReattach: (session: RunningSessionSummaryDto) => void;
  onEnd: (session: RunningSessionSummaryDto) => void;
  agentLabel: (agentId: string | null | undefined) => string;
}): React.JSX.Element {
  const agent = agentLabel(session.agentId);
  return (
    <div className="group relative flex items-center rounded-md transition-colors hover:bg-hover focus-within:bg-hover">
      <button
        onClick={() => onReattach(session)}
        disabled={opening}
        title={`Reattach to ${session.projectName}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left disabled:cursor-wait"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-elevated text-success">
          <Radio size={14} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-medium text-fg">
            {session.projectName}
          </span>
          <span className="truncate text-micro text-fg-subtle">
            {opening
              ? "Reattaching…"
              : `${agent} · ${session.hostLabel} · from ${session.startedOnDevice}`}
          </span>
        </span>
      </button>

      <div className="relative z-10 mr-1 flex shrink-0 items-center">
        <Tooltip content="Kill session — stops tmux on the host and removes it from Running">
          <button
            type="button"
            aria-label={`Kill ${session.projectName} session`}
            title="Kill session"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEnd(session);
            }}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-line px-2 text-micro text-fg-muted transition-colors hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
          >
            <X size={12} />
            Kill
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function projectSubtitle(
  project: ProjectSummaryDto,
  hosts: HostSummaryDto[],
): string {
  const location = project.location;
  if (location.kind === "local") {
    return location.path;
  }
  const host = hosts.find((entry) => entry.id === location.hostId);
  const hostLabel = host?.label ?? "host";
  return `${hostLabel}:${location.path}`;
}

function ProjectRow({
  project,
  hosts,
  opening,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: ProjectSummaryDto;
  hosts: HostSummaryDto[];
  opening: boolean;
  onOpen: (project: ProjectSummaryDto) => void;
  onEdit: (project: ProjectSummaryDto) => void;
  onDelete: (project: ProjectSummaryDto) => void;
}): React.JSX.Element {
  return (
    <div className="group relative flex items-center rounded-md transition-colors hover:bg-hover focus-within:bg-hover">
      <button
        onClick={() => onOpen(project)}
        disabled={opening}
        title={`Open ${project.name}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left disabled:cursor-wait"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-elevated text-fg-muted">
          <FolderKanban size={14} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-medium text-fg">
            {project.name}
          </span>
          <span className="truncate text-micro text-fg-subtle">
            {opening ? "Opening…" : projectSubtitle(project, hosts)}
          </span>
        </span>
      </button>

      <div className="absolute right-1.5 flex items-center gap-0.5 rounded-md bg-hover pl-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton
          label={`Edit ${project.name}`}
          size="sm"
          onClick={() => onEdit(project)}
        >
          <Pencil size={13} />
        </IconButton>
        <IconButton
          label={`Delete ${project.name}`}
          size="sm"
          onClick={() => onDelete(project)}
          className="hover:text-danger"
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
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
    <ContextMenu
      content={
        <>
          <ContextMenuItem onSelect={() => onConnect(host)}>
            Terminal
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onFiles(host)}>Files</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onEdit(host)}>Edit</ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(
                `ssh ${host.username}@${host.hostname} -p ${host.port}`,
              );
            }}
          >
            Copy SSH command
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => onDelete(host)}>
            Delete
          </ContextMenuItem>
        </>
      }
    >
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
            <span className="truncate text-micro font-mono text-fg-subtle">
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
    </ContextMenu>
  );
}
