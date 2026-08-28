import { ChevronDown, Folder, FolderKanban, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  HostSummaryDto,
  ProjectSummaryDto,
  RunningSessionSummaryDto,
} from "../lib/ipc";
import { cn } from "../lib/cn";
import {
  hostTileAvatarStyle,
  tagGroupColors,
} from "../lib/tagColors";
import { ErrorBanner } from "./ui/Field";
import { Dialog } from "./ui/Dialog";

export type HostDraft = {
  label: string;
  hostname: string;
  port: number;
  username: string;
};

interface LauncherProps {
  /** Home filter: full overview, hosts-only, or projects-only (rail nav). */
  section?: "all" | "hosts" | "projects";
  /** Create a group = apply a tag to the selected hosts. */
  onCreateGroup?: (name: string, hostIds: string[]) => void;
  hosts: HostSummaryDto[];
  projects: ProjectSummaryDto[];
  runningSessions: RunningSessionSummaryDto[];
  sessionAttention?: Record<string, import("../lib/sessionAttention").SessionAttention>;
  openHostIds?: ReadonlySet<string>;
  error?: string;
  connectingHostId?: string;
  openingFilesHostId?: string;
  openingProjectId?: string;
  onConnect: (host: HostSummaryDto, opts?: { forceNew?: boolean }) => void;
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
  onQuickConnect: (target: string) => void;
  agentLabel?: (agentId: string | null | undefined) => string;
}

type SortMode = "recent" | "name";

