import { Folder, GitBranch } from "lucide-react";
import { cn } from "../lib/cn";

interface SessionContextBarProps {
  cwd?: string;
  gitBranch?: string;
  meta?: string;
  className?: string;
}

/** 34px cwd · branch · session meta row (session-reference.html). */
export function SessionContextBar({
  cwd,
  gitBranch,
  meta,
  className,
}: SessionContextBarProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex h-[34px] shrink-0 items-center gap-2 border-b border-elevated px-[18px] font-mono text-[11px]",
        className,
      )}
    >
      {cwd && (
        <span className="flex h-[22px] items-center gap-1.5 rounded-md border border-line bg-surface px-[9px] text-fg-muted">
          <Folder size={10} strokeWidth={2} className="text-fg-subtle" />
          {cwd}
        </span>
      )}
      {gitBranch && (
        <span className="flex h-[22px] items-center gap-1.5 rounded-md border border-line bg-surface px-[9px] text-[#8bb8ff]">
          <GitBranch size={10} strokeWidth={2} />
          {gitBranch}
        </span>
      )}
      <span className="flex-1" />
      {meta && <span className="text-fg-subtle">{meta}</span>}
    </div>
  );
}
