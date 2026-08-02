import { Folder, TerminalSquare, X } from "lucide-react";
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
}

interface TabBarProps {
  tabs: TabDescriptor[];
  activeId?: string;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCloseOthers?: (sessionId: string) => void;
  onMoveToNewWindow?: (sessionId: string) => void;
}

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseOthers,
  onMoveToNewWindow,
}: TabBarProps): React.JSX.Element {
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
                {tab.kind === "sftp" ? (
                  <Folder size={13} className="shrink-0" />
                ) : (
                  <TerminalSquare size={13} className="shrink-0" />
                )}
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
