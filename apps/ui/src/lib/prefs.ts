/** Client-side prefs (M12.5 Track A/B). Vault-backed prefs come later. */

export type LandingPref = "launcher" | "workspace";

/** Window chrome material. Opaque is the shipped default. */
export type MaterialPref = "opaque" | "vibrant" | "custom" | "acrylic";

const KEYS = {
  landing: "tethra.landing",
  fontSize: "tethra.terminal.fontSize",
  fontFamily: "tethra.terminal.fontFamily",
  lineHeight: "tethra.terminal.lineHeight",
  ligatures: "tethra.terminal.ligatures",
  cursorBlink: "tethra.terminal.cursorBlink",
  cursorStyle: "tethra.terminal.cursorStyle",
  scrollback: "tethra.terminal.scrollback",
  copyOnSelect: "tethra.terminal.copyOnSelect",
  bell: "tethra.terminal.bell",
  notifyWaiting: "tethra.notify.waiting",
  notifyDone: "tethra.notify.done",
  notifyFailed: "tethra.notify.failed",
  idleLockSecs: "tethra.vault.idleLockSecs",
  material: "tethra.chrome.material",
  chromeOpacity: "tethra.chrome.opacity",
  terminalOpacity: "tethra.terminal.opacity",
  defaultShell: "tethra.shell.default",
  loginShell: "tethra.shell.login",
} as const;

export type CursorStylePref = "block" | "underline" | "bar";

export const DEFAULTS = {
  landing: "launcher" as LandingPref,
  fontSize: 12.5,
  /** Must match @fontsource-variable/jetbrains-mono registered family. */
  fontFamily: "JetBrains Mono Variable",
  /**
   * 1.0: xterm 6's core renderer draws block/box glyphs from the font, whose
   * ink covers the em — not the lineHeight-padded cell. Any value above 1
   * slices TUI art (agent logos, btop bars) with background stripes, and the
   * WebGL addon's full-cell custom glyphs never paint reliably in WKWebView.
   */
  lineHeight: 1,
  ligatures: false,
  cursorBlink: true,
  cursorStyle: "bar" as CursorStylePref,
  scrollback: 10_000,
  copyOnSelect: false,
  bell: false,
  notifyWaiting: true,
  notifyDone: false,
  notifyFailed: true,
  /** 15 minutes — matches core DEFAULT_IDLE_LOCK. */
  idleLockSecs: 15 * 60,
  material: "opaque" as MaterialPref,
  chromeOpacity: 92,
  terminalOpacity: 100,
  defaultShell: "",
  loginShell: true,
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
  // Migrate pre-v0.5 default (13) to the session-reference size (12.5).
  if (raw === 13) return DEFAULTS.fontSize;
  if (!Number.isFinite(raw) || raw < 10 || raw > 24) return DEFAULTS.fontSize;
  return raw;
}

export function setTerminalFontSize(size: number): void {
  const clamped = Math.min(24, Math.max(10, size));
  writeString(KEYS.fontSize, String(clamped));
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

export function getTerminalFontFamily(): string {
  return readString(KEYS.fontFamily) || DEFAULTS.fontFamily;
}

export function setTerminalFontFamily(value: string): void {
  writeString(KEYS.fontFamily, value.trim() || DEFAULTS.fontFamily);
}

export function getTerminalLineHeight(): number {
  const raw = Number(readString(KEYS.lineHeight));
  // Migrate the pre-v0.5 default (1.25) — it banded block glyphs.
  if (raw === 1.25) return DEFAULTS.lineHeight;
  if (!Number.isFinite(raw) || raw < 1 || raw > 2) return DEFAULTS.lineHeight;
  return Math.round(raw * 100) / 100;
}

export function setTerminalLineHeight(value: number): void {
  writeString(
    KEYS.lineHeight,
    String(Math.min(2, Math.max(1, Math.round(value * 100) / 100))),
  );
}

export function getTerminalCursorStyle(): CursorStylePref {
  const raw = readString(KEYS.cursorStyle);
  if (raw === "block" || raw === "underline" || raw === "bar") return raw;
  return DEFAULTS.cursorStyle;
}

export function setTerminalCursorStyle(value: CursorStylePref): void {
  writeString(KEYS.cursorStyle, value);
}

export function getTerminalScrollback(): number {
  const raw = Number(readString(KEYS.scrollback));
  if (!Number.isFinite(raw) || raw < 1000 || raw > 100_000) {
    return DEFAULTS.scrollback;
  }
  return Math.round(raw);
}

export function setTerminalScrollback(value: number): void {
  writeString(
    KEYS.scrollback,
    String(Math.min(100_000, Math.max(1000, Math.round(value)))),
  );
}

export function getTerminalBell(): boolean {
  const raw = readString(KEYS.bell);
  if (raw === null || raw === undefined) return DEFAULTS.bell;
  return raw === "1" || raw === "true";
}

export function setTerminalBell(on: boolean): void {
  writeString(KEYS.bell, on ? "1" : "0");
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = readString(key);
  if (raw === null || raw === undefined) return fallback;
  return raw === "1" || raw === "true";
}

export function getNotifyWaiting(): boolean {
  return readBool(KEYS.notifyWaiting, DEFAULTS.notifyWaiting);
}

export function setNotifyWaiting(on: boolean): void {
  writeString(KEYS.notifyWaiting, on ? "1" : "0");
}

export function getNotifyDone(): boolean {
  return readBool(KEYS.notifyDone, DEFAULTS.notifyDone);
}

export function setNotifyDone(on: boolean): void {
  writeString(KEYS.notifyDone, on ? "1" : "0");
}

export function getNotifyFailed(): boolean {
  return readBool(KEYS.notifyFailed, DEFAULTS.notifyFailed);
}

export function setNotifyFailed(on: boolean): void {
  writeString(KEYS.notifyFailed, on ? "1" : "0");
}

export function getDefaultShell(): string {
  return readString(KEYS.defaultShell) ?? DEFAULTS.defaultShell;
}

export function setDefaultShell(value: string): void {
  writeString(KEYS.defaultShell, value);
}

export function getLoginShell(): boolean {
  const raw = readString(KEYS.loginShell);
  if (raw === null || raw === undefined) return DEFAULTS.loginShell;
  return raw !== "0" && raw !== "false";
}

export function setLoginShell(on: boolean): void {
  writeString(KEYS.loginShell, on ? "1" : "0");
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
  setTerminalFontFamily(DEFAULTS.fontFamily);
  setTerminalLineHeight(DEFAULTS.lineHeight);
  setTerminalLigatures(DEFAULTS.ligatures);
  setTerminalCursorBlink(DEFAULTS.cursorBlink);
  setTerminalCursorStyle(DEFAULTS.cursorStyle);
  setTerminalScrollback(DEFAULTS.scrollback);
  setTerminalCopyOnSelect(DEFAULTS.copyOnSelect);
  setTerminalBell(DEFAULTS.bell);
}
