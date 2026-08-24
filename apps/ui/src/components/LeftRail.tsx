import {
  ChevronDown,
  Folder,
  KeyRound,
  Lightbulb,
  Settings,
  TerminalSquare,
  Upload,
} from "lucide-react";
import type {
  HostSummaryDto,
  RunningSessionSummaryDto,
  SyncStatusDto,
  VaultStatusDto,
} from "../lib/ipc";
import { cn } from "../lib/cn";
import {
  attentionDotClass,
  type SessionAttention,
} from "../lib/sessionAttention";
import { hostTileAvatarStyle } from "../lib/tagColors";
import { Logo } from "./Logo";
import { Tooltip } from "./ui/Tooltip";

export type RailNavId = "hosts" | "tunnels" | "identities" | "files" | "assist";

const NAV: {
  id: RailNavId;
  label: string;
  icon: React.ReactNode;
  iconActiveClass?: string;
}[] = [
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
  collapsed: boolean;
  vaultStatus: VaultStatusDto;
  syncStatus?: SyncStatusDto | null;
  hostCount: number;
  activeTunnelCount: number;
  runningSessions: RunningSessionSummaryDto[];
  sessionAttention?: Record<string, SessionAttention>;
  hosts: HostSummaryDto[];
  activeNav: RailNavId;
  onNav: (nav: RailNavId) => void;
  onOpenVault: () => void;
  onSettings: () => void;
  onReattach: (session: RunningSessionSummaryDto) => void;
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
  collapsed,
  vaultStatus,
  syncStatus,
  hostCount,
  activeTunnelCount,
  runningSessions,
  sessionAttention,
  hosts,
  activeNav,
  onNav,
  onOpenVault,
  onSettings,
  onReattach,
}: LeftRailProps): React.JSX.Element {
  const vaultLine = vaultStateLine(vaultStatus, syncStatus);

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-elevated bg-rail py-3 transition-[width] duration-150",
        collapsed ? "w-rail-collapsed px-1.5" : "w-rail px-2.5",
      )}
    >
      <Tooltip content="Vault" side="right">
        <button
          type="button"
          onClick={onOpenVault}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong",
            collapsed && "justify-center px-0",
          )}
        >
          <Logo size={18} className="shrink-0" />
          {!collapsed && (
            <>
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
            </>
          )}
        </button>
      </Tooltip>

      <nav
        aria-label="Primary"
        className={cn("mt-3 flex flex-col gap-px", collapsed && "items-center")}
      >
        {NAV.map((item) => {
          const active = activeNav === item.id;
          const badge =
            item.id === "hosts"
              ? hostCount
              : item.id === "tunnels" && activeTunnelCount > 0
                ? activeTunnelCount
                : null;

          const button = (
            <button
              key={item.id}
              type="button"
              onClick={() => onNav(item.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors",
                collapsed && "w-9 justify-center px-0",
                active
                  ? "bg-hover font-medium text-fg"
                  : "text-fg-muted hover:bg-hover/60 hover:text-fg",
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
                      <span className="flex h-[15px] min-w-4 items-center justify-center rounded-lg bg-accent/15 px-1 text-[10px] font-semibold text-[#8bb8ff]">
                        {badge}
                      </span>
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
            <span>{runningSessions.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {runningSessions.map((session) => {
              const host = hosts.find((h) => h.id === session.hostId);
              const tint = host?.color ?? "#3d8ef0";
              const attention = sessionAttention?.[session.id];
              const state = attention?.state ?? "running";
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onReattach(session)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-muted transition-colors hover:bg-hover/60 hover:text-fg"
                >
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded-md"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${tint} 15%, transparent)`,
                    }}
                  >
                    <TerminalSquare size={11} strokeWidth={2.4} style={{ color: tint }} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{session.projectName}</span>
                  <span
                    className={cn("size-[7px] shrink-0 rounded-full", attentionDotClass(state))}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {collapsed && runningSessions.length > 0 && (
        <Tooltip
          content={`${runningSessions.length} running`}
          side="right"
        >
          <div className="mt-3 grid size-9 place-items-center rounded-lg text-fg-subtle">
            <RadioDot count={runningSessions.length} />
          </div>
        </Tooltip>
      )}

      <div className={cn("mt-auto", collapsed && "flex justify-center")}>
        <Tooltip content="Settings" side="right">
          <button
            type="button"
            onClick={onSettings}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-fg-subtle transition-colors hover:bg-hover/60 hover:text-fg",
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
