import { useCallback, useState } from "react";
import {
  AppWindow,
  Columns2,
  House,
  Info,
  KeyRound,
  LayoutGrid,
  Lock,
  Maximize2,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  Rows2,
  Search,
  Settings,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useChrome } from "../lib/ChromeContext";
import { modKeyLabel, shiftModLabel } from "../lib/chrome";
import { IconButton } from "./ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/DropdownMenu";
import type { TabDescriptor } from "./TabBar";
import { Tooltip } from "./ui/Tooltip";

interface TitleBarProps {
  /** Session tabs shown inline when in workspace. */
  tabs?: TabDescriptor[];
  activeTabId?: string;
  inWorkspace?: boolean;
  openingLocal?: boolean;
  canSplit?: boolean;
  zoomed?: boolean;
  canZoom?: boolean;
  appVersion?: string;
  activeTunnelCount?: number;
  onOpenPalette: () => void;
  onSelectTab?: (sessionId: string) => void;
  onCloseTab?: (sessionId: string) => void;
  onCloseOtherTabs?: (sessionId: string) => void;
  onMoveTabToNewWindow?: (sessionId: string) => void;
  onNewTab?: () => void;
  onOpenLocal?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onToggleZoom?: () => void;
  onNewWindow?: () => void;
  onMoveToNewWindow?: () => void;
  onSync?: () => void;
  onSettings?: () => void;
  onAssistSettings?: () => void;
  onChangePassword?: () => void;
  onAbout?: () => void;
  onLock: () => void;
  onGoLauncher?: () => void;
  /** Sidebar fully shown/hidden (Warp-style) — no icon-collapse. */
  railHidden?: boolean;
  onToggleRail?: () => void;
}

