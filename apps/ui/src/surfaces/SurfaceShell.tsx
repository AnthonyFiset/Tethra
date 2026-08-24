import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "../components/ui/Button";

export type SurfaceId = "vault" | "assist" | "agents" | "identities";

export const SURFACE_LABELS: Record<SurfaceId, string> = {
  vault: "Vault",
  assist: "Assist",
  agents: "Agents",
  identities: "Identities",
};

export const SURFACE_CONTENT_CLASS = "mx-auto w-full max-w-[880px]";

interface SurfaceShellProps {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

/** First-class surface layout: fixed header, single scroll body (DESIGN.md §3). */
export function SurfaceShell({
  title,
  description,
  onClose,
  children,
  actions,
}: SurfaceShellProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-base">
      <header className="shrink-0 border-b border-line px-5 py-4">
        <div className={cn(SURFACE_CONTENT_CLASS, "flex items-start gap-3")}>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[15px] font-semibold text-fg">{title}</h1>
            <p className="mt-1 mb-0 text-micro text-fg-muted">{description}</p>
          </div>
          {actions}
          <Button
            variant="subtle"
            aria-label={`Close ${title}`}
            className="!px-2"
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className={SURFACE_CONTENT_CLASS}>{children}</div>
      </div>
    </div>
  );
}
