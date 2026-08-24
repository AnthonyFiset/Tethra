/**
 * Stable hue from a tag string — for the glyph only.
 * Tile backgrounds stay neutral (`--color-elevated` / #1b1b1b).
 */
export function tagHue(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function tagGroupColors(tag: string): { bg: string; fg: string } {
  const hue = tagHue(tag);
  return {
    bg: "#1b1b1b",
    fg: `hsl(${hue} 55% 62%)`,
  };
}

/** Neutral tile + host accent on the letter (v0.5 home tiles). */
export function hostTileAvatarStyle(color: string | null | undefined): {
  backgroundColor: string;
  color: string;
} {
  const tint = color ?? "#3d8ef0";
  return {
    backgroundColor: "#1b1b1b",
    color: tint,
  };
}