export function TitleBar({
  tabs = [],
  activeTabId,
  inWorkspace = false,
  openingLocal,
  canSplit,
  zoomed,
  canZoom,
  appVersion,
  activeTunnelCount = 0,
  onOpenPalette,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onMoveTabToNewWindow,
  onNewTab,
  onOpenLocal,
  onSplitRight,
  onSplitDown,
  onToggleZoom,
  onNewWindow,
  onMoveToNewWindow,
  onSync,
  onSettings,
  onAssistSettings,
  onChangePassword,
  onAbout,
  onLock,
  onGoLauncher,
  railHidden = false,
  onToggleRail,
}: TitleBarProps): React.JSX.Element {
  const chrome = useChrome();
  const mod = modKeyLabel(chrome);
  const shiftMod = shiftModLabel(chrome);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  void closeMenu;

  // Sessions render in the sidebar list now; these tab props are accepted
  // for compatibility but the titlebar no longer draws a tab strip.
  void tabs;
  void activeTabId;
  void onSelectTab;
  void onCloseTab;
  void onCloseOtherTabs;
  void onMoveTabToNewWindow;
  void onNewTab;

  return (
    <header
      data-tauri-drag-region
      className="titlebar flex h-10 shrink-0 items-center gap-2 border-b border-elevated bg-rail px-3.5"
    >
      {/* Left: sidebar toggle + home (Warp-style). Sessions live in the
          sidebar list now — no tab strip in the titlebar. */}
      <div className="relative z-10 flex shrink-0 items-center gap-0.5">
        {onToggleRail && (
          <Tooltip
            content={`${railHidden ? "Show" : "Hide"} sidebar  ${mod}B`}
            side="bottom"
          >
            <IconButton
              label={railHidden ? "Show sidebar" : "Hide sidebar"}
              onClick={onToggleRail}
            >
              <PanelLeft size={15} />
            </IconButton>
          </Tooltip>
        )}
        {inWorkspace && onGoLauncher && (
          <Tooltip content="Home" side="bottom">
            <IconButton label="Home" onClick={onGoLauncher}>
              <House size={15} />
            </IconButton>
          </Tooltip>
        )}
      </div>

      <div data-tauri-drag-region className="h-full min-w-2 flex-1" />

      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          "relative z-10 flex h-[26px] w-full max-w-[300px] cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-2.5",
          "text-[12px] text-fg-subtle transition-colors hover:border-line-strong hover:bg-hover hover:text-fg-muted",
        )}
      >
        <Search size={13} />
        <span className="flex-1 truncate text-left">Search hosts and commands</span>
        <kbd className="rounded border border-line px-1 py-px font-sans text-[10px] text-fg-subtle">
          {mod}K
        </kbd>
      </button>

      <div data-tauri-drag-region className="h-full min-w-2 flex-1" />

      <div className="relative z-10 ml-auto flex shrink-0 items-center gap-2">
        {inWorkspace && activeTunnelCount > 0 && (
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] text-[#8bb8ff] sm:flex">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v9a4 4 0 0 0 8 0V3M4 21h16" />
            </svg>
            {activeTunnelCount}
          </span>
        )}

        <Tooltip
          content={`Lock vault  ${chrome === "mac" ? "⌃⌘L" : "Ctrl+Alt+L"}`}
          side="bottom"
        >
          <IconButton label="Lock vault" onClick={onLock}>
            <Lock size={15} />
          </IconButton>
        </Tooltip>

        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <IconButton label="More actions">
              <MoreHorizontal size={15} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent align="end" sideOffset={6} className="min-w-52">
              <DropdownMenuItem icon={<Search size={14} />} onSelect={onOpenPalette}>
                Command palette
                <span className="ml-auto text-fg-subtle">{mod}K</span>
              </DropdownMenuItem>
              {onGoLauncher && (
                <DropdownMenuItem icon={<LayoutGrid size={14} />} onSelect={onGoLauncher}>
                  Hosts
                  <span className="ml-auto text-fg-subtle">{mod}Esc</span>
                </DropdownMenuItem>
              )}
              {onOpenLocal && (
                <DropdownMenuItem icon={<TerminalSquare size={14} />} onSelect={onOpenLocal}>
                  New local terminal
                </DropdownMenuItem>
              )}
              {onNewWindow && (
                <DropdownMenuItem icon={<AppWindow size={14} />} onSelect={onNewWindow}>
                  New window
                </DropdownMenuItem>
              )}
              {onMoveToNewWindow && (
                <DropdownMenuItem icon={<AppWindow size={14} />} onSelect={onMoveToNewWindow}>
                  Move tab to new window
                </DropdownMenuItem>
              )}
              {inWorkspace && onSplitRight && (
                <DropdownMenuItem icon={<Columns2 size={14} />} onSelect={onSplitRight} disabled={!canSplit}>
                  Split right
                  <span className="ml-auto text-fg-subtle">{mod}\</span>
                </DropdownMenuItem>
              )}
              {inWorkspace && onSplitDown && (
                <DropdownMenuItem icon={<Rows2 size={14} />} onSelect={onSplitDown} disabled={!canSplit}>
                  Split down
                  <span className="ml-auto text-fg-subtle">{shiftMod}\</span>
                </DropdownMenuItem>
              )}
              {inWorkspace && onToggleZoom && (
                <DropdownMenuItem icon={<Maximize2 size={14} />} onSelect={onToggleZoom} disabled={!canZoom}>
                  {zoomed ? "Exit zoom" : "Zoom pane"}
                </DropdownMenuItem>
              )}
              <DropdownMenu.Separator className="-mx-1.5 my-1.5 h-px bg-line" />
              {onSettings && (
                <DropdownMenuItem icon={<Settings size={14} />} onSelect={onSettings}>
                  Settings…
                </DropdownMenuItem>
              )}
              {onSync && (
                <DropdownMenuItem icon={<RefreshCw size={14} />} onSelect={onSync}>
                  Vault sync
                </DropdownMenuItem>
              )}
              {onAssistSettings && (
                <DropdownMenuItem icon={<Sparkles size={14} />} onSelect={onAssistSettings}>
                  Assist providers
                </DropdownMenuItem>
              )}
              {onChangePassword && (
                <DropdownMenuItem icon={<KeyRound size={14} />} onSelect={onChangePassword}>
                  Change master password
                </DropdownMenuItem>
              )}
              <DropdownMenu.Separator className="-mx-1.5 my-1.5 h-px bg-line" />
              {onAbout && (
                <DropdownMenuItem icon={<Info size={14} />} onSelect={onAbout}>
                  About Tethra
                </DropdownMenuItem>
              )}
              {appVersion && (
                <div className="px-2 py-1.5 text-micro text-fg-subtle">
                  Version {appVersion}
                  {import.meta.env.DEV ? " (dev)" : ""}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
