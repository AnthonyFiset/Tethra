/** Client-side prefs (M12.5 Track A/B). Vault-backed prefs come later. */

export type LandingPref = "launcher" | "workspace";

/** Window chrome material. Opaque is the shipped default. */
export type MaterialPref = "opaque" | "vibrant" | "custom" | "acrylic";

const KEYS = {
  landing: "tethra.landing",
  fontSize: "tethra.terminal.fontSize",
  ligatures: "tethra.terminal.ligatures",
  cursorBlink: "tethra.terminal.cursorBlink",
  copyOnSelect: "tethra.terminal.copyOnSelect",
  idleLockSecs: "tethra.vault.idleLockSecs",
  material: "tethra.chrome.material",
  chromeOpacity: "tethra.chrome.opacity",
  terminalOpacity: "tethra.terminal.opacity",
} as const;

export const DEFAULTS = {
  landing: "launcher" as LandingPref,
  fontSize: 13,
  ligatures: false,
  cursorBlink: true,
  copyOnSelect: false,
  /** 15 minutes — matches core DEFAULT_IDLE_LOCK. */
  idleLockSecs: 15 * 60,
  material: "opaque" as MaterialPref,
  chromeOpacity: 92,
  terminalOpacity: 100,
};

export const IDLE_LOCK_OPTIONS: Array<{ secs: number; label: string }> = [
  { secs: 0, label: "Never" },
  { secs: 5 * 60, label: "5 minutes" },
  { secs: 15 * 60, label: "15 minutes" },
  { secs: 30 * 60, label: "30 minutes" },
  { secs: 60 * 60, label: "1 hour" },
  { secs: 4 * 60 * 60, label: "4 hours" },
];

function readString(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode
  }
}

export function getLandingPref(): LandingPref {
  const raw = readString(KEYS.landing);
  return raw === "workspace" ? "workspace" : DEFAULTS.landing;
}

export function setLandingPref(value: LandingPref): void {
  writeString(KEYS.landing, value);
}

export function getTerminalFontSize(): number {
  const raw = Number(readString(KEYS.fontSize));
  if (!Number.isFinite(raw) || raw < 10 || raw > 24) return DEFAULTS.fontSize;
  return Math.round(raw);
}

export function setTerminalFontSize(size: number): void {
  writeString(KEYS.fontSize, String(Math.min(24, Math.max(10, Math.round(size)))));
}

export function getTerminalLigatures(): boolean {
  const raw = readString(KEYS.ligatures);
  if (raw === null || raw === undefined) return DEFAULTS.ligatures;
  return raw === "1" || raw === "true";
}

export function setTerminalLigatures(on: boolean): void {
  writeString(KEYS.ligatures, on ? "1" : "0");
}

export function getTerminalCursorBlink(): boolean {
  const raw = readString(KEYS.cursorBlink);
  if (raw === null || raw === undefined) return DEFAULTS.cursorBlink;
  return raw !== "0" && raw !== "false";
}

export function setTerminalCursorBlink(on: boolean): void {
  writeString(KEYS.cursorBlink, on ? "1" : "0");
}

export function getTerminalCopyOnSelect(): boolean {
  const raw = readString(KEYS.copyOnSelect);
  if (raw === null || raw === undefined) return DEFAULTS.copyOnSelect;
  return raw === "1" || raw === "true";
}

export function setTerminalCopyOnSelect(on: boolean): void {
  writeString(KEYS.copyOnSelect, on ? "1" : "0");
}

export function getIdleLockSecs(): number {
  const raw = Number(readString(KEYS.idleLockSecs));
  if (!Number.isFinite(raw) || raw < 0) return DEFAULTS.idleLockSecs;
  if (raw === 0) return 0;
  if (IDLE_LOCK_OPTIONS.some((option) => option.secs === raw)) return raw;
  return DEFAULTS.idleLockSecs;
}

export function setIdleLockSecs(secs: number): void {
  writeString(KEYS.idleLockSecs, String(Math.max(0, Math.round(secs))));
}

export function getMaterialPref(): MaterialPref {
  const raw = readString(KEYS.material);
  if (
    raw === "opaque" ||
    raw === "vibrant" ||
    raw === "custom" ||
    raw === "acrylic"
  ) {
    return raw;
  }
  return DEFAULTS.material;
}

export function setMaterialPref(value: MaterialPref): void {
  writeString(KEYS.material, value);
}

export function getChromeOpacity(): number {
  const raw = Number(readString(KEYS.chromeOpacity));
  if (!Number.isFinite(raw)) return DEFAULTS.chromeOpacity;
  return Math.min(100, Math.max(85, Math.round(raw)));
}

export function setChromeOpacity(value: number): void {
  writeString(
    KEYS.chromeOpacity,
    String(Math.min(100, Math.max(85, Math.round(value)))),
  );
}

export function getTerminalOpacity(): number {
  const raw = Number(readString(KEYS.terminalOpacity));
  if (!Number.isFinite(raw)) return DEFAULTS.terminalOpacity;
  return Math.min(100, Math.max(85, Math.round(raw)));
}

export function setTerminalOpacity(value: number): void {
  writeString(
    KEYS.terminalOpacity,
    String(Math.min(100, Math.max(85, Math.round(value)))),
  );
}

export function resetTerminalPrefs(): void {
  setTerminalFontSize(DEFAULTS.fontSize);
  setTerminalLigatures(DEFAULTS.ligatures);
  setTerminalCursorBlink(DEFAULTS.cursorBlink);
  setTerminalCopyOnSelect(DEFAULTS.copyOnSelect);
}
