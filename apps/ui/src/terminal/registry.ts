import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { readClipboardText, writeClipboardText } from "../lib/ipc";
import {
  getTerminalCopyOnSelect,
  getTerminalCursorBlink,
  getTerminalCursorStyle,
  getTerminalFontFamily,
  getTerminalFontSize,
  getTerminalLigatures,
  getTerminalLineHeight,
  getTerminalScrollback,
} from "../lib/prefs";
import {
  debugBlockState,
  disposeBlockTracker,
  getPhaseLog,
  noteSubmittedCommand,
  recordOpLog,
  flushBlockPhases,
  readActiveShellInputLine,
  refreshActiveBlock,
  notifyTuiChange,
} from "./blocks";
import { scheduleBlockOverlaySync } from "./blockOverlay";
import {
  SCROLLBACK_LINE_CAP,
  loadScrollbackSnapshot,
  saveScrollbackSnapshot,
} from "./scrollback";
import { SyncClearFilter } from "./syncFilter";
import { themeFromAppTokens } from "./theme";
import {
  bindInjectGates,
  looksLikeDeviceReport,
  stripDeviceReports,
} from "./inject";

interface TerminalRecord {
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  serialize: SerializeAddon;
  webgl?: WebglAddon;
  clipboard?: ClipboardAddon;
  unicode11?: Unicode11Addon;
  resizeTimer?: number;
  /** Last OSC 7 working directory, when the shell reports one. */
  cwd?: string;
  /** Last git branch from shell integration (OSC 133;G), when reported. */
  gitBranch?: string;
  /** Strips ED2/ED3 inside DEC 2026 sync blocks (agent TUI scroll-jump). */
  syncFilter: SyncClearFilter;
  /** Full-screen-app signals parsed from the output stream. */
  tui: TuiState;
  disposables: { dispose(): void }[];
}

/**
 * Signals that a full-screen program owns the session. None of them are
 * produced by a shell prompt; all are reset when the shell reports a new
 * prompt (OSC 133 A/D) so a finished TUI hands the screen back.
 *
 * - `sync`: DEC 2026 synchronized output (Claude Code flicker-free, Codex,
 *   ratatui apps). tmux passes it through even with the alt screen disabled.
 * - `mouse`: any xterm mouse-tracking mode (1000–1006).
 * - `cursorHidden`: DECTCEM off. Tracked for diagnostics only — build
 *   tools hide the cursor for progress bars, so it is not a TUI signal.
 * - `agentLaunched`: the app itself started an agent CLI as the session's
 *   command (project launch) — there is no shell and never an OSC 133 mark.
 */
export interface TuiState {
  sync: boolean;
  mouse: boolean;
  cursorHidden: boolean;
  agentLaunched: boolean;
}

function freshTuiState(): TuiState {
  return {
    sync: false,
    mouse: false,
    cursorHidden: false,
    agentLaunched: false,
  };
}

/** Call-time import (registry ↔ blocks are circular; no init-time use). */
function tuiChangeListener(sessionId: string): void {
  notifyTuiChange(sessionId);
}

export function getTuiState(sessionId: string): TuiState | undefined {
  return terminals.get(sessionId)?.tui;
}

/** Shell prompt reported — whatever ran before has given the screen back. */
export function resetTuiState(sessionId: string): void {
  const record = terminals.get(sessionId);
  if (!record) return;
  const t = record.tui;
  if (!t.sync && !t.mouse && !t.cursorHidden) return;
  t.sync = false;
  t.mouse = false;
  t.cursorHidden = false;
  tuiChangeListener(sessionId);
}

/** Project launch started an agent CLI directly (no shell in the session). */
export function markAgentLaunched(sessionId: string, on = true): void {
  const record = terminals.get(sessionId);
  if (!record || record.tui.agentLaunched === on) return;
  record.tui.agentLaunched = on;
  tuiChangeListener(sessionId);
}

const MOUSE_MODES = new Set([1000, 1001, 1002, 1003, 1005, 1006, 1015]);

