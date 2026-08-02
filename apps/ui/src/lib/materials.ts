/** Apply window material prefs (Track B). Chrome translucency; terminal stays opaque. */

import {
  getChromeOpacity,
  getMaterialPref,
  getTerminalOpacity,
  type MaterialPref,
} from "./prefs";
import {
  windowApplyMaterial,
  windowMaterialCapabilities,
  type MaterialApplyResult,
  type MaterialCapabilities,
} from "./ipc";

const SOLID = {
  base: "#0d0d0d",
  surface: "#141414",
  elevated: "#1b1b1b",
  hover: "#222222",
  active: "#2a2a2a",
} as const;

function rgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const n = Number.parseInt(raw, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Sync CSS tokens for chrome translucency. Terminal uses --terminal-bg (always solid). */
export function applyMaterialCss(
  kind: MaterialPref = getMaterialPref(),
  chromeOpacity: number = getChromeOpacity(),
  terminalOpacity: number = getTerminalOpacity(),
): void {
  const root = document.documentElement;
  root.dataset.material = kind;

  const translucent = kind !== "opaque";
  const chromeA = translucent ? chromeOpacity / 100 : 1;
  // Terminal stays fully opaque by default (WebGL-safe); slider reserved for later.
  const termA = translucent ? Math.max(chromeA, terminalOpacity / 100) : 1;
  void termA;

  root.style.setProperty("--terminal-bg", SOLID.base);

  if (!translucent) {
    root.style.setProperty("--color-base", SOLID.base);
    root.style.setProperty("--color-surface", SOLID.surface);
    root.style.setProperty("--color-elevated", SOLID.elevated);
    root.style.setProperty("--color-hover", SOLID.hover);
    root.style.setProperty("--color-active", SOLID.active);
    document.body.style.backgroundColor = SOLID.base;
    return;
  }

  root.style.setProperty("--color-base", rgba(SOLID.base, chromeA * 0.88));
  root.style.setProperty("--color-surface", rgba(SOLID.surface, chromeA));
  root.style.setProperty("--color-elevated", rgba(SOLID.elevated, Math.min(1, chromeA + 0.04)));
  root.style.setProperty("--color-hover", rgba(SOLID.hover, Math.min(1, chromeA + 0.06)));
  root.style.setProperty("--color-active", rgba(SOLID.active, Math.min(1, chromeA + 0.08)));
  document.body.style.backgroundColor = "transparent";
}

export async function applyWindowMaterial(
  kind: MaterialPref = getMaterialPref(),
): Promise<MaterialApplyResult | undefined> {
  applyMaterialCss(kind);
  try {
    return await windowApplyMaterial(kind);
  } catch (error) {
    console.warn("window_apply_material failed", error);
    return undefined;
  }
}

export async function loadMaterialCapabilities(): Promise<MaterialCapabilities | undefined> {
  try {
    return await windowMaterialCapabilities();
  } catch {
    return undefined;
  }
}
