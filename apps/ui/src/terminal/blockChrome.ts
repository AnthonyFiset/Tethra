/** DOM helpers for OSC 133 block chrome (session-reference.html values). */

export const BLOCK_COLORS = {
  ok: "#3fb950",
  fail: "#e5544b",
  accent: "#3d8ef0",
  branch: "#8bb8ff",
  subtle: "#6b6b6b",
  fgMuted: "#a1a1a1",
  waiting: "#d29922",
  activeBorder: "rgba(61,142,240,0.5)",
  activeBg: "rgba(61,142,240,0.05)",
  activeShadow: "0 0 0 3px rgba(61,142,240,0.06)",
  waitingBg: "rgba(210,153,34,0.09)",
  waitingBorder: "rgba(210,153,34,0.3)",
  menuBg: "#1b1b1b",
  menuBorder: "#363636",
  menuWidth: "190px",
} as const;

export function formatBlockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mrem = minutes % 60;
  return mrem > 0 ? `${hours}h ${mrem}m` : `${hours}h`;
}

export function shortenPath(cwd: string | undefined): string {
  if (!cwd) return "";
  const home = cwd.replace(/^\/Users\/[^/]+/, "~");
  return home.replace(/^\/home\/[^/]+/, "~");
}
