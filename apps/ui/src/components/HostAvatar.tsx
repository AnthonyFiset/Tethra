import { Folder, TerminalSquare } from "lucide-react";
import { cn } from "../lib/cn";

export const DEFAULT_HOST_COLOR = "#4C8DF6";

interface HostAvatarProps {
  label: string;
  color?: string | null;
  size?: "sm" | "md";
  kind?: "host" | "sftp" | "local";
  className?: string;
}

/**
 * Colour is the ambient host identity cue: the same hue appears on the rail,
 * the tab, and the terminal hairline so the active machine is recognisable
 * without reading a label.
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
        "inline-grid shrink-0 place-items-center rounded-[6px] border font-semibold",
        size === "sm" ? "size-5 text-[10px]" : "size-7 text-[11px]",
        className,
      )}
      style={{
        color: tint,
        backgroundColor: `color-mix(in srgb, ${tint} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${tint} 30%, transparent)`,
      }}
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
