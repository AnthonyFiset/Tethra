import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

interface TerminalRecord {
  terminal: Terminal;
  fit: FitAddon;
  webgl?: WebglAddon;
  resizeTimer?: number;
}

const terminals = new Map<string, TerminalRecord>();
const encoder = new TextEncoder();

export interface TerminalCallbacks {
  onInput: (data: Uint8Array) => void;
  onResize: (cols: number, rows: number) => void;
}

export function createTerminal(
  sessionId: string,
  callbacks: TerminalCallbacks,
): TerminalRecord {
  const existing = terminals.get(sessionId);
  if (existing) return existing;

  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    convertEol: false,
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
  terminal.onData((data) => callbacks.onInput(encoder.encode(data)));
  terminal.onResize(({ cols, rows }) => {
    const record = terminals.get(sessionId);
    if (!record) return;
    window.clearTimeout(record.resizeTimer);
    record.resizeTimer = window.setTimeout(
      () => callbacks.onResize(cols, rows),
      100,
    );
  });

  const record: TerminalRecord = { terminal, fit };
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
    container.replaceChildren(record.terminal.element);
  } else {
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
  terminals.get(sessionId)?.terminal.write(Uint8Array.from(data));
}

export function writeTerminalMessage(sessionId: string, message: string): void {
  terminals.get(sessionId)?.terminal.write(`\r\n${message}\r\n`);
}

export function focusTerminal(sessionId: string): void {
  terminals.get(sessionId)?.terminal.focus();
}

export function disposeTerminal(sessionId: string): void {
  const record = terminals.get(sessionId);
  if (!record) return;
  window.clearTimeout(record.resizeTimer);
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