function flattenModes(params: (number | number[])[]): number[] {
  const out: number[] = [];
  for (const p of params) {
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return out;
}

const terminals = new Map<string, TerminalRecord>();

// QA harness hook: read the live buffer state so Playwright can assert what
// the renderer actually shows (viewport rows, cursor, scroll position).
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__tethraTermDebug = (
    sessionId: string,
  ) => {
    const rec = terminals.get(sessionId);
    if (!rec) return null;
    const t = rec.terminal;
    const buf = t.buffer.active;
    const lines: string[] = [];
    for (let y = buf.viewportY; y < buf.viewportY + t.rows; y++) {
      lines.push(buf.getLine(y)?.translateToString(true) ?? "");
    }
    return {
      viewportY: buf.viewportY,
      baseY: buf.baseY,
      cursorY: buf.cursorY,
      cursorX: buf.cursorX,
      rows: t.rows,
      cols: t.cols,
      length: buf.length,
      lines,
      mirror: readActiveShellInputLine(sessionId),
      blockState: debugBlockState(sessionId),
      phaseLog: getPhaseLog(),
    };
  };
  (window as unknown as Record<string, unknown>).__tethraNoteCmd = (
    sessionId: string,
    cmd: string,
  ) => noteSubmittedCommand(sessionId, cmd);
}
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
  /** Fired when shell integration reports the current git branch. */
  onGitBranch?: (branch: string) => void;
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

