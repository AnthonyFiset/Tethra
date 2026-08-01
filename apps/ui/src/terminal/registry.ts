import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

interface TerminalRecord {
  terminal: Terminal;
  fit: FitAddon;
  webgl?: WebglAddon;
  clipboard?: ClipboardAddon;
  unicode11?: Unicode11Addon;
  resizeTimer?: number;
  /** Last OSC 7 working directory, when the shell reports one. */
  cwd?: string;
  disposables: { dispose(): void }[];
}

const terminals = new Map<string, TerminalRecord>();
const encoder = new TextEncoder();
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
    cursorBlink: true,
    cursorStyle: "bar",
    convertEol: false,
    // Bracketed paste stays enabled so shells that request it get it.
    ignoreBracketedPasteMode: false,
    // macOS Option sends meta for readline / agent keybindings.
    macOptionIsMeta: true,
    fontFamily:
      '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 10_000,
    theme: {
      background: "#0d0d0d",
      foreground: "#e8e8e8",
      cursor: "#4c8df6",
      selectionBackground: "#2c4a75",
      black: "#1b1b1b",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#d7dae0",
    },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);

  const unicode11 = new Unicode11Addon();
  terminal.loadAddon(unicode11);
  terminal.unicode.activeVersion = "11";

  const clipboard = new ClipboardAddon();
  terminal.loadAddon(clipboard);

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
    clipboard,
    unicode11,
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
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  record.terminal.write(bytes);
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

export function disposeTerminal(sessionId: string): void {
  const record = terminals.get(sessionId);
  if (!record) return;
  window.clearTimeout(record.resizeTimer);
  inputSuppressedUntil.delete(sessionId);
  inputHandlers.delete(sessionId);
  for (const disposable of record.disposables) {
    disposable.dispose();
  }
  record.clipboard?.dispose();
  record.unicode11?.dispose();
  record.webgl?.dispose();
  record.terminal.dispose();
  terminals.delete(sessionId);
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
