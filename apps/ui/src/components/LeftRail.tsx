import {
  ChevronDown,
  Folder,
  FolderGit2,
  KeyRound,
  Lightbulb,
  Lock,
  Plus,
  Settings,
  TerminalSquare,
  Upload,
  X,
} from "lucide-react";
import type {
  HostSummaryDto,
  SyncStatusDto,
  VaultStatusDto,
} from "../lib/ipc";
import type { AgentAttentionState } from "../lib/generated/AgentAttentionState";
import { cn } from "../lib/cn";
import { attentionDotClass } from "../lib/sessionAttention";
import { Logo } from "./Logo";
import { Tooltip } from "./ui/Tooltip";

export type RailNavId =
  | "projects"
  | "hosts"
  | "tunnels"
  | "identities"
  | "files"
  | "assist";

/** Unified RUNNING row: open live tabs and/or detached vault sessions. */
export type RailRunningItem = {
  key: string;
  label: string;
  hostId: string;
  /** Open PTY tab session id when this row is a live tab. */
  openSessionId?: string;
  /** Vault running-session id when this row is agent-registered. */
  runningId?: string;
  attentionState?: AgentAttentionState;
};

const NAV: {
  id: RailNavId;
  label: string;
  icon: React.ReactNode;
  iconActiveClass?: string;
}[] = [
  {
    id: "projects",
    label: "Projects",
    icon: <FolderGit2 size={15} strokeWidth={2} />,
    iconActiveClass: "text-[#8bb8ff]",
  },
  {
    id: "hosts",
    label: "Hosts",
    icon: <TerminalSquare size={15} strokeWidth={2} />,
    iconActiveClass: "text-[#8bb8ff]",
  },
  {
    id: "tunnels",
    label: "Tunnels",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 3v9a4 4 0 0 0 8 0V3M4 21h16" />
      </svg>
    ),
  },
  {
    id: "identities",
    label: "Identities",
    icon: <KeyRound size={15} strokeWidth={2} />,
  },
  {
    id: "files",
    label: "Files",
    icon: <Upload size={15} strokeWidth={2} />,
  },
  {
    id: "assist",
    label: "Assist",
    icon: <Lightbulb size={15} strokeWidth={2} />,
  },
];

interface LeftRailProps {
  /**
   * "nav" — full navigation rail (home views).
   * "sessions" — session-view sidebar: ONLY the open/running session list
   * plus new-session and Settings (Warp-style; toggled from the titlebar).
   */
  variant?: "nav" | "sessions";
  collapsed: boolean;
  vaultStatus: VaultStatusDto;
  syncStatus?: SyncStatusDto | null;
  hostCount: number;
  projectCount?: number;
  activeTunnelCount: number;
  runningItems: RailRunningItem[];
  hosts: HostSummaryDto[];
  activeNav: RailNavId | null;
  /** Session id of the currently focused tab (sessions variant highlight). */
  activeSessionId?: string | null;
  onNav: (nav: RailNavId) => void;
  onGoHome: () => void;
  onOpenVault: () => void;
  onSettings: () => void;
  onOpenRunning: (item: RailRunningItem) => void;
  onCloseSession?: (openSessionId: string) => void;
  onNewSession?: () => void;
}

function vaultStateLine(
  vault: VaultStatusDto,
  sync: SyncStatusDto | null | undefined,
): { text: string; dotClass: string } {
  if (!vault.unlocked) {
    return { text: "locked", dotClass: "bg-danger" };
  }
  if (sync?.lastError) {
    return { text: "sync error", dotClass: "bg-danger" };
  }
  if (sync?.configured) {
    return { text: "unlocked · synced", dotClass: "bg-success" };
  }
  return { text: "unlocked", dotClass: "bg-success" };
}

