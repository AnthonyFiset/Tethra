/**
 * Inject shell text into a live terminal without dialog/focus junk.
 *
 * UI buttons that insert (tools hint, Assist, block rerun) must use this —
 * not raw `sendTerminalInput` / xterm paste. Click/focus races produce xterm
 * DA and OSC 10/11 color report replies that bash treats as typed input:
 *   `1;2c0;276;0c10;rgb:e8e8/e8e8/e8e811;rgb:0d0d/0d0d/0d0dnpm install …`
 *
 * Paste (⌘V / context menu / Edit→Paste) also routes here with
 * `{ clearLine: false }`. That path must NOT arm blur/suppress — doing so
 * stole focus and dropped the next Enter for ~2.5s (v0.2.10 regression).
 */

import { sendTerminalInput, suppressPtyUserInput } from "../lib/ipc";

const encoder = new TextEncoder();

/** xterm OSC 10/11/12 color payload: rgb:rrrr/gggg/bbbb (1–4 hex digits each). */
const RGB = "rgb:[0-9a-fA-F]{1,4}/[0-9a-fA-F]{1,4}/[0-9a-fA-F]{1,4}";
const OSC_RGB = new RegExp(`\\u001b\\]1[012];${RGB}(?:\\u0007|\\u001b\\\\)?`, "g");
const BARE_OSC_RGB = new RegExp(`1[012];${RGB}`, "g");
/** CSI DA / DA secondary and their ESC-stripped leftovers. */
const CSI_DA = /\u001b\[\??[\d;]*c/g;
const CSI_DA_SEC = /\u001b\[>[\d;]*c/g;
const BARE_DA = /(?:\?[\d;]*c|>[\d;]*c|(?:\d+;){1,8}\d*c)+/g;

/** Drop pure device-report onData for a window after UI inject. */
let dropDeviceReportsUntil = 0;

/** Module-level suppress + shield live in registry; avoid circular import. */
type Gates = {
  suppressAll: (ms: number) => void;
  armShield: (ms: number) => void;
  blurAll?: () => void;
  focus?: (sessionId: string) => void;
};

let gates: Gates | null = null;

/** Called once from registry so inject can arm the xterm onData gate. */
export function bindInjectGates(next: Gates): void {
  gates = next;
}

export function deviceReportDropActive(): boolean {
  return Date.now() < dropDeviceReportsUntil;
}

/**
 * Strip Primary/Secondary DA and OSC 10–12 rgb color replies (xterm → PTY).
 * Safe to run on mixed user text: only known report shapes are removed.
 */
export function stripDeviceReports(data: string): string {
  return (
    data
      .replace(CSI_DA, "")
      .replace(CSI_DA_SEC, "")
      .replace(OSC_RGB, "")
      // ESC-stripped mash: 1;2c0;276;0c10;rgb:e8e8/e8e8/e8e811;rgb:0d0d/…
      .replace(BARE_DA, "")
      .replace(BARE_OSC_RGB, "")
      .replace(/\u0007/g, "")
  );
}

/**
 * True when this chunk is only terminal device reports — DA replies and
 * OSC 10–12 color query responses — not user typing.
 *
 * Important: Enter (`\r`), Tab, Ctrl-C, and other lone C0 keystrokes must
 * never match. Stripping whitespace/C0 from `\r` leaves `""`, which used to
 * be treated as a report and silently dropped Enter.
 */
export function looksLikeDeviceReport(data: string): boolean {
  if (!data) return false;

  const withoutReports = stripDeviceReports(data);
  // Nothing report-shaped was removed — whatever remains (Enter, letters, …)
  // is user input even if it has no printable characters.
  if (withoutReports === data) return false;

  const rest = withoutReports.replace(/[\s\u0000-\u001f\u007f]/g, "");
  if (rest.length === 0) return true;
  // Tiny leftover residue that is still not a shell command
  if (rest.length <= 8 && /^[\d;c?>/]+$/.test(rest)) return true;
  return false;
}

/**
 * Keep only what a human would type into a shell: strip CSI/OSC/C0,
 * preserve newlines and ordinary printable text (incl. tabs).
 */
export function sanitizeShellPayload(text: string): string {
  return stripDeviceReports(
    text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // CSI + common private modes
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // OSC (BEL or ST terminated)
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
      // Other ESC sequences
      .replace(/\u001b[PX^_][^\u001b]*\u001b\\/g, "")
      .replace(/\u001b./g, "")
      // leftover C0 except TAB/LF
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""),
  );
}

/**
 * Wrap multi-line payloads in bracketed-paste markers so the shell treats
 * embedded newlines as literal input instead of submitting each line.
 * Applied after sanitize (which strips foreign ESC sequences).
 */
export function withBracketedPaste(text: string): string {
  if (!text.includes("\n")) return text;
  return `\u001b[200~${text}\u001b[201~`;
}

export interface InjectShellOptions {
  /** Append Enter after the text. */
  run?: boolean;
  /**
   * Send Ctrl-U first so a polluted prompt (device reports, half-typed junk)
   * is cleared before the command. Default true for insert buttons.
   * Paste passes false.
   */
  clearLine?: boolean;
  /**
   * Arm blur / onData suppress / click shield. Default: same as clearLine
   * (on for insert, off for paste). Paste must not blur or suppress Enter.
   */
  armGates?: boolean;
  /** How long to suppress xterm onData + IPC input after gated inject. */
  suppressMs?: number;
}

function armGates(suppressMs: number): void {
  suppressPtyUserInput(suppressMs);
  gates?.suppressAll(suppressMs);
  // Keep the full-screen click shield for most of the suppress window so
  // dialog close cannot click-through into xterm and re-fire DA replies.
  gates?.armShield(Math.min(1200, suppressMs));
  gates?.blurAll?.();
  dropDeviceReportsUntil = Math.max(
    dropDeviceReportsUntil,
    Date.now() + suppressMs,
  );
}

function forceInput(sessionId: string, payload: string): Promise<void> {
  return sendTerminalInput(sessionId, encoder.encode(payload), { force: true });
}

/**
 * Single entry point for every "type this into the terminal" UI action.
 * Insert buttons should call {@link armShellInjectGate} on pointerdown.
 * Paste should use `{ clearLine: false }` and never arm gates.
 */
export function injectShellText(
  sessionId: string,
  text: string,
  options: InjectShellOptions = {},
): void {
  const clean = sanitizeShellPayload(text).replace(/^\n+|\n+$/g, "");
  if (!clean) return;

  const clearLine = options.clearLine !== false;
  const useGates = options.armGates ?? clearLine;
  const suppressMs = options.suppressMs ?? 2500;
  const run = options.run === true;
  const payload = withBracketedPaste(clean);
  const body = `${payload}${run ? "\n" : ""}`;

  if (!useGates) {
    // Paste / soft inject: do not blur or suppress keyboard. Always-on
    // device-report filtering in registry still strips DA/OSC replies.
    void forceInput(sessionId, body).finally(() => {
      gates?.focus?.(sessionId);
    });
    return;
  }

  armGates(suppressMs);

  // Wait for dialog teardown + any pending xterm focus/DA work, then clear and
  // inject. Gates stay armed the whole time so replies never reach the PTY.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      armGates(suppressMs);

      const deliver = async (): Promise<void> => {
        // Kill whatever is on the bash edit buffer before the command.
        await forceInput(sessionId, "\u0015");
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 50);
        });
        armGates(Math.max(800, suppressMs - 300));
        // Second Ctrl-U: anything that landed in the gap dies too.
        await forceInput(sessionId, `\u0015${body}`);
        // Hold gates after inject so post-insert focus reports die too.
        armGates(Math.max(600, Math.min(suppressMs, 1200)));
        gates?.focus?.(sessionId);
      };

      void deliver();
    });
  });
}

/** Arm suppression early (button pointerdown) before the click handler. */
export function armShellInjectGate(durationMs = 2500): void {
  armGates(durationMs);
}