export function Launcher({
  section = "all",
  onCreateGroup,
  hosts,
  projects,
  runningSessions,
  sessionAttention,
  openHostIds,
  error,
  connectingHostId,
  openingFilesHostId,
  openingProjectId,
  onConnect,
  onFiles,
  onEditHost,
  onDeleteHost,
  onOpenProject,
  onEditProject,
  onDeleteProject,
  onAddHost,
  onAddProject,
  onImport,
  onQuickConnect,
  agentLabel,
}: LauncherProps): React.JSX.Element {
  const [quick, setQuick] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const showProjects = section !== "hosts";
  const showHosts = section !== "projects";
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [sortMenuOpen]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const host of hosts) {
      for (const tag of host.tags) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [hosts]);

  const groups = useMemo(() => {
    return allTags.map((tag) => ({
      tag,
      count: hosts.filter((h) => h.tags.includes(tag)).length,
      colors: tagGroupColors(tag),
    }));
  }, [allTags, hosts]);

  const runningByHost = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of runningSessions) {
      map.set(session.hostId, (map.get(session.hostId) ?? 0) + 1);
    }
    return map;
  }, [runningSessions]);

  const filteredHosts = useMemo(() => {
    let list = [...hosts];
    if (activeTags.length > 0) {
      list = list.filter((host) =>
        activeTags.every((tag) => host.tags.includes(tag)),
      );
    }
    list.sort((a, b) => {
      if (sortMode === "name") return a.label.localeCompare(b.label);
      // Recent: open tabs → running agents → lastConnectedAt → name.
      const rank = (id: string): number => {
        if (openHostIds?.has(id)) return 0;
        if (runningByHost.has(id)) return 1;
        return 2;
      };
      const connectedAt = (host: HostSummaryDto): number => {
        if (!host.lastConnectedAt) return 0;
        const ms = Date.parse(host.lastConnectedAt);
        return Number.isFinite(ms) ? ms : 0;
      };
      return (
        rank(a.id) - rank(b.id) ||
        connectedAt(b) - connectedAt(a) ||
        a.label.localeCompare(b.label)
      );
    });
    return list;
  }, [hosts, activeTags, sortMode, openHostIds, runningByHost]);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aT = a.lastOpened ? Date.parse(a.lastOpened) : 0;
      const bT = b.lastOpened ? Date.parse(b.lastOpened) : 0;
      return bT - aT || a.name.localeCompare(b.name);
    });
  }, [projects]);

  const emptyVault = hosts.length === 0;

  function submitQuick(event: React.FormEvent): void {
    event.preventDefault();
    const target = quick.trim();
    if (!target) return;
    onQuickConnect(target);
    setQuick("");
  }

  function toggleTag(tag: string): void {
    setActiveTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag],
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {showHosts && (
      <div className="shrink-0 px-7 pt-[22px]">
        <form onSubmit={submitQuick} className="flex gap-2.5">
          <div
            className={cn(
              "flex h-[46px] min-w-0 flex-1 items-center gap-3 rounded-[11px] border border-line-strong bg-surface px-[18px]",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_8px_24px_rgba(0,0,0,0.35)]",
            )}
          >
            <span className="font-mono text-sm font-semibold text-accent">❯</span>
            <input
              value={quick}
              onChange={(event) => setQuick(event.target.value)}
              placeholder="ssh user@host — or start typing to find a host"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[13px] text-fg-subtle outline-none placeholder:text-fg-subtle"
            />
          </div>
          <button
            type="submit"
            disabled={!quick.trim()}
            className="h-[46px] shrink-0 cursor-pointer rounded-[11px] bg-accent px-6 text-[13.5px] font-semibold text-base transition-opacity hover:bg-accent-hover disabled:opacity-40"
          >
            Connect
          </button>
        </form>
      </div>
      )}

      {error && (
        <div className="shrink-0 px-7 pt-3">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      {!emptyVault && showHosts && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-7 pt-4">
          {activeTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className="flex h-6 cursor-pointer items-center gap-1.5 rounded-full border border-accent/35 bg-accent/12 px-[11px] text-[11.5px] text-[#8bb8ff]"
            >
              {tag}
              <X size={9} strokeWidth={3} />
            </button>
          ))}
          {allTags
            .filter((tag) => !activeTags.includes(tag))
            .map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className="h-6 cursor-pointer rounded-full border border-line px-[11px] text-[11.5px] text-fg-muted transition-colors hover:border-line-strong hover:bg-hover hover:text-fg"
              >
                {tag}
              </button>
            ))}
          <span className="flex-1" />
          <div ref={sortMenuRef} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={sortMenuOpen}
              onClick={() => setSortMenuOpen((open) => !open)}
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-fg-subtle transition-colors hover:bg-hover hover:text-fg-muted"
            >
              Arrange by: {sortMode === "recent" ? "Recent" : "Name"}
              <ChevronDown size={11} strokeWidth={2} />
            </button>
            {sortMenuOpen && (
              <div
                role="menu"
                className="absolute top-full right-0 z-20 mt-1 min-w-[7.5rem] rounded-md border border-line-strong bg-elevated p-1 shadow-lg shadow-black/40"
              >
                {(
                  [
                    { id: "recent", label: "Recent" },
                    { id: "name", label: "Name" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sortMode === option.id}
                    onClick={() => {
                      setSortMode(option.id);
                      setSortMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center rounded px-2.5 py-1.5 text-left text-[12px] transition-colors",
                      sortMode === option.id
                        ? "bg-hover text-fg"
                        : "text-fg-muted hover:bg-hover hover:text-fg",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-7 pt-5 pb-6">
        {emptyVault ? (
          <section className="rounded-panel border border-line-strong bg-elevated px-6 py-8">
            <h2 className="m-0 text-[15px] font-semibold text-fg">
              Import your SSH config
            </h2>
            <p className="mt-2 mb-5 max-w-lg text-ui text-fg-muted">
              Pull hosts from{" "}
              <code className="font-mono text-micro">~/.ssh/config</code> into
              the vault — the fastest way to get a usable fleet.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onImport}
                className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-ui font-medium text-base hover:bg-accent-hover"
              >
                Import ~/.ssh/config
              </button>
              <button
                type="button"
                onClick={onAddHost}
                className="cursor-pointer rounded-md border border-line bg-elevated px-3 py-1.5 text-ui text-fg hover:bg-hover"
              >
                Add host manually
              </button>
            </div>
          </section>
        ) : (
          <>
            {showProjects && (
            <section className="flex flex-col gap-2.5">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                Projects
              </span>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sortedProjects.map((project) => (
                  <ProjectTile
                    key={project.id}
                    project={project}
                    hosts={hosts}
                    opening={openingProjectId === project.id}
                    agentLabel={agentLabel?.(project.defaultAgent) ?? undefined}
                    onOpen={() => onOpenProject(project)}
                    onEdit={() => onEditProject(project)}
                    onDelete={() => onDeleteProject(project)}
                  />
                ))}
                <button
                  type="button"
                  onClick={onAddProject}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong px-4 py-[14px] text-[12px] text-fg-subtle transition-colors hover:border-fg-subtle hover:text-fg-muted"
                >
                  <Plus size={12} strokeWidth={2} />
                  New project
                </button>
              </div>
            </section>
            )}

            {showHosts && (
              <section className="flex flex-col gap-2.5">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                  Groups
                </span>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {groups.map(({ tag, count, colors }) => (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={activeTags.includes(tag)}
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "flex cursor-pointer items-center gap-[11px] rounded-panel border px-[15px] py-[13px] text-left transition-colors",
                        activeTags.includes(tag)
                          ? "border-accent/50 bg-accent/8"
                          : "border-line bg-surface hover:border-line-strong hover:bg-hover",
                      )}
                    >
                      <span
                        className="grid size-8 shrink-0 place-items-center rounded-[9px]"
                        style={{ backgroundColor: colors.bg }}
                      >
                        <Folder size={15} strokeWidth={2} style={{ color: colors.fg }} />
                      </span>
                      <span className="flex flex-col">
                        <span className="text-[12.5px] font-semibold text-fg">
                          {tag}
                        </span>
                        <span className="text-[11px] text-fg-subtle">
                          {count} host{count === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setGroupDialogOpen(true)}
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong px-[15px] py-[13px] text-[12px] text-fg-subtle transition-colors hover:border-fg-subtle hover:text-fg-muted"
                  >
                    <Plus size={12} strokeWidth={2} />
                    New group
                  </button>
                </div>
              </section>
            )}

            {showHosts && (
            <section className="flex flex-col gap-2.5">
              <span className="flex items-baseline gap-2 text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                Hosts
                {activeTags.length > 0 && (
                  <>
                    <span className="font-normal normal-case tracking-normal">
                      {filteredHosts.length} of {hosts.length} · {activeTags.join(" + ")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTags([])}
                      className="cursor-pointer font-normal normal-case tracking-normal text-accent hover:underline"
                    >
                      Show all
                    </button>
                  </>
                )}
              </span>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredHosts.map((host) => (
                  <HostTile
                    key={host.id}
                    host={host}
                    connecting={connectingHostId === host.id}
                    openingFiles={openingFilesHostId === host.id}
                    agentUp={(runningByHost.get(host.id) ?? 0) > 0}
                    onConnect={(forceNew) => onConnect(host, { forceNew })}
                    onFiles={() => onFiles(host)}
                    onEdit={() => onEditHost(host)}
                    onDelete={() => onDeleteHost(host)}
                  />
                ))}
                <button
                  type="button"
                  onClick={onAddHost}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong px-4 py-[14px] text-[12px] text-fg-subtle transition-colors hover:border-fg-subtle hover:text-fg-muted"
                >
                  <Plus size={12} strokeWidth={2} />
                  New host
                </button>
              </div>
            </section>
            )}
          </>
        )}
      </div>

      {onCreateGroup && (
        <NewGroupDialog
          open={groupDialogOpen}
          hosts={hosts}
          existingTags={allTags}
          onClose={() => setGroupDialogOpen(false)}
          onCreate={(name, hostIds) => {
            onCreateGroup(name, hostIds);
            setGroupDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function NewGroupDialog({
  open,
  hosts,
  existingTags,
  onClose,
  onCreate,
}: {
  open: boolean;
  hosts: HostSummaryDto[];
  existingTags: string[];
  onClose: () => void;
  onCreate: (name: string, hostIds: string[]) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setName("");
      setSelected(new Set());
    }
  }, [open]);

  const trimmed = name.trim();
  const duplicate = existingTags.includes(trimmed);
  const canCreate = trimmed.length > 0 && !duplicate && selected.size > 0;

  function toggleHost(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="New group"
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-micro text-fg-muted">
          Groups organize hosts by tag — a host can be in several groups, and
          the group cards filter the host grid.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-micro font-medium text-fg-muted">Group name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="prod"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-9 rounded-md border border-line-strong bg-surface px-3 font-mono text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
          />
          {duplicate && (
            <span className="text-micro text-warning">
              A group named “{trimmed}” already exists.
            </span>
          )}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-micro font-medium text-fg-muted">
            Hosts in this group
          </span>
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-line bg-surface p-1">
            {hosts.map((host) => (
              <label
                key={host.id}
                className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 transition-colors hover:bg-hover"
              >
                <input
                  type="checkbox"
                  checked={selected.has(host.id)}
                  onChange={() => toggleHost(host.id)}
                />
                <span className="text-[12.5px] text-fg">{host.label}</span>
                <span className="font-mono text-[11px] text-fg-subtle">
                  {host.username}@{host.hostname}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-line bg-elevated px-3 py-1.5 text-ui text-fg hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => onCreate(trimmed, [...selected])}
            className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-ui font-medium text-base hover:bg-accent-hover disabled:opacity-40"
          >
            Create group
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function HostTile({
  host,
  connecting,
  openingFiles,
  agentUp,
  onConnect,
  onFiles,
  onEdit,
  onDelete,
}: {
  host: HostSummaryDto;
  connecting: boolean;
  openingFiles: boolean;
  agentUp: boolean;
  onConnect: (forceNew?: boolean) => void;
  onFiles: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const avatar = hostTileAvatarStyle(host.color);
  const authChip =
    host.authKind === "sshKey"
      ? "key"
      : host.tags.some((t) => t.toLowerCase() === "rdp")
        ? "rdp"
        : null;

  return (
    <div
      className="group relative flex min-w-0 cursor-pointer items-center gap-3 rounded-panel border border-line bg-surface px-4 py-[14px] transition-colors hover:border-line-strong hover:bg-hover"
      onClick={(event) => {
        if (!connecting) onConnect(event.metaKey || event.ctrlKey);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!connecting) onConnect(event.metaKey || event.ctrlKey);
        }
      }}
      role="button"
      tabIndex={0}
      title="Open session · ⌘/Ctrl-click for a new session"
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-[10px] text-sm font-bold"
        style={avatar}
      >
        {host.label.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <span className="block truncate text-[12.5px] font-semibold text-fg">
          {host.label}
        </span>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
          <span className="truncate font-mono text-[11px] text-fg-subtle">
            {host.username}@{host.hostname}
            {host.port !== 22 ? `:${host.port}` : ""}
          </span>
          {agentUp ? (
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10.5px] text-fg-muted">
              <span className="size-1.5 rounded-full bg-success" />
              agent up
            </span>
          ) : authChip ? (
            <span className="shrink-0 whitespace-nowrap rounded-[5px] border border-line px-1.5 py-px text-[10px] text-fg-muted">
              {authChip}
            </span>
          ) : null}
        </div>
      </div>
      <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:flex">
          <button
            type="button"
            title="Files"
            disabled={openingFiles}
            onClick={(event) => {
              event.stopPropagation();
              onFiles();
            }}
            className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-fg"
          >
            Files
          </button>
          <button
            type="button"
            title="Edit"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-fg"
          >
            Edit
          </button>
          <button
            type="button"
            title="Delete"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-danger"
          >
            Delete
          </button>
        </div>
    </div>
  );
}

function projectSubtitle(
  project: ProjectSummaryDto,
  hosts: HostSummaryDto[],
): string {
  const location = project.location;
  if (location.kind === "local") return location.path;
  const host = hosts.find((entry) => entry.id === location.hostId);
  return `${host?.label ?? "host"} · ${location.path}`;
}

function ProjectTile({
  project,
  hosts,
  opening,
  agentLabel,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: ProjectSummaryDto;
  hosts: HostSummaryDto[];
  opening: boolean;
  agentLabel?: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div
      className="group relative flex min-w-0 cursor-pointer items-center gap-3 rounded-panel border border-line bg-surface px-4 py-[14px] transition-colors hover:border-line-strong hover:bg-hover"
      onClick={() => {
        if (!opening) onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!opening) onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-elevated text-fg-muted">
        <FolderKanban size={16} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <span className="block truncate text-[12.5px] font-semibold text-fg">
          {project.name}
        </span>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
          <span className="truncate font-mono text-[11px] text-fg-subtle">
            {opening ? "Opening…" : projectSubtitle(project, hosts)}
          </span>
          {agentLabel ? (
            <span className="shrink-0 whitespace-nowrap rounded-[5px] border border-line px-1.5 py-px text-[10px] text-fg-muted">
              {agentLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:flex">
        <button
          type="button"
          title="Edit"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-fg"
        >
          Edit
        </button>
        <button
          type="button"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-danger"
        >
          Delete
        </button>
      </div>
    </div>
  );
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
