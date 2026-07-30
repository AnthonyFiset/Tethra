import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Info,
  KeyRound,
  Lock,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  Search,
  TerminalSquare,
} from "lucide-react";
import { cn } from "../lib/cn";
import { Logo } from "./Logo";
import { IconButton } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

interface TitleBarProps {
  connectionLabel: string;
  connected: boolean;
  openingLocal: boolean;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  onOpenLocal: () => void;
  onSync: () => void;
  onChangePassword: () => void;
  onAbout: () => void;
  onLock: () => void;
}

export function TitleBar({
  connectionLabel,
  connected,
  openingLocal,
  onToggleSidebar,
  onOpenPalette,
  onOpenLocal,
  onSync,
  onChangePassword,
  onAbout,
  onLock,
}: TitleBarProps): React.JSX.Element {
  return (
    // "deep" makes the whole strip draggable; Tauri still exempts buttons.
    <header
      data-tauri-drag-region="deep"
      className="pl-traffic-lights flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface pr-3"
    >
      <Tooltip content="Toggle sidebar  ⌘B" side="bottom">
        <IconButton label="Toggle sidebar" onClick={onToggleSidebar}>
          <PanelLeft size={15} />
        </IconButton>
      </Tooltip>

      <Logo variant="lockup" size={17} className="max-[520px]:[&>span]:hidden" />

      <button
        onClick={onOpenPalette}
        className={cn(
          "mx-auto flex h-7 w-full max-w-80 cursor-pointer items-center gap-2 rounded-md border border-line bg-base px-2.5",
          "text-micro text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted",
          "max-md:hidden",
        )}
      >
        <Search size={13} />
        <span>Search hosts and commands</span>
        <kbd className="ml-auto rounded border border-line px-1 py-px font-sans text-[10px] text-fg-subtle">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip content="New local terminal" side="bottom">
          <IconButton
            label="New local terminal"
            onClick={onOpenLocal}
            disabled={openingLocal}
          >
            <TerminalSquare size={15} />
          </IconButton>
        </Tooltip>

        <Tooltip content="Lock vault" side="bottom">
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
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-100 min-w-52 rounded-md border border-line-strong bg-elevated p-1 shadow-xl shadow-black/60"
            >
              <MenuItem icon={<Search size={14} />} onSelect={onOpenPalette}>
                Command palette
                <span className="ml-auto text-fg-subtle">⌘K</span>
              </MenuItem>
              <MenuItem icon={<RefreshCw size={14} />} onSelect={onSync}>
                Vault sync
              </MenuItem>
              <MenuItem
                icon={<KeyRound size={14} />}
                onSelect={onChangePassword}
              >
                Change master password
              </MenuItem>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <MenuItem icon={<Info size={14} />} onSelect={onAbout}>
                About Tethra
              </MenuItem>
            </DropdownMenu.Content>
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

function MenuItem({
  icon,
  onSelect,
  children,
}: {
  icon: React.ReactNode;
  onSelect: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-ui text-fg-muted outline-none select-none data-[highlighted]:bg-hover data-[highlighted]:text-fg"
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}
