import * as RadixContextMenu from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface ContextMenuProps {
  children: ReactNode;
  content: ReactNode;
  /** Disable the menu (e.g. disconnected surfaces). */
  disabled?: boolean;
  /** Called when the menu opens/closes — use to snapshot selection, etc. */
  onOpenChange?: (open: boolean) => void;
}

/** App-token context menu. Pair with global WebView contextmenu suppress. */
export function ContextMenu({
  children,
  content,
  disabled,
  onOpenChange,
}: ContextMenuProps): React.JSX.Element {
  if (disabled) {
    return <>{children}</>;
  }
  return (
    <RadixContextMenu.Root onOpenChange={onOpenChange}>
      <RadixContextMenu.Trigger asChild>{children}</RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content
          className={cn(
            "z-[2147483001] min-w-44 overflow-hidden rounded-md border border-line-strong bg-elevated p-1",
            "shadow-xl shadow-black/50 outline-none",
          )}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {content}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}

interface ItemProps {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  shortcut?: string;
}

export function ContextMenuItem({
  children,
  onSelect,
  disabled,
  destructive,
  shortcut,
}: ItemProps): React.JSX.Element {
  return (
    <RadixContextMenu.Item
      disabled={disabled}
      onSelect={() => onSelect?.()}
      className={cn(
        "flex cursor-pointer select-none items-center justify-between gap-4 rounded px-2 py-1.5 text-ui outline-none",
        "data-[highlighted]:bg-hover",
        "data-[disabled]:cursor-default data-[disabled]:opacity-40",
        destructive
          ? "text-danger data-[highlighted]:bg-danger/10"
          : "text-fg",
      )}
    >
      <span>{children}</span>
      {shortcut && (
        <span className="text-micro text-fg-subtle">{shortcut}</span>
      )}
    </RadixContextMenu.Item>
  );
}

export function ContextMenuSeparator(): React.JSX.Element {
  return <RadixContextMenu.Separator className="my-1 h-px bg-line" />;
}

export function ContextMenuLabel({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <RadixContextMenu.Label className="px-2 py-1 text-micro text-fg-subtle">
      {children}
    </RadixContextMenu.Label>
  );
}
