/** Apply brand / system accent to CSS variables. */

import { platformSystemAccent } from "./ipc";
import { detectChromeStyle } from "./chrome";

function lightenHex(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const n = Number.parseInt(raw, 16);
  if (!Number.isFinite(n)) return hex;
  const r = Math.min(255, ((n >> 16) & 0xff) + amount);
  const g = Math.min(255, ((n >> 8) & 0xff) + amount);
  const b = Math.min(255, (n & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function applyAccentVars(hex: string): void {
  const root = document.documentElement;
  root.style.setProperty("--color-accent", hex);
  root.style.setProperty("--color-accent-hover", lightenHex(hex, 28));
}

/** On Windows, honor the system accent; elsewhere keep the brand default. */
export async function applyPlatformAccent(): Promise<void> {
  if (detectChromeStyle() !== "win") return;
  try {
    const accent = await platformSystemAccent();
    if (accent && /^#[0-9A-Fa-f]{6}$/.test(accent)) {
      applyAccentVars(accent);
    }
  } catch {
    // keep brand default
  }
}