/** Blur all open xterms so focus leave/return reports fire under the insert gate. */
export function blurAllTerminals(): void {
  for (const record of terminals.values()) {
    try {
      record.terminal.blur();
    } catch {
      // ignore
    }
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

  // Font metrics must come from Terminal options (not CSS). Reference: 12.5px
  // → ~16px cells at lineHeight 1.25. Re-assert after open/fit — xterm 6's
  // TextMetrics path can measure a fallback face before JetBrains loads.
  const fontSize = getTerminalFontSize();
  const fontFamily = `"${getTerminalFontFamily()}", "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`;
  const lineHeight = getTerminalLineHeight();

  const terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: getTerminalCursorBlink(),
    cursorStyle: getTerminalCursorStyle(),
    convertEol: false,
    // Bracketed paste stays enabled so shells that request it get it.
    ignoreBracketedPasteMode: false,
    // macOS Option sends meta for readline / agent keybindings.
    macOptionIsMeta: true,
    fontFamily,
    fontSize,
    lineHeight,
    letterSpacing: 0,
    scrollback: getTerminalScrollback(),
    // iTerm/Terminal.app–like ED2: push cleared viewport into scrollback instead
    // of nuking it (xterm default). Softens agent full-redraw scroll yanks.
    scrollOnEraseInDisplay: true,
    scrollOnUserInput: true,
    theme: themeFromAppTokens(),
  });
  applyTerminalFont(terminal, fontSize, fontFamily, lineHeight);
  // Dev harness: expose for overlay/font debugging in the browser console.
  if (import.meta.env.VITE_TETHRA_MOCK === "1") {
    (window as unknown as { __tethraTerm?: Terminal }).__tethraTerm = terminal;
  }
  const fit = new FitAddon();
  terminal.loadAddon(fit);

  const unicode11 = new Unicode11Addon();
  terminal.loadAddon(unicode11);
  terminal.unicode.activeVersion = "11";

  const clipboard = new ClipboardAddon();
  terminal.loadAddon(clipboard);

  const serialize = new SerializeAddon();
  terminal.loadAddon(serialize);

  const search = new SearchAddon();
  terminal.loadAddon(search);

  const disposables: { dispose(): void }[] = [];
  disposables.push(
    terminal.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7(data);
      if (!cwd) return false;
      const record = terminals.get(sessionId);
      if (record) record.cwd = cwd;
      inputHandlers.get(sessionId)?.onCwd?.(cwd);
      return false;
    }),
  );
  disposables.push(
    terminal.parser.registerOscHandler(133, (data) => {
      if (!data.startsWith("G;")) return false;
      const branch = data.slice(2).trim();
      if (!branch) return true;
      const record = terminals.get(sessionId);
      if (record) record.gitBranch = branch;
      inputHandlers.get(sessionId)?.onGitBranch?.(branch);
      return true;
    }),
  );

  // DECSET / DECRST: full-screen-app signals. Handlers return false so
  // xterm still applies the mode itself.
  const onDecMode = (set: boolean) => (params: (number | number[])[]) => {
    const record = terminals.get(sessionId);
    if (!record) return false;
    const t = record.tui;
    let changed = false;
    for (const mode of flattenModes(params)) {
      if (mode === 2026) {
        // Begin OR end of a synchronized frame — either proves a TUI.
        if (!t.sync) {
          t.sync = true;
          changed = true;
        }
      } else if (MOUSE_MODES.has(mode)) {
        if (t.mouse !== set) {
          t.mouse = set;
          changed = true;
        }
      } else if (mode === 25) {
        const hidden = !set;
        if (t.cursorHidden !== hidden) {
          t.cursorHidden = hidden;
          changed = true;
        }
      }
    }
    if (changed) tuiChangeListener(sessionId);
    return false;
  };
  disposables.push(
    terminal.parser.registerCsiHandler(
      { prefix: "?", final: "h" },
      onDecMode(true),
    ),
  );
  disposables.push(
    terminal.parser.registerCsiHandler(
      { prefix: "?", final: "l" },
      onDecMode(false),
    ),
  );

  terminal.onData((data) => {
    // Full suppress during UI inject (tools Insert, Assist, block Rerun…).
    if (inputIsSuppressed(sessionId)) return;

    // Always drop pure DA / OSC color replies — never legitimate typing.
    // These fire when the host (or xterm theme) queries cursor/color/DA and
    // xterm answers via onData; bash runs them as `1;2c…rgb:…` commands.
    if (looksLikeDeviceReport(data)) return;

    // Always strip known report sequences even when mixed with real input
    // (ESC forms or ESC-stripped mash glued to typed text).
    const payload = stripDeviceReports(data);
    if (!payload) return;
    if (looksLikeDeviceReport(payload)) return;

    inputHandlers.get(sessionId)?.onInput(encoder.encode(payload));
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
    search,
    serialize,
    clipboard,
    unicode11,
    syncFilter: new SyncClearFilter(),
    tui: freshTuiState(),
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
    // WKWebView (Tauri on macOS) often returns a WebGL context that never
    // paints — black terminal with chrome still drawing. Prefer DOM there;
    // Chromium keeps WebGL when the probe succeeds.
    if (shouldTryWebgl()) {
      try {
        const addon = new WebglAddon();
        record.terminal.loadAddon(addon);
        addon.onContextLoss(() => {
          try {
            addon.dispose();
          } catch {
            // ignore
          }
          record.webgl = undefined;
          fitTerminal(sessionId);
          try {
            record.terminal.refresh(0, record.terminal.rows - 1);
          } catch {
            // ignore
          }
        });
        record.webgl = addon;
      } catch {
        record.webgl = undefined;
      }
    }
  }
  // Wait for JetBrains Mono — but never block paint forever (WKWebView can
  // leave document.fonts.ready pending if a face never resolves).
  void (async () => {
    const size = getTerminalFontSize();
    const family = `"${getTerminalFontFamily()}", "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`;
    const lineHeight = getTerminalLineHeight();
    await waitForTerminalFonts(size, family);
    if (!terminals.has(sessionId)) return;
    // If WebGL left zero-size cells, drop it and let the DOM renderer paint.
    if (record.webgl && !hasUsableCellMetrics(record.terminal)) {
      try {
        record.webgl.dispose();
      } catch {
        // ignore
      }
      record.webgl = undefined;
    }
    applyTerminalFont(record.terminal, size, family, lineHeight);
    // Nudge CharSizeService: option change is the only public remasure trigger.
    record.terminal.options.fontSize = size + 0.001;
    record.terminal.options.fontSize = size;
    fitTerminal(sessionId);
    try {
      record.terminal.refresh(0, record.terminal.rows - 1);
    } catch {
      // ignore
    }
    logTerminalMetrics(sessionId, record.terminal);
    scheduleBlockOverlaySync(sessionId);
  })();
  applyTerminalFont(
    record.terminal,
    getTerminalFontSize(),
    `"${getTerminalFontFamily()}", "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`,
    getTerminalLineHeight(),
  );
  fitTerminal(sessionId);
  try {
    record.terminal.refresh(0, record.terminal.rows - 1);
  } catch {
    // ignore
  }
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
  scheduleBlockOverlaySync(sessionId);
}

/** Serialize PTY writes + OSC 133 marker flushes per session.
 * Block events must apply only after preceding `terminal.write` bytes land;
 * flushing markers while a write is in flight parked them on the wrong row
 * (raw PS1 leaks, ls-output mistaken for commandText). */
const terminalOpTail = new Map<string, Promise<void>>();

function enqueueTerminalOp(sessionId: string, op: () => Promise<void>): void {
  const prev = terminalOpTail.get(sessionId) ?? Promise.resolve();
  const next = prev.then(op, op);
  terminalOpTail.set(sessionId, next);
  void next.finally(() => {
    if (terminalOpTail.get(sessionId) === next) {
      terminalOpTail.delete(sessionId);
    }
  });
}

