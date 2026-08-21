import {
  FolderKanban,
  FolderOpen,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Radio,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import type {
  HostSummaryDto,
  ProjectSummaryDto,
  RunningSessionSummaryDto,
} from "../lib/ipc";
import { cn } from "../lib/cn";
import { HostAvatar, DEFAULT_HOST_COLOR } from "./HostAvatar";
import { Logo } from "./Logo";
import { Button, IconButton } from "./ui/Button";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/ContextMenu";
import { ErrorBanner, inputClass } from "./ui/Field";

export type HostDraft = {
  label: string;
  hostname: string;
  port: number;
  username: string;
};

interface LauncherProps {
  hosts: HostSummaryDto[];
  projects: ProjectSummaryDto[];
  runningSessions: RunningSessionSummaryDto[];
  /** Host ids that currently have an open Workspace tab. */
  openHostIds?: ReadonlySet<string>;
  error?: string;
  connectingHostId?: string;
  openingFilesHostId?: string;
  openingProjectId?: string;
  onConnect: (host: HostSummaryDto) => void;
  onFiles: (host: HostSummaryDto) => void;
  onAgent: (host: HostSummaryDto) => void;
  onEditHost: (host: HostSummaryDto) => void;
  onDeleteHost: (host: HostSummaryDto) => void;
  onOpenProject: (project: ProjectSummaryDto) => void;
  onEditProject: (project: ProjectSummaryDto) => void;
  onDeleteProject: (project: ProjectSummaryDto) => void;
  onReattach: (session: RunningSessionSummaryDto) => void;
  onEndSession: (session: RunningSessionSummaryDto) => void;
  onAddHost: () => void;
  onAddProject: () => void;
  onImport: () => void;
  onLocal: () => void;
  /** Match vault host or open add-host with draft — never saves by itself. */
  onQuickConnect: (target: string) => void;
  /** Map agent id → display name. */
  agentLabel?: (agentId: string | null | undefined) => string;
}

export function Launcher({
  hosts,
  projects,
  runningSessions,
  openHostIds,
  error,
  connectingHostId,
  openingFilesHostId,
  openingProjectId,
  onConnect,
  onFiles,
  onAgent,
  onEditHost,
  onDeleteHost,
  onOpenProject,
  onEditProject,
  onDeleteProject,
  onReattach,
  onEndSession,
  onAddHost,
  onAddProject,
  onImport,
  onLocal,
  onQuickConnect,
  agentLabel = (id) => id ?? "agent",
}: LauncherProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const [hostView, setHostView] = useState<"grid" | "list">("grid");
  const [quick, setQuick] = useState("");
  const [hostFilter, setHostFilter] = useState("");

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const aT = a.lastOpened ? Date.parse(a.lastOpened) : 0;
        const bT = b.lastOpened ? Date.parse(b.lastOpened) : 0;
        return bT - aT || a.name.localeCompare(b.name);
      }),
    [projects],
  );

  const filteredHosts = useMemo(() => {
    const q = hostFilter.trim().toLowerCase();
    const list = [...hosts].sort((a, b) => {
      const aOpen = openHostIds?.has(a.id) ? 0 : 1;
      const bOpen = openHostIds?.has(b.id) ? 0 : 1;
      return aOpen - bOpen || a.label.localeCompare(b.label);
    });
    if (!q) return list;
    return list.filter(
      (host) =>
        host.label.toLowerCase().includes(q) ||
        host.hostname.toLowerCase().includes(q) ||
        host.username.toLowerCase().includes(q) ||
        host.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [hosts, hostFilter, openHostIds]);

  const projectsByHost = useMemo(() => {
    const map = new Map<string, ProjectSummaryDto[]>();
    for (const project of projects) {
      if (project.location.kind !== "remote") continue;
      const list = map.get(project.location.hostId) ?? [];
      list.push(project);
      map.set(project.location.hostId, list);
    }
    return map;
  }, [projects]);

  const emptyVault = hosts.length === 0 && projects.length === 0;

  function submitQuick(event: React.FormEvent): void {
    event.preventDefault();
    const target = quick.trim();
    if (!target) return;
    onQuickConnect(target);
    setQuick("");
  }

  const fade = reduceMotion
    ? undefined
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 md:px-10 md:py-14">
        <motion.header {...fade} className="flex flex-col gap-2">
          <Logo variant="lockup" size={28} />
          <div>
            <h1 className="m-0 text-[15px] font-semibold tracking-tight text-fg">
              {runningSessions.length > 0
                ? "Resume where you left off"
                : "Ready when you are"}
            </h1>
            <p className="mt-1 mb-0 max-w-xl text-ui text-fg-muted">
              {runningSessions.length > 0
                ? "Attach to a running agent, or open a host or project."
                : "Open a host or project to start working."}
            </p>
          </div>
          {error && <ErrorBanner>{error}</ErrorBanner>}
        </motion.header>

        {emptyVault ? (
          <motion.section
            {...fade}
            className="rounded-panel border border-line-strong bg-elevated px-6 py-8"
          >
            <h2 className="m-0 text-[15px] font-semibold text-fg">
              Import your SSH config
            </h2>
            <p className="mt-2 mb-5 max-w-lg text-ui text-fg-muted">
              Pull hosts from{" "}
              <code className="font-mono text-micro">~/.ssh/config</code> into
              the vault — the fastest way to get a usable fleet.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={onImport}>
                Import ~/.ssh/config
              </Button>
              <Button variant="subtle" onClick={onAddHost}>
                Add host manually
              </Button>
              <Button variant="ghost" onClick={onLocal}>
                Local terminal
              </Button>
            </div>
          </motion.section>
        ) : null}

        {!emptyVault && (
          <motion.section {...fade} className="flex flex-col gap-3">
            <SectionHeading
              icon={<Radio size={14} />}
              title="Running"
              count={runningSessions.length}
            />
            {runningSessions.length === 0 ? (
              <p className="m-0 text-ui text-fg-subtle">
                No agents running. Open a project to launch one.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <AnimatePresence initial={false}>
                  {runningSessions.map((session) => (
                    <motion.div
                      key={session.id}
                      layout={!reduceMotion}
                      className="flex items-stretch gap-0 overflow-hidden rounded-panel border border-line bg-elevated"
                    >
                      <button
                        type="button"
                        onClick={() => onReattach(session)}
                        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 px-3.5 py-3 text-left transition-colors hover:bg-hover"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-ui font-medium text-fg">
                            {session.projectName}
                          </span>
                          {/* Reserved for v0.4.0 waiting/done chip */}
                          <span className="ml-auto shrink-0" aria-hidden />
                        </div>
                        <span className="truncate text-micro text-fg-muted">
                          {agentLabel(session.agentId)} · {session.hostLabel}
                        </span>
                        <span className="font-mono text-micro text-fg-subtle">
                          up {formatAge(session.startedAt)} · attached{" "}
                          {formatAge(session.lastAttachedAt)} ago
                        </span>
                      </button>
                      <button
                        type="button"
                        title="Kill session on host"
                        onClick={() => onEndSession(session)}
                        className="shrink-0 cursor-pointer border-l border-line px-3 text-micro text-fg-subtle transition-colors hover:bg-hover hover:text-danger"
                      >
                        Kill
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.section>
        )}

        <motion.section {...fade} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeading
              icon={<FolderKanban size={14} />}
              title="Projects"
              count={projects.length}
            />
            <Button size="sm" variant="subtle" icon={<Plus size={13} />} onClick={onAddProject}>
              New project
            </Button>
          </div>
          {sortedProjects.length === 0 ? (
            <div className="rounded-panel border border-dashed border-line bg-base/40 px-4 py-5">
              <p className="m-0 text-ui text-fg-muted">
                No projects yet. Create one to pin a folder and default agent on a
                host.
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="primary"
                icon={<Plus size={13} />}
                onClick={onAddProject}
              >
                New project
              </Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sortedProjects.map((project) => {
                const loc = formatProjectLocation(project, hosts);
                const busy = openingProjectId === project.id;
                return (
                  <div
                    key={project.id}
                    className="group relative flex flex-col overflow-hidden rounded-panel border border-line bg-elevated transition-colors hover:border-line-strong"
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onOpenProject(project)}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 px-3.5 py-3 pr-16 text-left transition-colors hover:bg-hover disabled:opacity-50"
                    >
                      <span className="truncate text-ui font-medium text-fg">
                        {project.name}
                      </span>
                      <span className="truncate font-mono text-micro text-fg-muted">
                        {loc}
                      </span>
                      <span className="text-micro text-fg-subtle">
                        {busy
                          ? "Opening…"
                          : project.defaultAgent
                            ? `Agent · ${agentLabel(project.defaultAgent)}`
                            : "Default shell"}
                        {!busy && project.lastOpened
                          ? ` · opened ${formatAge(project.lastOpened)} ago`
                          : ""}
                      </span>
                    </button>
                    <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md bg-elevated/95 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconButton
                        label={`Edit ${project.name}`}
                        size="sm"
                        onClick={() => onEditProject(project)}
                      >
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${project.name}`}
                        size="sm"
                        onClick={() => onDeleteProject(project)}
                        className="hover:text-danger"
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.section>

        <motion.section {...fade} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeading
              icon={<TerminalSquare size={14} />}
              title="Hosts"
              count={hosts.length}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={hostFilter}
                onChange={(event) => setHostFilter(event.target.value)}
                placeholder="Filter hosts"
                className={cn(inputClass, "h-7 w-40 font-mono text-micro")}
              />
              <div className="flex rounded-md border border-line bg-elevated p-0.5">
                <button
                  type="button"
                  aria-label="Host grid"
                  onClick={() => setHostView("grid")}
                  className={cn(
                    "grid size-6 cursor-pointer place-items-center rounded",
                    hostView === "grid" ? "bg-active text-fg" : "text-fg-subtle",
                  )}
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Host list"
                  onClick={() => setHostView("list")}
                  className={cn(
                    "grid size-6 cursor-pointer place-items-center rounded",
                    hostView === "list" ? "bg-active text-fg" : "text-fg-subtle",
                  )}
                >
                  <List size={13} />
                </button>
              </div>
              <Button size="sm" variant="subtle" icon={<Plus size={13} />} onClick={onAddHost}>
                Add host
              </Button>
            </div>
          </div>

          {filteredHosts.length === 0 ? (
            <div className="rounded-panel border border-dashed border-line bg-base/40 px-4 py-5">
              <p className="m-0 text-ui text-fg-muted">
                {hosts.length === 0
                  ? "No hosts in the vault yet."
                  : "No hosts match that filter."}
              </p>
              {hosts.length === 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={onImport}>
                    Import ~/.ssh/config
                  </Button>
                  <Button size="sm" variant="subtle" onClick={onAddHost}>
                    Add host
                  </Button>
                </div>
              )}
            </div>
          ) : hostView === "grid" ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filteredHosts.map((host) => (
                <HostCard
                  key={host.id}
                  host={host}
                  open={openHostIds?.has(host.id) ?? false}
                  hasAgentProject={(projectsByHost.get(host.id)?.length ?? 0) > 0}
                  connecting={connectingHostId === host.id}
                  openingFiles={openingFilesHostId === host.id}
                  onConnect={() => onConnect(host)}
                  onFiles={() => onFiles(host)}
                  onAgent={() => onAgent(host)}
                  onEdit={() => onEditHost(host)}
                  onDelete={() => onDeleteHost(host)}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-panel border border-line">
              {filteredHosts.map((host, index) => (
                <div
                  key={host.id}
                  className={cn(
                    "group relative flex items-center gap-3 bg-elevated px-3 py-2",
                    index > 0 && "border-t border-line",
                  )}
                >
                  <HostAvatar label={host.label} color={host.color} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-ui font-medium text-fg">
                        {host.label}
                      </span>
                      {openHostIds?.has(host.id) && (
                        <span className="rounded border border-success/40 px-1 text-[10px] text-success">
                          open
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-micro text-fg-muted">
                      {host.username}@{host.hostname}:{host.port}
                    </div>
                    {host.tags.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {host.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded border border-line px-1 text-[10px] text-fg-subtle"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={connectingHostId === host.id}
                    onClick={() => onConnect(host)}
                  >
                    {connectingHostId === host.id ? "…" : "Terminal"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<FolderOpen size={13} />}
                    disabled={openingFilesHostId === host.id}
                    onClick={() => onFiles(host)}
                  >
                    Files
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={(projectsByHost.get(host.id)?.length ?? 0) === 0}
                    onClick={() => onAgent(host)}
                    title={
                      (projectsByHost.get(host.id)?.length ?? 0) === 0
                        ? "No project on this host yet"
                        : "Open latest project / agent"
                    }
                  >
                    Agent
                  </Button>
                  <div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <IconButton
                      label={`Edit ${host.label}`}
                      size="sm"
                      onClick={() => onEditHost(host)}
                    >
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton
                      label={`Delete ${host.label}`}
                      size="sm"
                      onClick={() => onDeleteHost(host)}
                      className="hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.section>

        <motion.section {...fade} className="flex flex-col gap-3 pb-6">
          <SectionHeading title="Quick connect" />
          <form
            onSubmit={submitQuick}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <input
              value={quick}
              onChange={(event) => setQuick(event.target.value)}
              placeholder="user@host[:port]"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={cn(inputClass, "font-mono sm:flex-1")}
            />
            <Button type="submit" variant="primary" disabled={!quick.trim()}>
              Connect
            </Button>
            <Button type="button" variant="ghost" onClick={onLocal}>
              Local
            </Button>
          </form>
          <p className="m-0 text-micro text-fg-subtle">
            Connects immediately if it matches a saved host, otherwise opens Add
            host prefilled.
          </p>
        </motion.section>
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  count,
}: {
  icon?: React.ReactNode;
  title: string;
  count?: number;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {icon && <span className="text-fg-subtle">{icon}</span>}
      <h2 className="m-0 text-[13px] font-semibold tracking-wide text-fg">
        {title}
      </h2>
      {typeof count === "number" && (
        <span className="text-micro text-fg-subtle">{count}</span>
      )}
    </div>
  );
}

function HostCard({
  host,
  open,
  hasAgentProject,
  connecting,
  openingFiles,
  onConnect,
  onFiles,
  onAgent,
  onEdit,
  onDelete,
}: {
  host: HostSummaryDto;
  open: boolean;
  hasAgentProject: boolean;
  connecting: boolean;
  openingFiles: boolean;
  onConnect: () => void;
  onFiles: () => void;
  onAgent: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <ContextMenu
      content={
        <>
          <ContextMenuItem onSelect={onConnect}>Terminal</ContextMenuItem>
          <ContextMenuItem onSelect={onFiles}>Files</ContextMenuItem>
          <ContextMenuItem disabled={!hasAgentProject} onSelect={onAgent}>
            Agent
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onEdit}>Edit</ContextMenuItem>
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
          <ContextMenuItem destructive onSelect={onDelete}>
            Delete
          </ContextMenuItem>
        </>
      }
    >
      <div
        className="group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-panel border border-line bg-elevated transition-colors hover:border-line-strong hover:bg-hover/40"
        style={{
          borderLeftWidth: 3,
          borderLeftColor: host.color ?? DEFAULT_HOST_COLOR,
        }}
        onClick={() => {
          if (!connecting) onConnect();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!connecting) onConnect();
          }
        }}
        role="button"
        tabIndex={0}
      >
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pr-14">
        <HostAvatar label={host.label} color={host.color} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-ui font-medium text-fg">
              {host.label}
            </span>
            {open && (
              <span className="shrink-0 rounded border border-success/40 px-1 text-[10px] text-success">
                open
              </span>
            )}
          </div>
          <div className="truncate font-mono text-micro text-fg-muted">
            {host.username}@{host.hostname}
            {host.port !== 22 ? `:${host.port}` : ""}
          </div>
        </div>
      </div>
      {host.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3.5">
          {host.tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-line px-1.5 py-px text-[10px] text-fg-subtle"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 px-3.5 pb-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          size="sm"
          variant="subtle"
          icon={<FolderOpen size={13} />}
          disabled={openingFiles}
          onClick={(event) => {
            event.stopPropagation();
            onFiles();
          }}
        >
          Files
        </Button>
        <Button
          size="sm"
          variant="subtle"
          disabled={!hasAgentProject}
          onClick={(event) => {
            event.stopPropagation();
            onAgent();
          }}
          title={
            hasAgentProject
              ? "Open latest project on this host"
              : "Add a project on this host to launch an agent"
          }
        >
          Agent
        </Button>
        {connecting && (
          <span className="ml-1 text-micro text-fg-subtle">Connecting…</span>
        )}
      </div>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md bg-elevated/95 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton
          label={`Edit ${host.label}`}
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <Pencil size={13} />
        </IconButton>
        <IconButton
          label={`Delete ${host.label}`}
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="hover:text-danger"
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
      </div>
    </ContextMenu>
  );
}

function formatProjectLocation(
  project: ProjectSummaryDto,
  hosts: HostSummaryDto[],
): string {
  const location = project.location;
  if (location.kind === "local") {
    return location.path;
  }
  const host = hosts.find((entry) => entry.id === location.hostId);
  return `${host?.label ?? "host"}:${location.path}`;
}

/** Relative age like `12m` / `3h` / `2d` from an ISO timestamp. */
export function formatAge(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

/** Parse `user@host` or `user@host:port` (IPv6 not supported in this MVP). */
export function parseQuickConnect(input: string): HostDraft | undefined {
  const trimmed = input.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return undefined;
  const username = trimmed.slice(0, at).trim();
  let hostPart = trimmed.slice(at + 1).trim();
  if (!username || !hostPart) return undefined;

  let port = 22;
  // host:port — avoid splitting IPv6; require last colon with digits only.
  const colon = hostPart.lastIndexOf(":");
  if (colon > 0) {
    const maybePort = hostPart.slice(colon + 1);
    if (/^\d+$/.test(maybePort)) {
      const parsed = Number.parseInt(maybePort, 10);
      if (parsed < 1 || parsed > 65535) return undefined;
      port = parsed;
      hostPart = hostPart.slice(0, colon);
    }
  }
  if (!hostPart) return undefined;

  return {
    label: hostPart,
    hostname: hostPart,
    port,
    username,
  };
}
