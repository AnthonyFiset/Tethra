import { Folder, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
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
  sessionAttention?: Record<string, import("../lib/sessionAttention").SessionAttention>;
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
  onQuickConnect: (target: string) => void;
  agentLabel?: (agentId: string | null | undefined) => string;
}

type SortMode = "recent" | "name";

export function Launcher({
  hosts,
  projects,
  runningSessions,
  sessionAttention,
  openHostIds,
  error,
  connectingHostId,
  openingFilesHostId,
  onConnect,
  onFiles,
  onEditHost,
  onDeleteHost,
  onAddHost,
  onImport,
  onQuickConnect,
}: LauncherProps): React.JSX.Element {
  const [quick, setQuick] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("recent");

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

  const filteredHosts = useMemo(() => {
    let list = [...hosts];
    if (activeTags.length > 0) {
      list = list.filter((host) =>
        activeTags.every((tag) => host.tags.includes(tag)),
      );
    }
    list.sort((a, b) => {
      if (sortMode === "name") return a.label.localeCompare(b.label);
      const aOpen = openHostIds?.has(a.id) ? 0 : 1;
      const bOpen = openHostIds?.has(b.id) ? 0 : 1;
      return aOpen - bOpen || a.label.localeCompare(b.label);
    });
    return list;
  }, [hosts, activeTags, sortMode, openHostIds]);

  const runningByHost = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of runningSessions) {
      map.set(session.hostId, (map.get(session.hostId) ?? 0) + 1);
    }
    return map;
  }, [runningSessions]);

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

      {error && (
        <div className="shrink-0 px-7 pt-3">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      {!emptyVault && (
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
                className="h-6 cursor-pointer rounded-full border border-line px-[11px] text-[11.5px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                {tag}
              </button>
            ))}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() =>
              setSortMode((m) => (m === "recent" ? "name" : "recent"))
            }
            className="flex cursor-pointer items-center gap-1 text-[11.5px] text-fg-subtle hover:text-fg-muted"
          >
            Arrange by: {sortMode === "recent" ? "Recent" : "Name"}
          </button>
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
            {groups.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                  Groups
                </span>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {groups.map(({ tag, count, colors }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className="flex cursor-pointer items-center gap-[11px] rounded-panel border border-line bg-surface px-[15px] py-[13px] text-left transition-colors hover:border-line-strong"
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
                    onClick={onAddHost}
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong px-[15px] py-[13px] text-[12px] text-fg-subtle transition-colors hover:border-fg-subtle hover:text-fg-muted"
                  >
                    <Plus size={12} strokeWidth={2} />
                    New group
                  </button>
                </div>
              </section>
            )}

            <section className="flex flex-col gap-2.5">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                Hosts
              </span>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredHosts.map((host) => (
                  <HostTile
                    key={host.id}
                    host={host}
                    connecting={connectingHostId === host.id}
                    openingFiles={openingFilesHostId === host.id}
                    agentUp={(runningByHost.get(host.id) ?? 0) > 0}
                    onConnect={() => onConnect(host)}
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
          </>
        )}
      </div>
    </div>
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
  onConnect: () => void;
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
      className="group relative flex min-w-0 cursor-pointer items-center gap-3 rounded-panel border border-line bg-surface px-4 py-[14px] transition-colors hover:border-line-strong"
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
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10.5px] text-success">
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
