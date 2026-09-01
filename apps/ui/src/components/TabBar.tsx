import { Plus, X } from "lucide-react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/ContextMenu";
import { cn } from "../lib/cn";
import { DEFAULT_HOST_COLOR } from "./HostAvatar";

export interface TabDescriptor {
  sessionId: string;
  title: string;
  kind: "terminal" | "local" | "sftp";
  connected: boolean;
  color?: string | null;
  /** Vault project name when opened from a project. */
  projectName?: string;
  /** Agent waiting indicator for session chrome. */
  waiting?: boolean;
}

interface TabBarProps {
  tabs: TabDescriptor[];
  activeId?: string;
  variant?: "default" | "titlebar";
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCloseOthers?: (sessionId: string) => void;
  onMoveToNewWindow?: (sessionId: string) => void;
  onNewTab?: () => void;
}

export function TabBar({
  tabs,
  activeId,
  variant = "default",
  onSelect,
  onClose,
  onCloseOthers,
  onMoveToNewWindow,
  onNewTab,
}: TabBarProps): React.JSX.Element | null {
  if (tabs.length === 0 && !onNewTab) return null;

  if (variant === "titlebar") {
    return (
      <div role="tablist" className="flex min-w-0 items-center gap-1">
        {tabs.map((tab) => {
          const active = tab.sessionId === activeId;
          return (
            <ContextMenu
              key={tab.sessionId}
              content={
                <>
                  <ContextMenuItem onSelect={() => onClose(tab.sessionId)}>
                    Close
                  </ContextMenuItem>
                  {onCloseOthers && tabs.length > 1 && (
                    <ContextMenuItem
                      onSelect={() => onCloseOthers(tab.sessionId)}
                    >
                      Close others
                    </ContextMenuItem>
                  )}
                  {onMoveToNewWindow &&
                    (tab.kind === "terminal" || tab.kind === "local") && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onSelect={() => onMoveToNewWindow(tab.sessionId)}
                        >
                          Move to new window
                        </ContextMenuItem>
                      </>
                    )}
                </>
              }
            >
              <div
                className={cn(
                  "group flex h-7 max-w-52 items-center gap-2 rounded-lg px-3 text-[12px]",
                  active
                    ? "border border-line-strong bg-elevated font-semibold text-fg"
                    : "text-fg-muted hover:bg-hover/60",
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: tab.color ?? DEFAULT_HOST_COLOR }}
                />
                <button
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => onSelect(tab.sessionId)}
                  className="flex min-w-0 cursor-pointer items-center gap-2"
                >
                  <span className="truncate">{tab.title}</span>
                  {tab.projectName && (
                    <span className="truncate font-mono text-[10px] font-normal text-fg-subtle">
                      {tab.projectName}
                    </span>
                  )}
                </button>
                {tab.waiting && (
                  <span className="size-[7px] shrink-0 rounded-full bg-warning" />
                )}
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => onClose(tab.sessionId)}
                  className={cn(
                    "grid size-4 shrink-0 cursor-pointer place-items-center rounded text-fg-subtle opacity-0 transition-opacity hover:text-fg group-hover:opacity-100",
                    active && "opacity-100",
                  )}
                >
                  <X size={9} strokeWidth={2.5} />
                </button>
              </div>
            </ContextMenu>
          );
        })}
        {onNewTab && (
          <button
            type="button"
            aria-label="New tab"
            onClick={onNewTab}
            className="grid size-6 cursor-pointer place-items-center rounded-md text-fg-subtle hover:bg-hover/60 hover:text-fg-muted"
          >
            <Plus size={12} strokeWidth={2} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface"
    >
      {tabs.map((tab) => {
        const active = tab.sessionId === activeId;
        return (
          <ContextMenu
            key={tab.sessionId}
            content={
              <>
                <ContextMenuItem
                  shortcut="⌘W"
                  onSelect={() => onClose(tab.sessionId)}
                >
                  Close
                </ContextMenuItem>
                {onCloseOthers && tabs.length > 1 && (
                  <ContextMenuItem
                    onSelect={() => onCloseOthers(tab.sessionId)}
                  >
                    Close others
                  </ContextMenuItem>
                )}
                {onMoveToNewWindow &&
                  (tab.kind === "terminal" || tab.kind === "local") && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onSelect={() => onMoveToNewWindow(tab.sessionId)}
                      >
                        Move to new window
                      </ContextMenuItem>
                    </>
                  )}
              </>
            }
          >
            <div
              className={cn(
                "group relative flex min-w-36 max-w-56 items-center border-r border-line",
                active ? "bg-base" : "hover:bg-hover",
              )}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5"
                  style={{ backgroundColor: tab.color ?? DEFAULT_HOST_COLOR }}
                />
              )}
              <button
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(tab.sessionId)}
                className={cn(
                  "flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 text-ui",
                  active ? "text-fg" : "text-fg-muted",
                )}
              >
                <span className="truncate">{tab.title}</span>
                {!tab.connected && (
                  <span
                    title="Disconnected"
                    className="size-1.5 shrink-0 rounded-full bg-line-strong"
                  />
                )}
              </button>
              <button
                aria-label={`Close ${tab.title}`}
                title="Close tab (session keeps running if in tmux)"
                onClick={() => onClose(tab.sessionId)}
                className={cn(
                  "mr-1.5 grid size-5 shrink-0 cursor-pointer place-items-center rounded text-fg-subtle transition-colors",
                  "hover:bg-active hover:text-fg",
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  active && "opacity-100",
                )}
              >
                <X size={13} />
              </button>
            </div>
          </ContextMenu>
        );
      })}
    </div>
  );
}
