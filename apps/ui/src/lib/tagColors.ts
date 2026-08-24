/** Deterministic accent for tag/group tiles (host-identity palette). */
const GROUP_PALETTE = [
  { bg: "color-mix(in srgb, var(--color-accent) 14%, transparent)", fg: "#8bb8ff" },
  { bg: "color-mix(in srgb, var(--color-success) 13%, transparent)", fg: "var(--color-success)" },
  { bg: "color-mix(in srgb, var(--color-warning) 13%, transparent)", fg: "var(--color-warning)" },
  { bg: "color-mix(in srgb, #a371f7 15%, transparent)", fg: "#a371f7" },
  { bg: "color-mix(in srgb, #4dd0e1 14%, transparent)", fg: "#4dd0e1" },
] as const;

export function tagGroupColors(tag: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return GROUP_PALETTE[hash % GROUP_PALETTE.length]!;
}

/** Solid avatar background/text from a host accent color (v0.5 home tiles). */
export function hostTileAvatarStyle(color: string | null | undefined): {
  backgroundColor: string;
  color: string;
} {
  const tint = color ?? "#3d8ef0";
  return {
    backgroundColor: `color-mix(in srgb, ${tint} 22%, var(--color-base))`,
    color: tint,
  };
}