export function writeTerminal(
  sessionId: string,
  data: number[] | Uint8Array,
): void {
  const record = terminals.get(sessionId);
  if (!record) return;
  const raw = data instanceof Uint8Array ? data : Uint8Array.from(data);
  enqueueTerminalOp(sessionId, () => {
    const current = terminals.get(sessionId);
    if (!current) return Promise.resolve();
    const bytes = current.syncFilter.push(raw);
    if (bytes.length === 0) {
      refreshActiveBlock(sessionId, current.terminal);
      scheduleBlockOverlaySync(sessionId);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (import.meta.env.DEV) {
          const tail = new TextDecoder()
            .decode(bytes.slice(-40))
            .replace(/\u001b/g, "~");
          recordOpLog("W", `${bytes.length}b tail=${JSON.stringify(tail)}`);
        }
        refreshActiveBlock(sessionId, current.terminal);
        scheduleBlockOverlaySync(sessionId);
        resolve();
      };
      current.terminal.write(bytes, done);
      // Safety: never stall the OSC marker queue if xterm skips the callback.
      window.setTimeout(done, 500);
    });
  });
}

/** Apply queued OSC 133 phases after all prior writes for this session. */
export function scheduleFlushBlockPhases(sessionId: string): void {
  enqueueTerminalOp(sessionId, async () => {
    const term = getTerminalInstance(sessionId);
    if (!term) return;
    flushBlockPhases(sessionId, term);
    refreshActiveBlock(sessionId, term);
    scheduleBlockOverlaySync(sessionId);
  });
}

/** Re-apply prefs from localStorage to every live terminal. */
export function applyTerminalPrefs(): void {
  const fontSize = getTerminalFontSize();
  const fontFamily = `"${getTerminalFontFamily()}", "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`;
  const lineHeight = getTerminalLineHeight();
  const cursorBlink = getTerminalCursorBlink();
  const cursorStyle = getTerminalCursorStyle();
  const scrollback = getTerminalScrollback();
  for (const [sessionId, record] of terminals) {
    applyTerminalFont(record.terminal, fontSize, fontFamily, lineHeight);
    record.terminal.options.cursorBlink = cursorBlink;
    record.terminal.options.cursorStyle = cursorStyle;
    record.terminal.options.scrollback = scrollback;
    if (record.terminal.element) {
      try {
        record.fit.fit();
      } catch {
        // hidden
      }
      logTerminalMetrics(sessionId, record.terminal);
    }
  }
}

function applyTerminalFont(
  terminal: Terminal,
  fontSize: number,
  fontFamily: string,
  lineHeight: number,
): void {
  terminal.options.fontSize = fontSize;
  terminal.options.fontFamily = fontFamily;
  terminal.options.lineHeight = lineHeight;
  applyFontFeatures(terminal);
  const el = terminal.element;
  if (el) {
    // Keep the host + helper textarea in lockstep with Terminal options so
    // CharSizeService / WebGL don't inherit a smaller cascade font-size.
    el.style.fontSize = `${fontSize}px`;
    el.style.fontFamily = fontFamily;
    el.style.lineHeight = String(lineHeight);
    const helper = el.querySelector(
      ".xterm-helper-textarea",
    ) as HTMLElement | null;
    if (helper) {
      helper.style.fontSize = `${fontSize}px`;
      helper.style.fontFamily = fontFamily;
      helper.style.lineHeight = `${fontSize * lineHeight}px`;
    }
  }
}

function logTerminalMetrics(sessionId: string, terminal: Terminal): void {
  if (import.meta.env.VITE_TETHRA_MOCK !== "1") return;
  try {
    const core = (
      terminal as unknown as {
        _core?: {
          _renderService?: {
            dimensions?: {
              css?: { cell?: { height?: number; width?: number } };
              device?: { cell?: { height?: number } };
            };
          };
          _charSizeService?: { width?: number; height?: number };
        };
      }
    )._core;
    const dims = core?._renderService?.dimensions;
    const helper = terminal.element?.querySelector(
      ".xterm-helper-textarea",
    ) as HTMLElement | null;
    const helperH = helper?.getBoundingClientRect().height;
    // eslint-disable-next-line no-console
    console.info("[tethra:term-metrics]", {
      sessionId,
      fontSize: terminal.options.fontSize,
      lineHeight: terminal.options.lineHeight,
      charServiceH: core?._charSizeService?.height,
      cssCellH: dims?.css?.cell?.height,
      deviceCellH: dims?.device?.cell?.height,
      helperH,
    });
  } catch {
    // ignore
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

/** Safari / WKWebView (Tauri macOS) — WebGL often initializes then paints black. */
function shouldTryWebgl(): boolean {
  if (typeof window === "undefined") return false;
  // Tauri injects this; prefer DOM renderer on the real app shell.
  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) return false;
  const ua = navigator.userAgent;
  // Apple WebKit without Chromium → WKWebView / Safari.
  if (/AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)) {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    return Boolean(gl);
  } catch {
    return false;
  }
}

