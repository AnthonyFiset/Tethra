import { Folder, TerminalSquare } from "lucide-react";
import { cn } from "../lib/cn";

export const DEFAULT_HOST_COLOR = "#3D8EF0";

interface HostAvatarProps {
  label: string;
  color?: string | null;
  size?: "sm" | "md";
  kind?: "host" | "sftp" | "local";
  className?: string;
}

/**
 * Neutral elevated tile + colored glyph/letter. Host hue stays in the
 * glyph (and tab/terminal hairline), not a color-washed fill.
 */
export function HostAvatar({
  label,
  color,
  size = "md",
  kind = "host",
  className,
}: HostAvatarProps): React.JSX.Element {
  const tint = color ?? DEFAULT_HOST_COLOR;
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-[6px] border border-line bg-elevated font-semibold",
        size === "sm" ? "size-5 text-[10px]" : "size-7 text-[11px]",
        className,
      )}
      style={{ color: tint }}
      aria-hidden="true"
    >
      {kind === "sftp" ? (
        <Folder size={iconSize} />
      ) : kind === "local" ? (
        <TerminalSquare size={iconSize} />
      ) : (
        label.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  );
}
