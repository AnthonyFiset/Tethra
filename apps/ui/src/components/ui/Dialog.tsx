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
  /** Alert dialogs hide the close affordance so the choice stays explicit. */
  dismissible?: boolean;
  width?: "sm" | "md" | "lg";
  children?: ReactNode;
  footer?: ReactNode;
}

const WIDTHS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

export function Dialog({
  open,
  onOpenChange,
  title,
  kicker,
  description,
  dismissible = true,
  width = "md",
  children,
  footer,
}: DialogProps): React.JSX.Element {
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
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2",
            "rounded-panel border border-line-strong bg-elevated p-5 shadow-2xl shadow-black/60",
            WIDTHS[width],
          )}
        >
          {kicker && (
            <span className="mb-1.5 block text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
              {kicker}
            </span>
          )}
          <RadixDialog.Title className="m-0 text-[15px] font-semibold text-fg">
            {title}
          </RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mt-2 mb-0 text-ui text-fg-muted">
              {description}
            </RadixDialog.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer && (
            <div className="mt-5 flex justify-end gap-2">{footer}</div>
          )}
          {dismissible && (
            <RadixDialog.Close
              aria-label="Close"
              className="absolute top-4 right-4 inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <X size={14} />
            </RadixDialog.Close>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
