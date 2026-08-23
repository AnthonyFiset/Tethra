import { useCallback, useState } from "react";
import {
  AppWindow,
  ChevronDown,
  Columns2,
  Info,
  KeyRound,
  LayoutGrid,
  Lock,
  Maximize2,
  MoreHorizontal,
  PanelLeft,
  PanelsTopLeft,
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
import { useSurfaceNavExpanded } from "../lib/breakpoints";
import {
  SURFACE_LABELS,
  type SurfaceId,
} from "../surfaces/SurfaceShell";
import { Logo } from "./Logo";
import { IconButton } from "./ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/DropdownMenu";
import { Tooltip } from "./ui/Tooltip";

interface TitleBarProps {
  connectionLabel: string;
  connected: boolean;
  openingLocal: boolean;
  canSplit: boolean;
  zoomed: boolean;
  canZoom: boolean;
  appVersion?: string;
  /** When false, hide sidebar toggle (Launcher mode). */
  showSidebarToggle?: boolean;
  /** Workspace-only chrome: splits, zoom, move tab. */
  workspaceChrome?: boolean;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  onOpenLocal: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onToggleZoom: () => void;
  onNewWindow: () => void;
  onMoveToNewWindow: () => void;
  onSync: () => void;
  onSettings?: () => void;
  onAssistSettings: () => void;
  onChangePassword: () => void;
  onOpenSurface?: (surface: SurfaceId) => void;
  activeSurface?: SurfaceId | null;
  onAbout: () => void;
  onLock: () => void;
  /** Return to Launcher without closing sessions. */
  onGoLauncher?: () => void;
  /** Return to Workspace tabs without closing sessions (Launcher mode). */
  onGoWorkspace?: () => void;
}

export function TitleBar({
  connectionLabel,
  connected,
  openingLocal,
  canSplit,
  zoomed,
  canZoom,
  appVersion,
  showSidebarToggle = true,
  workspaceChrome = true,
  onToggleSidebar,
  onOpenPalette,
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
  onOpenSurface,
  activeSurface,
  onAbout,
  onLock,
  onGoLauncher,
  onGoWorkspace,
}: TitleBarProps): React.JSX.Element {
  const chrome = useChrome();
  const mod = modKeyLabel(chrome);
  const shiftMod = shiftModLabel(chrome);
  const surfaces = Object.keys(SURFACE_LABELS) as SurfaceId[];
  const [surfacesOpen, setSurfacesOpen] = useState(false);
  const closeSurfacesMenu = useCallback(() => setSurfacesOpen(false), []);
  useSurfaceNavExpanded(closeSurfacesMenu);

  return (
    <header className="titlebar flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface">
      <div className="relative z-10 flex shrink-0 items-center gap-2">
        {showSidebarToggle && (
          <Tooltip content={`Toggle sidebar  ${mod}B`} side="bottom">
            <IconButton label="Toggle sidebar" onClick={onToggleSidebar}>
              <PanelLeft size={15} />
            </IconButton>
          </Tooltip>
        )}

        {onGoLauncher && (
          <Tooltip content={`Launcher  ${mod}Esc`} side="bottom">
            <IconButton label="Back to launcher" onClick={onGoLauncher}>
              <LayoutGrid size={15} />
            </IconButton>
          </Tooltip>
        )}

        {onGoWorkspace && (
          <Tooltip content={`Workspace  ${mod}Esc`} side="bottom">
            <IconButton label="Back to workspace" onClick={onGoWorkspace}>
              <PanelsTopLeft size={15} />
            </IconButton>
          </Tooltip>
        )}

        <Logo
          variant="lockup"
          size={17}
          className="max-[520px]:[&>span]:hidden"
        />

        {onOpenSurface && (
          <>
            <nav
              aria-label="Surfaces"
              className="ml-1 hidden items-center gap-0.5 surface-nav:flex"
            >
              {surfaces.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpenSurface(id)}
                  className={cn(
                    "h-7 cursor-pointer rounded-md px-2 text-micro transition-colors",
                    activeSurface === id
                      ? "bg-hover text-fg"
                      : "text-fg-muted hover:bg-hover/60 hover:text-fg",
                  )}
                >
                  {SURFACE_LABELS[id]}
                </button>
              ))}
            </nav>
            <DropdownMenu.Root
              open={surfacesOpen}
              onOpenChange={setSurfacesOpen}
            >
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Surfaces"
                  className={cn(
                    "surface-nav:hidden ml-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-micro transition-colors",
                    "text-fg-muted hover:bg-hover/60 hover:text-fg",
                    "data-[state=open]:bg-hover data-[state=open]:text-fg",
                  )}
                >
                  {activeSurface
                    ? SURFACE_LABELS[activeSurface]
                    : "Surfaces"}
                  <ChevronDown size={13} className="opacity-70" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenuContent align="start" sideOffset={6} className="min-w-40">
                  {surfaces.map((id) => (
                    <DropdownMenuItem
                      key={id}
                      onSelect={() => onOpenSurface(id)}
                      className={
                        activeSurface === id ? "text-fg" : undefined
                      }
                    >
                      {SURFACE_LABELS[id]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        )}
      </div>

      {/* Dedicated drag strip — not an ancestor of buttons. */}
      <div
        data-tauri-drag-region
        className="hidden h-full min-w-2 flex-1 max-md:block"
      />

      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          "relative z-10 mx-auto flex h-7 w-full max-w-80 cursor-pointer items-center gap-2 rounded-md border border-line bg-base px-2.5",
          "text-micro text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted",
          "max-md:hidden",
        )}
      >
        <Search size={13} />
        <span>Search hosts and commands</span>
        <kbd className="ml-auto rounded border border-line px-1 py-px font-sans text-[10px] text-fg-subtle">
          {mod}K
        </kbd>
      </button>

      <div
        data-tauri-drag-region
        className="hidden h-full min-w-2 flex-1 md:block"
      />

      <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1">
        {workspaceChrome && (
          <>
            <Tooltip content={`Split right  ${mod}\\`} side="bottom">
              <IconButton
                label="Split right"
                onClick={onSplitRight}
                disabled={!canSplit}
                className="max-md:hidden"
              >
                <Columns2 size={15} />
              </IconButton>
            </Tooltip>
            <Tooltip content={`Split down  ${shiftMod}\\`} side="bottom">
              <IconButton
                label="Split down"
                onClick={onSplitDown}
                disabled={!canSplit}
                className="max-md:hidden"
              >
                <Rows2 size={15} />
              </IconButton>
            </Tooltip>
            <Tooltip
              content={
                zoomed
                  ? "Exit zoom  Esc"
                  : `Zoom pane  ${shiftMod}${chrome === "mac" ? "↩" : "Enter"}`
              }
              side="bottom"
            >
              <IconButton
                label={zoomed ? "Exit zoom" : "Zoom pane"}
                onClick={onToggleZoom}
                disabled={!canZoom}
                className="max-md:hidden"
              >
                <Maximize2 size={15} />
              </IconButton>
            </Tooltip>
            <span
              aria-hidden="true"
              className="mx-0.5 hidden h-4 w-px bg-line-strong max-md:hidden sm:block"
            />
          </>
        )}

        <Tooltip content="New local terminal" side="bottom">
          <IconButton
            label="New local terminal"
            onClick={onOpenLocal}
            disabled={openingLocal}
          >
            <TerminalSquare size={15} />
          </IconButton>
        </Tooltip>

        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line-strong" />

        <Tooltip
          content={`Lock vault  ${chrome === "mac" ? "⌃⌘L" : "Ctrl+Alt+L"}`}
          side="bottom"
        >
          <IconButton label="Lock vault" onClick={onLock}>
            <Lock size={15} />
          </IconButton>
        </Tooltip>

        <DropdownMenu.Root>
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
                <DropdownMenuItem
                  icon={<LayoutGrid size={14} />}
                  onSelect={onGoLauncher}
                >
                  Launcher
                  <span className="ml-auto text-fg-subtle">{mod}Esc</span>
                </DropdownMenuItem>
              )}
              {onGoWorkspace && (
                <DropdownMenuItem
                  icon={<PanelsTopLeft size={14} />}
                  onSelect={onGoWorkspace}
                >
                  Workspace
                  <span className="ml-auto text-fg-subtle">{mod}Esc</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem icon={<AppWindow size={14} />} onSelect={onNewWindow}>
                New window
              </DropdownMenuItem>
              {workspaceChrome && (
                <DropdownMenuItem
                  icon={<AppWindow size={14} />}
                  onSelect={onMoveToNewWindow}
                >
                  Move tab to new window
                </DropdownMenuItem>
              )}
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              {onSettings && (
                <DropdownMenuItem icon={<Settings size={14} />} onSelect={onSettings}>
                  Settings…
                  <span className="ml-auto text-fg-subtle">
                    {chrome === "mac" ? "⌘," : "Ctrl+,"}
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem icon={<RefreshCw size={14} />} onSelect={onSync}>
                Vault sync
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Sparkles size={14} />}
                onSelect={onAssistSettings}
              >
                Assist providers
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<KeyRound size={14} />}
                onSelect={onChangePassword}
              >
                Change master password
              </DropdownMenuItem>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenuItem icon={<Info size={14} />} onSelect={onAbout}>
                About Tethra
              </DropdownMenuItem>
              {appVersion && (
                <div className="px-2 py-1.5 text-micro text-fg-subtle">
                  Version {appVersion}
                  {import.meta.env.DEV ? " (dev)" : ""}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <div className="ml-1 flex items-center gap-1.5 text-micro text-fg-subtle max-[640px]:hidden">
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-success" : "bg-line-strong",
            )}
          />
          {connectionLabel}
        </div>
      </div>
    </header>
  );
}
