import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { readClipboardText, writeClipboardText } from "../lib/ipc";
import {
  getTerminalCopyOnSelect,
  getTerminalCursorBlink,
  getTerminalFontSize,
  getTerminalLigatures,
} from "../lib/prefs";
import { disposeBlockTracker, flushBlockPhases } from "./blocks";
import {
  SCROLLBACK_LINE_CAP,
  loadScrollbackSnapshot,
  saveScrollbackSnapshot,
} from "./scrollback";
import { SyncClearFilter } from "./syncFilter";
import { themeFromAppTokens } from "./theme";

interface TerminalRecord {
  terminal: Terminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  webgl?: WebglAddon;
  clipboard?: ClipboardAddon;
  unicode11?: Unicode11Addon;
  resizeTimer?: number;
  /** Last OSC 7 working directory, when the shell reports one. */
  cwd?: string;
  /** Strips ED2/ED3 inside DEC 2026 sync blocks (agent TUI scroll-jump). */
  syncFilter: SyncClearFilter;
  disposables: { dispose(): void }[];
}

const terminals = new Map<string, TerminalRecord>();
const encoder = new TextEncoder();
/** Last non-empty selection per session (survives menu-bar focus/selection clear). */
const lastSelections = new Map<string, string>();
/** Drop xterm onData until this timestamp (ms) — blocks dialog click-through junk. */
const inputSuppressedUntil = new Map<string, number>();
/** Global gate — covers every session, including stale onData closures. */
let globalInputSuppressedUntil = 0;
/** Latest callbacks per session so HMR / re-wire updates reach existing terminals. */
const inputHandlers = new Map<string, TerminalCallbacks>();

export interface TerminalCallbacks {
  onInput: (data: Uint8Array) => void;
  onResize: (cols: number, rows: number) => void;
  /** Fired when OSC 7 reports a working directory. */
  onCwd?: (cwd: string) => void;
}

function inputIsSuppressed(sessionId: string): boolean {
  const now = Date.now();
  if (now < globalInputSuppressedUntil) return true;
  return now < (inputSuppressedUntil.get(sessionId) ?? 0);
}

/**
 * Ignore keyboard/mouse data from xterm for a short window.
 * Used when closing modals so the same click cannot inject CSI/OSC into the PTY.
 */
export function suppressTerminalUserInput(
  sessionId: string,
  durationMs = 400,
): void {
  const until = Date.now() + durationMs;
  const prev = inputSuppressedUntil.get(sessionId) ?? 0;
  inputSuppressedUntil.set(sessionId, Math.max(prev, until));
  globalInputSuppressedUntil = Math.max(globalInputSuppressedUntil, until);
}

/** Suppress every live terminal (and arm the global gate). */
export function suppressAllTerminalUserInput(durationMs = 800): void {
  const until = Date.now() + durationMs;
  globalInputSuppressedUntil = Math.max(globalInputSuppressedUntil, until);
  for (const id of terminals.keys()) {
    const prev = inputSuppressedUntil.get(id) ?? 0;
    inputSuppressedUntil.set(id, Math.max(prev, until));
  }
}

/**
 * Full-screen pointer shield so dialog close click-through cannot hit xterm.
 */
export function armClickShield(durationMs = 400): void {
  const existing = document.querySelector("[data-tethra-click-shield]");
  existing?.remove();
  const el = document.createElement("div");
  el.setAttribute("data-tethra-click-shield", "");
  el.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:default;";
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  el.addEventListener("pointerdown", stop, true);
  el.addEventListener("pointerup", stop, true);
  el.addEventListener("click", stop, true);
  el.addEventListener("mousedown", stop, true);
  el.addEventListener("mouseup", stop, true);
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), durationMs);
}