function hasUsableCellMetrics(terminal: Terminal): boolean {
  const core = (
    terminal as unknown as {
      _core?: {
        _charSizeService?: { height?: number; width?: number };
        _renderService?: {
          dimensions?: { css?: { cell?: { height?: number } } };
        };
      };
    }
  )._core;
  const charH = core?._charSizeService?.height ?? 0;
  const cellH = core?._renderService?.dimensions?.css?.cell?.height ?? 0;
  return charH > 1 && cellH > 1;
}

const FONT_WAIT_MS = 900;

async function waitForTerminalFonts(
  size: number,
  family: string,
): Promise<void> {
  const load = async () => {
    try {
      await document.fonts.load(`${size}px "JetBrains Mono Variable"`);
      await document.fonts.load(`${size}px ${family}`);
      await document.fonts.ready;
    } catch {
      // ignore — paint with whatever face is available
    }
  };
  await Promise.race([
    load(),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, FONT_WAIT_MS);
    }),
  ]);
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

/** /clear: wipe viewport AND scrollback (shell `clear` keeps scrollback). */
export function clearTerminalViewport(sessionId: string): void {
  const record = terminals.get(sessionId);
  if (!record) return;
  enqueueTerminalOp(sessionId, () => {
    record.terminal.clear();
    scheduleBlockOverlaySync(sessionId);
    return Promise.resolve();
  });
}

export function focusTerminal(sessionId: string): void {
  terminals.get(sessionId)?.terminal.focus();
}

bindInjectGates({
  suppressAll: suppressAllTerminalUserInput,
  armShield: armClickShield,
  blurAll: blurAllTerminals,
  focus: focusTerminal,
});

export function getTerminalCwd(sessionId: string): string | undefined {
  return terminals.get(sessionId)?.cwd;
}

export function getTerminalGitBranch(sessionId: string): string | undefined {
  return terminals.get(sessionId)?.gitBranch;
}

export function getTerminalInstance(sessionId: string): Terminal | undefined {
  return terminals.get(sessionId)?.terminal;
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

export async function copyTerminalSelection(
  sessionId: string,
): Promise<boolean> {
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
  terminalOpTail.delete(sessionId);
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

/** Dev bridge: every live session id (mounted or hidden). */
export function listTerminalSessionIds(): string[] {
  return Array.from(terminals.keys());
}

export function hasTerminal(sessionId: string): boolean {
  return terminals.has(sessionId);
}

const SEARCH_DECORATIONS = {
  matchBackground: "#2c4a75",
  matchBorder: "#3d8ef0",
  matchOverviewRuler: "#3d8ef0",
  activeMatchBackground: "#3d8ef0",
  activeMatchBorder: "#5aa0f5",
  activeMatchColorOverviewRuler: "#5aa0f5",
};

/** Find next match in scrollback. Returns whether a match was selected. */
export function findTerminalNext(
  sessionId: string,
  term: string,
  options?: { caseSensitive?: boolean; incremental?: boolean },
): boolean {
  const record = terminals.get(sessionId);
  if (!record || !term) return false;
  return record.search.findNext(term, {
    caseSensitive: options?.caseSensitive ?? false,
    incremental: options?.incremental ?? false,
    decorations: SEARCH_DECORATIONS,
  });
}

export function findTerminalPrevious(
  sessionId: string,
  term: string,
  options?: { caseSensitive?: boolean },
): boolean {
  const record = terminals.get(sessionId);
  if (!record || !term) return false;
  return record.search.findPrevious(term, {
    caseSensitive: options?.caseSensitive ?? false,
    decorations: SEARCH_DECORATIONS,
  });
}

export function clearTerminalSearch(sessionId: string): void {
  const record = terminals.get(sessionId);
  if (!record) return;
  record.search.clearDecorations();
  record.search.clearActiveDecoration();
}

export function onTerminalSearchResults(
  sessionId: string,
  handler: (resultIndex: number, resultCount: number) => void,
): () => void {
  const record = terminals.get(sessionId);
  if (!record) return () => undefined;
  const d = record.search.onDidChangeResults((event) => {
    handler(event.resultIndex, event.resultCount);
  });
  return () => d.dispose();
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