export function LeftRail({
  variant = "nav",
  collapsed,
  vaultStatus,
  syncStatus,
  hostCount,
  projectCount,
  activeTunnelCount,
  runningItems,
  hosts,
  activeNav,
  activeSessionId,
  onNav,
  onGoHome,
  onOpenVault,
  onSettings,
  onOpenRunning,
  onCloseSession,
  onNewSession,
}: LeftRailProps): React.JSX.Element {
  const vaultLine = vaultStateLine(vaultStatus, syncStatus);

  if (variant === "sessions") {
    return (
      <aside className="flex w-rail shrink-0 flex-col border-r border-elevated bg-rail px-2.5 py-3">
        <div className="flex shrink-0 items-center px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
          Sessions
          <span className="flex-1" />
          <span>{runningItems.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {runningItems.map((item) => {
            const host = hosts.find((h) => h.id === item.hostId);
            const tint = host?.color ?? "#3d8ef0";
            const state = item.attentionState ?? "running";
            const isActive =
              item.openSessionId != null &&
              item.openSessionId === activeSessionId;
            return (
              <div
                key={item.key}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors",
                  isActive
                    ? "bg-hover text-fg"
                    : "text-fg-muted hover:bg-hover hover:text-fg",
                )}
              >
                <button
                  type="button"
                  aria-label={item.label}
                  onClick={() => onOpenRunning(item)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[12px]"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-md bg-elevated">
                    <TerminalSquare
                      size={11}
                      strokeWidth={2.4}
                      style={{ color: tint }}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
                <span
                  className={cn(
                    "size-[7px] shrink-0 rounded-full group-hover:hidden",
                    attentionDotClass(state),
                  )}
                />
                {item.openSessionId && onCloseSession ? (
                  <button
                    type="button"
                    aria-label={`Close ${item.label}`}
                    onClick={() => onCloseSession(item.openSessionId!)}
                    className="hidden size-4 shrink-0 cursor-pointer place-items-center rounded text-fg-subtle group-hover:grid hover:text-fg"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                ) : (
                  <span className="hidden size-4 shrink-0 group-hover:block" />
                )}
              </div>
            );
          })}
          {onNewSession && (
            <button
              type="button"
              onClick={onNewSession}
              className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-md border border-dashed border-line-strong">
                <Plus size={11} strokeWidth={2.4} />
              </span>
              New session
            </button>
          )}
        </div>
        <div className="mt-auto">
          <button
            type="button"
            aria-label="Settings"
            onClick={onSettings}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          >
            <Settings size={15} strokeWidth={2} />
            <span>Settings</span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-elevated bg-rail py-3 transition-[width] duration-150",
        collapsed ? "w-rail-collapsed px-1.5" : "w-rail px-2.5",
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-1">
          <Tooltip content="Home" side="right">
            <button
              type="button"
              aria-label="Home"
              onClick={onGoHome}
              className="grid size-9 cursor-pointer place-items-center rounded-[9px] border border-line bg-surface text-fg transition-colors hover:border-line-strong hover:bg-hover"
            >
              <Logo size={18} />
            </button>
          </Tooltip>
          <Tooltip content="Vault" side="right">
            <button
              type="button"
              aria-label="Vault"
              onClick={onOpenVault}
              className="grid size-9 cursor-pointer place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <Lock size={15} strokeWidth={2} />
            </button>
          </Tooltip>
        </div>
      ) : (
        <Tooltip content="Vault" side="right">
          <button
            type="button"
            aria-label="Vault"
            onClick={onOpenVault}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-hover"
          >
            <Logo size={18} className="shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[12px] font-semibold text-fg">
                Personal vault
              </span>
              <span className="flex items-center gap-1.5 text-[10.5px] text-fg-subtle">
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", vaultLine.dotClass)}
                />
                {vaultLine.text}
              </span>
            </span>
            <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
          </button>
        </Tooltip>
      )}

      <nav
        aria-label="Primary"
        className={cn("mt-3 flex flex-col gap-px", collapsed && "items-center")}
      >
        {NAV.map((item) => {
          const active = activeNav === item.id;
          const badge =
            item.id === "hosts"
              ? hostCount
              : item.id === "projects" && (projectCount ?? 0) > 0
                ? projectCount
                : item.id === "tunnels" && activeTunnelCount > 0
                  ? activeTunnelCount
                  : null;

          const button = (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              onClick={() => onNav(item.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors",
                collapsed && "w-9 justify-center px-0",
                active
                  ? "bg-hover font-medium text-fg"
                  : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              <span
                className={cn(
                  "shrink-0",
                  active && item.iconActiveClass
                    ? item.iconActiveClass
                    : active
                      ? "text-fg"
                      : "text-fg-subtle",
                )}
              >
                {item.icon}
              </span>
              {!collapsed && (
                <>
                  <span>{item.label}</span>
                  <span className="flex-1" />
                  {badge != null &&
                    (item.id === "tunnels" ? (
                      <span className="text-[10.5px] text-fg-muted">{badge}</span>
                    ) : (
                      <span className="text-[10.5px] text-fg-subtle">{badge}</span>
                    ))}
                </>
              )}
            </button>
          );

          return collapsed ? (
            <Tooltip key={item.id} content={item.label} side="right">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-[18px] flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <div className="flex shrink-0 items-center px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
            Running
            <span className="flex-1" />
            <span>{runningItems.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {runningItems.map((item) => {
              const host = hosts.find((h) => h.id === item.hostId);
              const tint = host?.color ?? "#3d8ef0";
              const state = item.attentionState ?? "running";
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label={item.label}
                  onClick={() => onOpenRunning(item)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-md bg-elevated">
                    <TerminalSquare
                      size={11}
                      strokeWidth={2.4}
                      style={{ color: tint }}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span
                    className={cn("size-[7px] shrink-0 rounded-full", attentionDotClass(state))}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {collapsed && runningItems.length > 0 && (
        <Tooltip content={`${runningItems.length} running`} side="right">
          <div
            className="mt-3 grid size-9 place-items-center rounded-lg text-fg-subtle"
            aria-label={`${runningItems.length} running`}
          >
            <RadioDot count={runningItems.length} />
          </div>
        </Tooltip>
      )}

      <div className={cn("mt-auto", collapsed && "flex justify-center")}>
        <Tooltip content="Settings" side="right">
          <button
            type="button"
            aria-label="Settings"
            onClick={onSettings}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-fg-subtle transition-colors hover:bg-hover hover:text-fg",
              collapsed && "w-9 justify-center px-0",
            )}
          >
            <Settings size={15} strokeWidth={2} />
            {!collapsed && <span>Settings</span>}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

function RadioDot({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="relative grid size-4 place-items-center">
      <Folder size={14} className="opacity-70" />
      <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-base">
        {count}
      </span>
    </span>
  );
}