export function createTerminal(
  sessionId: string,
  callbacks: TerminalCallbacks,
): TerminalRecord {
  inputHandlers.set(sessionId, callbacks);
  const existing = terminals.get(sessionId);
  if (existing) return existing;

  const terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: getTerminalCursorBlink(),
    cursorStyle: "bar",
    convertEol: false,
    // Bracketed paste stays enabled so shells that request it get it.
    ignoreBracketedPasteMode: false,
    // macOS Option sends meta for readline / agent keybindings.
    macOptionIsMeta: true,
    fontFamily:
      '"JetBrains Mono Variable", "JetBrains Mono", "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
    fontSize: getTerminalFontSize(),
    lineHeight: 1.25,
    letterSpacing: 0,
    scrollback: 10_000,
    // iTerm/Terminal.app–like ED2: push cleared viewport into scrollback instead
    // of nuking it (xterm default). Softens agent full-redraw scroll yanks.
    scrollOnEraseInDisplay: true,
    scrollOnUserInput: true,
    theme: themeFromAppTokens(),
  });
  applyFontFeatures(terminal);
  const fit = new FitAddon();
  terminal.loadAddon(fit);

  const unicode11 = new Unicode11Addon();
  terminal.loadAddon(unicode11);
  terminal.unicode.activeVersion = "11";

  const clipboard = new ClipboardAddon();
  terminal.loadAddon(clipboard);

  const serialize = new SerializeAddon();
  terminal.loadAddon(serialize);

  const disposables: { dispose(): void }[] = [];
  disposables.push(
    terminal.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7(data);
      if (!cwd) return false;
      const record = terminals.get(sessionId);
      if (record) record.cwd = cwd;
      inputHandlers.get(sessionId)?.onCwd?.(cwd);
      return false; // let xterm keep its own handling if any
    }),
  );

  terminal.onData((data) => {
    if (inputIsSuppressed(sessionId)) return;
    inputHandlers.get(sessionId)?.onInput(encoder.encode(data));
  });
  terminal.onSelectionChange(() => {
    const text = terminal.getSelection();
    // Keep last non-empty selection — macOS menu-bar clicks clear xterm
    // selection before Edit→Copy runs.
    if (text) lastSelections.set(sessionId, text);
    if (!getTerminalCopyOnSelect()) return;
    if (text) void writeClipboardText(text);
  });
  terminal.onResize(({ cols, rows }) => {
    const record = terminals.get(sessionId);
    if (!record) return;
    window.clearTimeout(record.resizeTimer);
    record.resizeTimer = window.setTimeout(() => {
      inputHandlers.get(sessionId)?.onResize(cols, rows);
    }, 100);
  });

  const record: TerminalRecord = {
    terminal,
    fit,
    serialize,
    clipboard,
    unicode11,
    syncFilter: new SyncClearFilter(),
    disposables,
  };
  terminals.set(sessionId, record);
  return record;
}

export function attachTerminal(
  sessionId: string,
  container: HTMLElement,
): void {
  const record = terminals.get(sessionId);
  if (!record) return;

  if (record.terminal.element) {
    // Move the existing xterm host into this pane; drop any leftover siblings
    // from a previous session that shared the container without a remount.
    if (
      record.terminal.element.parentElement !== container ||
      container.childElementCount !== 1
    ) {
      container.replaceChildren(record.terminal.element);
    }
  } else {
    container.replaceChildren();
    record.terminal.open(container);
    applyFontFeatures(record.terminal);
    try {
      record.webgl = new WebglAddon();
      record.terminal.loadAddon(record.webgl);
      record.webgl.onContextLoss(() => {
        record.webgl?.dispose();
        record.webgl = undefined;
      });
    } catch {
      // xterm's DOM/canvas renderer remains active as the required fallback.
    }
  }
  fitTerminal(sessionId);
  record.terminal.focus();
}

export function fitTerminal(sessionId: string): void {
  const record = terminals.get(sessionId);
  if (!record?.terminal.element) return;
  try {
    record.fit.fit();
  } catch {
    // The tab may be hidden or between layout passes.
  }
}

export function writeTerminal(
  sessionId: string,
  data: number[] | Uint8Array,
): void {
  const record = terminals.get(sessionId);
  if (!record) return;
  const raw = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const bytes = record.syncFilter.push(raw);
  if (bytes.length === 0) {
    flushBlockPhases(sessionId, record.terminal);
    return;
  }
  record.terminal.write(bytes, () => {
    flushBlockPhases(sessionId, record.terminal);
  });
}

/** Re-apply prefs from localStorage to every live terminal. */
export function applyTerminalPrefs(): void {
  const fontSize = getTerminalFontSize();
  const cursorBlink = getTerminalCursorBlink();
  for (const record of terminals.values()) {
    record.terminal.options.fontSize = fontSize;
    record.terminal.options.cursorBlink = cursorBlink;
    applyFontFeatures(record.terminal);
    if (record.terminal.element) {
      try {
        record.fit.fit();
      } catch {
        // hidden
      }
    }
  }
}

function applyFontFeatures(terminal: Terminal): void {
  const ligatures = getTerminalLigatures();
  // xterm has no first-class ligature flag — use CSS on the host element when open.
  const el = terminal.element;
  if (el) {
    el.style.fontVariantLigatures = ligatures ? "common-ligatures" : "none";
  }
}

