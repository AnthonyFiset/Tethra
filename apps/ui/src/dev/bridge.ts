/**
 * Dev-only automation bridge for the REAL app (Tauri / WKWebView).
 *
 * The mock harness (`dev:web`) cannot exercise tmux, PTYs, WKWebView paint
 * or native chrome — every regression that shipped through it was invisible
 * there. This bridge lets `scripts/app-drive.mjs` evaluate JS inside the
 * live window and read back terminal buffers, overlay DOM, block state.
 *
 * Transport: plain HTTP long-poll against 127.0.0.1 (no deps, no CSP
 * changes). Compiled out of production builds (`import.meta.env.DEV`).
 */
import {
  getTerminalInstance,
  listTerminalSessionIds,
} from "../terminal/registry";
import {
  debugBlockState,
  getBlockChromeSnapshot,
  sessionScreenApp,
} from "../terminal/blocks";

const PORT = 47811;
const BASE = `http://127.0.0.1:${PORT}`;

type Job = { id: string; js: string };

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_k, v: unknown) => {
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "function") return `[fn ${v.name}]`;
      if (v && typeof v === "object") {
        if (seen.has(v)) return "[cycle]";
        seen.add(v);
        if (v instanceof Element) {
          return { tag: v.tagName, cls: v.className, text: v.textContent };
        }
      }
      return v;
    },
    0,
  );
}

/** Snapshot of one terminal: viewport rows + geometry + block chrome. */
function termSnapshot(sessionId: string, opts?: { scrollback?: number }) {
  const t = getTerminalInstance(sessionId);
  if (!t) return null;
  const buf = t.buffer.active;
  const rows: string[] = [];
  for (let y = buf.viewportY; y < buf.viewportY + t.rows; y++) {
    rows.push(buf.getLine(y)?.translateToString(true) ?? "");
  }
  const back = Math.max(0, opts?.scrollback ?? 0);
  const scrollback: string[] = [];
  for (let y = Math.max(0, buf.viewportY - back); y < buf.viewportY; y++) {
    scrollback.push(buf.getLine(y)?.translateToString(true) ?? "");
  }
  const overlay = Array.from(
    document.querySelectorAll(".tethra-block-overlay-root > *"),
  ).map((el) => ({
    cls: (el as HTMLElement).className,
    top: (el as HTMLElement).style.top,
    height: (el as HTMLElement).style.height,
    text: (el.textContent ?? "").slice(0, 120),
  }));
  return {
    sessionId,
    cols: t.cols,
    rows: t.rows,
    bufferType: buf.type,
    baseY: buf.baseY,
    viewportY: buf.viewportY,
    length: buf.length,
    cursor: { x: buf.cursorX, y: buf.cursorY },
    atBottom: buf.viewportY === buf.baseY,
    viewport: rows,
    scrollback,
    overlay,
    blocks: debugBlockState(sessionId),
    snapshot: getBlockChromeSnapshot(sessionId),
  };
}

async function runJob(job: Job): Promise<{ ok: boolean; value: string }> {
  try {
    const fn = new Function(
      "dev",
      `return (async () => {\n${job.js}\n})()`,
    ) as (dev: unknown) => Promise<unknown>;
    const value = await fn(devApi);
    return { ok: true, value: safeJson(value === undefined ? null : value) };
  } catch (error) {
    return {
      ok: false,
      value:
        error instanceof Error
          ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
          : String(error),
    };
  }
}

const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Tab: 9,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  Delete: 46,
  PageUp: 33,
  PageDown: 34,
  " ": 32,
};

const consoleLog: { level: string; text: string; at: number }[] = [];

const devApi = {
  sessions: () => listTerminalSessionIds(),
  term: getTerminalInstance,
  snapshot: termSnapshot,
  blocks: debugBlockState,
  chrome: getBlockChromeSnapshot,
  /**
   * Dispatch a keyboard event the way a user keypress reaches the app —
   * to the focused element, with keyCode set (xterm keys off keyCode for
   * Enter/arrows; the prompt panel keys off `key`).
   */
  key: (key: string, init: KeyboardEventInit = {}) => {
    const target = (document.activeElement as HTMLElement | null) ?? window;
    const keyCode =
      KEY_CODES[key] ??
      (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const ev = new KeyboardEvent("keydown", {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      ...init,
    } as KeyboardEventInit);
    return target.dispatchEvent(ev);
  },
  /** Console errors/warnings since the bridge started (newest last). */
  console: () => consoleLog.slice(-200),
  clearConsole: () => {
    consoleLog.length = 0;
  },
  screenApp: (sessionId: string) => sessionScreenApp(sessionId),
  type: (text: string) => {
    for (const ch of text) devApi.key(ch);
  },
  click: (selector: string) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error(`no element for ${selector}`);
    el.click();
    return true;
  },
  /** Find a clickable element by its visible text. */
  clickText: (text: string, root: ParentNode = document) => {
    const candidates = Array.from(
      root.querySelectorAll("button, a, [role='button'], [role='menuitem']"),
    ) as HTMLElement[];
    const hit = candidates.find((el) =>
      (el.textContent ?? "").trim().includes(text),
    );
    if (!hit) throw new Error(`no clickable element containing "${text}"`);
    hit.click();
    return true;
  },
  layout: () => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { sel, x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      window: { w: window.innerWidth, h: window.innerHeight },
      terminal: pick("[data-terminal-surface]"),
      xtermScreen: pick(".xterm-screen"),
      promptPanel: pick("textarea[placeholder]"),
      activeElement: (document.activeElement as HTMLElement | null)?.tagName,
    };
  },
};

let started = false;

export function startDevBridge(): void {
  if (started || !import.meta.env.DEV) return;
  started = true;
  (window as unknown as { __tethraDev?: unknown }).__tethraDev = devApi;
  // Only the REAL app polls the driver. dev:web pages get `__tethraDev`
  // for console/Playwright use but must not steal jobs meant for Tauri —
  // both polling the same port made a mock tab answer real-app commands.
  if (!("__TAURI_INTERNALS__" in window)) return;
  for (const level of ["error", "warn"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      consoleLog.push({
        level,
        text: args
          .map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a)))
          .join(" ")
          .slice(0, 500),
        at: Date.now(),
      });
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => {
    consoleLog.push({
      level: "uncaught",
      text: String(e.message),
      at: Date.now(),
    });
  });

  let backoff = 1000;
  const loop = async (): Promise<void> => {
    for (;;) {
      try {
        const res = await fetch(`${BASE}/poll`, { cache: "no-store" });
        if (res.status === 200) {
          const job = (await res.json()) as Job;
          const result = await runJob(job);
          await fetch(`${BASE}/result`, {
            method: "POST",
            // text/plain: no CORS preflight against the local driver.
            headers: { "content-type": "text/plain" },
            body: JSON.stringify({ id: job.id, ...result }),
          });
          backoff = 1000;
          continue;
        }
        if (res.status === 204) {
          backoff = 1000;
          continue;
        }
      } catch {
        // driver not running — quiet retry
      }
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 8000);
    }
  };
  void loop();
}
