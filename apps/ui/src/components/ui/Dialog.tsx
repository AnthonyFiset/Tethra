import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  kicker?: string;
  description?: ReactNode;
  /** Extra chrome under the title — stays fixed while the body scrolls. */
  header?: ReactNode;
  /** Alert dialogs hide the close affordance so the choice stays explicit. */
  dismissible?: boolean;
  width?: "sm" | "md" | "lg" | "xl";
  children?: ReactNode;
  footer?: ReactNode;
  /**
   * When true (default), do not restore focus to the previously focused
   * element (often the terminal). Prevents click-through injecting CSI/OSC.
   */
  preventCloseAutoFocus?: boolean;
  /** Optional class on the content panel (e.g. flush padding for settings). */
  contentClassName?: string;
  /** Visually hide the title (kept for accessibility). */
  titleSrOnly?: boolean;
  /**
   * Scroll the children pane (DESIGN.md §3). Set false when the child
   * provides its own single overflow-y-auto (Settings).
   */
  scrollBody?: boolean;
}

const WIDTHS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Dialog({
  open,
  onOpenChange,
  title,
  kicker,
  description,
  header,
  dismissible = true,
  width = "md",
  children,
  footer,
  preventCloseAutoFocus = true,
  contentClassName,
  titleSrOnly = false,
  scrollBody = true,
}: DialogProps): React.JSX.Element {
  const showChrome = Boolean(kicker || !titleSrOnly || description || header);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <RadixDialog.Content
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (preventCloseAutoFocus) event.preventDefault();
          }}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-32px)] max-h-[85vh] min-h-0 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-panel border border-line-strong bg-elevated shadow-2xl shadow-black/60",
            WIDTHS[width],
            contentClassName,
          )}
        >
          {showChrome && (
            <div className="relative shrink-0 px-5 pt-5">
              {kicker && (
                <span className="mb-1.5 block pr-8 text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
                  {kicker}
                </span>
              )}
              <RadixDialog.Title
                className={cn(
                  "m-0 pr-8 text-[15px] font-semibold text-fg",
                  titleSrOnly && "sr-only",
                )}
              >
                {title}
              </RadixDialog.Title>
              {description && !titleSrOnly && (
                <RadixDialog.Description className="mt-2 mb-0 text-ui text-fg-muted">
                  {description}
                </RadixDialog.Description>
              )}
              {description && titleSrOnly && (
                <RadixDialog.Description className="sr-only">
                  {description}
                </RadixDialog.Description>
              )}
              {header && <div className="mt-4">{header}</div>}
            </div>
          )}
          {!showChrome && (
            <>
              <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="sr-only">
                  {description}
                </RadixDialog.Description>
              )}
            </>
          )}
          {children && (
            <div
              className={cn(
                "min-h-0",
                scrollBody
                  ? "flex-1 overflow-y-auto overscroll-contain px-5 py-4"
                  : "flex-1 overflow-hidden",
                !showChrome && scrollBody && "pt-5",
              )}
            >
              {children}
            </div>
          )}
          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-4">
              {footer}
            </div>
          )}
          {dismissible && (
            <RadixDialog.Close
              aria-label="Close"
              className="absolute top-4 right-4 z-10 inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <X size={14} />
            </RadixDialog.Close>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