/** Re-apply the app token theme (e.g. after future theme switches). */
export function refreshTerminalTheme(sessionId?: string): void {
  const theme = themeFromAppTokens();
  if (sessionId) {
    const record = terminals.get(sessionId);
    if (record) record.terminal.options.theme = theme;
    return;
  }
  for (const record of terminals.values()) {
    record.terminal.options.theme = theme;
  }
}

export function writeTerminalMessage(sessionId: string, message: string): void {
  terminals.get(sessionId)?.terminal.write(`\r\n${message}\r\n`);
}

export function focusTerminal(sessionId: string): void {
  terminals.get(sessionId)?.terminal.focus();
}

export function getTerminalCwd(sessionId: string): string | undefined {
  return terminals.get(sessionId)?.cwd;
}

export function clearTerminal(sessionId: string): void {
  terminals.get(sessionId)?.terminal.clear();
}

export function resetTerminal(sessionId: string): void {
  terminals.get(sessionId)?.terminal.reset();
}

export function getTerminalSelection(sessionId: string): string {
  return terminals.get(sessionId)?.terminal.getSelection() ?? "";
}

/** Live selection, or last non-empty selection if the menu bar cleared it. */
export function getTerminalSelectionForCopy(sessionId: string): string {
  const live = getTerminalSelection(sessionId);
  if (live) return live;
  return lastSelections.get(sessionId) ?? "";
}

export async function copyTerminalSelection(sessionId: string): Promise<boolean> {
  const text = getTerminalSelectionForCopy(sessionId);
  if (!text) return false;
  return writeClipboardText(text);
}

export function disposeTerminal(sessionId: string): void {
  const record = terminals.get(sessionId);
  if (!record) return;
  window.clearTimeout(record.resizeTimer);
  inputSuppressedUntil.delete(sessionId);
  inputHandlers.delete(sessionId);
  lastSelections.delete(sessionId);
  disposeBlockTracker(sessionId);
  record.syncFilter.reset();
  for (const disposable of record.disposables) {
    disposable.dispose();
  }
  record.serialize.dispose();
  record.clipboard?.dispose();
  record.unicode11?.dispose();
  record.webgl?.dispose();
  record.terminal.dispose();
  terminals.delete(sessionId);
}

/**
 * Snapshot scrollback for a project before disposing the UI terminal.
 * Call while the terminal still exists.
 */
export async function persistProjectScrollback(
  sessionId: string,
  projectId: string,
): Promise<void> {
  const record = terminals.get(sessionId);
  if (!record || !projectId) return;
  try {
    const data = record.serialize.serialize({
      scrollback: SCROLLBACK_LINE_CAP,
      excludeAltBuffer: true,
    });
    if (data.trim()) {
      await saveScrollbackSnapshot(projectId, data);
    }
  } catch {
    // Serialize can throw if the buffer is in a weird state — ignore.
  }
}

/**
 * Restore a prior project snapshot into a freshly created terminal.
 * Best before the first attach/open paint when possible; still works after.
 */
export async function restoreProjectScrollback(
  sessionId: string,
  projectId: string,
): Promise<boolean> {
  const record = terminals.get(sessionId);
  if (!record || !projectId) return false;
  const data = await loadScrollbackSnapshot(projectId);
  if (!data?.trim()) return false;
  return await new Promise<boolean>((resolve) => {
    try {
      record.terminal.write(data, () => resolve(true));
    } catch {
      resolve(false);
    }
  });
}

export function disposeAllTerminals(): void {
  for (const sessionId of [...terminals.keys()]) {
    disposeTerminal(sessionId);
  }
}

export function hasTerminal(sessionId: string): boolean {
  return terminals.has(sessionId);
}

/** Parse OSC 7 bodies like `file://hostname/path` or plain paths. */
function parseOsc7(data: string): string | undefined {
  const trimmed = data.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed);
      let path = decodeURIComponent(url.pathname);
      // Windows file URLs may look like /C:/Users/...
      if (/^\/[A-Za-z]:\//.test(path)) {
        path = path.slice(1);
      }
      return path || undefined;
    } catch {
      const slash = trimmed.indexOf("/", "file://".length);
      if (slash === -1) return undefined;
      try {
        return decodeURIComponent(trimmed.slice(slash)) || undefined;
      } catch {
        return trimmed.slice(slash) || undefined;
      }
    }
  }
  return trimmed;
}
