import type { Terminal } from "@xterm/xterm";
import { writeClipboardText } from "../lib/ipc";
import { armShellInjectGate } from "./inject";
import type { BlockChromeSnapshot, BlockChromeEntry } from "./blocks";
import { getBlockChromeSnapshot } from "./blocks";
import {
  BLOCK_COLORS,
  formatBlockTime,
  formatDuration,
  shortenPath,
} from "./blockChrome";

interface OverlayHost {
  root: HTMLElement;
  terminal: Terminal;
  disposables: { dispose(): void }[];
}

const hosts = new Map<string, OverlayHost>();
const pendingSync = new Map<string, number>();

/** Reserve right edge for ⋮ menu column — timestamps stop here. */
const MENU_COLUMN_WIDTH = 34;
/** Gap between last block text row and the waiting banner. */
const BANNER_GAP = 4;

export function setBlockOverlayHost(
  sessionId: string,
  root: HTMLElement | null,
  terminal: Terminal | null,
): void {
  disposeBlockOverlay(sessionId);
  if (!root || !terminal) return;

  const disposables: { dispose(): void }[] = [];
  disposables.push(terminal.onScroll(() => scheduleBlockOverlaySync(sessionId)));
  disposables.push(terminal.onResize(() => scheduleBlockOverlaySync(sessionId)));
  disposables.push(terminal.onRender(() => scheduleBlockOverlaySync(sessionId)));

  hosts.set(sessionId, { root, terminal, disposables });
  scheduleBlockOverlaySync(sessionId);
}

export function scheduleBlockOverlaySync(sessionId: string): void {
  if (!hosts.has(sessionId)) return;
  const pending = pendingSync.get(sessionId);
  if (pending != null) cancelAnimationFrame(pending);
  pendingSync.set(
    sessionId,
    requestAnimationFrame(() => {
      pendingSync.delete(sessionId);
      syncBlockOverlay(sessionId);
    }),
  );
}

export function disposeBlockOverlay(sessionId: string): void {
  const pending = pendingSync.get(sessionId);
  if (pending != null) cancelAnimationFrame(pending);
  pendingSync.delete(sessionId);
  const host = hosts.get(sessionId);
  if (host) {
    for (const d of host.disposables) d.dispose();
    host.root.replaceChildren();
  }
  hosts.delete(sessionId);
}

/** Actual rendered cell height from xterm (never a CSS constant). */
function measureCellHeight(terminal: Terminal): number {
  // xterm 6 + WebGL: no .xterm-rows — the helper textarea is sized to one cell.
  const helper = terminal.element?.querySelector(
    ".xterm-helper-textarea",
  ) as HTMLElement | null;
  if (helper) {
    const h = helper.getBoundingClientRect().height;
    if (h > 0) return h;
  }

  const core = (
    terminal as unknown as {
      _core?: {
        _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } };
      };
    }
  )._core;
  const fromCore = core?._renderService?.dimensions?.css?.cell?.height;
  if (typeof fromCore === "number" && fromCore > 0) return fromCore;

  if (terminal.rows > 0) {
    const screen = terminal.element?.querySelector(
      ".xterm-screen",
    ) as HTMLElement | null;
    const screenH = screen?.getBoundingClientRect().height ?? 0;
    if (screenH > 0) return screenH / terminal.rows;
  }

  return terminal.options.fontSize! * (terminal.options.lineHeight ?? 1);
}

/**
 * Map a buffer line to overlay-root coordinates.
 * Origin is .xterm-screen's top (where glyphs paint); row pitch is the live cell height.
 */
function lineRect(
  terminal: Terminal,
  root: HTMLElement,
  bufferLine: number,
): { top: number; height: number; left: number; width: number } | null {
  const buffer = terminal.buffer.active;
  const rel = bufferLine - buffer.viewportY;
  if (rel < 0 || rel >= terminal.rows) return null;

  const rootRect = root.getBoundingClientRect();
  const cellH = measureCellHeight(terminal);

  // Prefer live DOM row when present (DOM renderer).
  const rows = terminal.element?.querySelector(".xterm-rows");
  const row = rows?.children.item(rel) as HTMLElement | null;
  if (row) {
    const rowRect = row.getBoundingClientRect();
    if (rowRect.height > 0) {
      return {
        top: rowRect.top - rootRect.top,
        height: rowRect.height,
        left: rowRect.left - rootRect.left,
        width: rowRect.width,
      };
    }
  }

  // WebGL (xterm 6): no .xterm-rows — screen origin + viewport-relative pitch.
  const screen = terminal.element?.querySelector(
    ".xterm-screen",
  ) as HTMLElement | null;
  if (!screen) return null;
  const screenRect = screen.getBoundingClientRect();
  return {
    top: screenRect.top - rootRect.top + rel * cellH,
    height: cellH,
    left: screenRect.left - rootRect.left,
    width: screenRect.width,
  };
}

/** Frame from prompt row through block end, clamped to visible rows. */
function clampedFrame(
  terminal: Terminal,
  root: HTMLElement,
  promptLine: number,
  endLine: number,
): { top: number; height: number; left: number; width: number } | null {
  const buffer = terminal.buffer.active;
  const viewportStart = buffer.viewportY;
  const viewportEnd = buffer.viewportY + terminal.rows - 1;
  if (endLine < viewportStart || promptLine > viewportEnd) return null;

  const startLine = Math.max(promptLine, viewportStart);
  const endClamped = Math.min(endLine, viewportEnd);
  const start = lineRect(terminal, root, startLine);
  const end = lineRect(terminal, root, endClamped);
  if (!start || !end) return null;
  return {
    top: start.top,
    height: end.top + end.height - start.top,
    left: start.left,
    width: start.width,
  };
}

function syncBlockOverlay(sessionId: string): void {
  const host = hosts.get(sessionId);
  const snapshot = getBlockChromeSnapshot(sessionId);
  if (!host || !snapshot) {
    host?.root.replaceChildren();
    return;
  }

  const { root, terminal } = host;
  root.replaceChildren();

  for (const block of snapshot.blocks) {
    renderBlock(root, terminal, block, snapshot);
  }
}

function applyHorizontal(
  el: HTMLElement,
  left: number,
  width: number,
): void {
  el.style.left = `${left}px`;
  el.style.width = `${width}px`;
  el.style.right = "auto";
}

/** Last buffer line in [promptLine, endLine] that still has visible text. */
function lastContentLine(
  terminal: Terminal,
  promptLine: number,
  endLine: number,
): number {
  const buf = terminal.buffer.active;
  for (let y = endLine; y >= promptLine; y--) {
    const text = buf.getLine(y)?.translateToString(true).trim() ?? "";
    if (text) return y;
  }
  return endLine;
}

function renderBlock(
  root: HTMLElement,
  terminal: Terminal,
  block: BlockChromeEntry,
  snapshot: BlockChromeSnapshot,
): void {
  const prompt = lineRect(terminal, root, block.promptLine);
  // Header only when the OSC 133;A prompt row is on screen.
  if (!prompt) return;

  const bounds = clampedFrame(
    terminal,
    root,
    block.promptLine,
    block.endLine,
  );

  const failed = block.exitCode !== null && block.exitCode !== 0;
  const isActive = block.kind === "active";
  const railColor = isActive
    ? BLOCK_COLORS.accent
    : failed
      ? BLOCK_COLORS.fail
      : BLOCK_COLORS.ok;
  const railOpacity = isActive ? "1" : failed ? "0.7" : "0.55";

  // Opaque headers replace the prompt row. Only do that when we have a
  // command to show — otherwise idle/empty prompts look like a black terminal
  // (WKWebView DOM glyphs are under the #0d0d0d header).
  const hasCommand = Boolean(block.commandText.trim());
  const coverPrompt = hasCommand;

  if (bounds) {
    const frame = document.createElement("div");
    frame.className = isActive
      ? "tethra-block-overlay-frame tethra-block-overlay-active"
      : failed
        ? "tethra-block-overlay-frame tethra-block-overlay-failed"
        : "tethra-block-overlay-frame tethra-block-overlay-ok";
    // Frame hugs the text column but stops before the ⋮; outline-offset
    // (CSS) puts the blue stroke in the gutter outside the box.
    const frameLeft = bounds.left;
    const frameRightPad = MENU_COLUMN_WIDTH + 4;
    const frameWidth = Math.max(
      48,
      bounds.width - frameRightPad,
    );
    frame.style.top = `${bounds.top}px`;
    frame.style.height = `${bounds.height}px`;
    applyHorizontal(frame, frameLeft, frameWidth);

    const rail = document.createElement("div");
    rail.className = "tethra-block-overlay-rail";
    rail.style.background = railColor;
    rail.style.opacity = railOpacity;
    frame.appendChild(rail);
    root.appendChild(frame);
  }

  if (coverPrompt) {
    const header = buildHeader(block, isActive);
    header.style.top = `${prompt.top}px`;
    header.style.height = `${prompt.height}px`;
    applyHorizontal(header, prompt.left, prompt.width);
    root.appendChild(header);
  }

  const menu = buildMenuButton(block, snapshot);
  menu.style.top = `${prompt.top + Math.max(0, (prompt.height - 24) / 2)}px`;
  menu.style.left = "auto";
  menu.style.right = `${Math.max(6, root.clientWidth - prompt.left - prompt.width + 6)}px`;
  root.appendChild(menu);

  if (isActive && snapshot.context.waiting) {
    // Sit strictly below the last text row. Near the viewport bottom, use a
    // compact banner so Review stays on-screen without covering glyphs.
    const contentLine = lastContentLine(
      terminal,
      block.promptLine,
      block.endLine,
    );
    const contentRect = lineRect(terminal, root, contentLine);
    const endRect = lineRect(terminal, root, block.endLine);
    if (contentRect) {
      const minTop = contentRect.top + contentRect.height + BANNER_GAP;
      let bannerTop =
        endRect && endRect.top >= contentRect.top
          ? endRect.top + endRect.height + BANNER_GAP
          : minTop;
      bannerTop = Math.max(bannerTop, minTop);

      const room = root.clientHeight - bannerTop;
      const compact = room < 44;
      const bannerH = compact ? 28 : 40;
      const maxTop = root.clientHeight - bannerH - 2;
      if (bannerTop > maxTop && maxTop >= minTop) {
        bannerTop = maxTop;
      }

      if (bannerTop >= 0) {
        const banner = buildWaitingBanner(snapshot);
        if (compact) banner.classList.add("tethra-block-waiting-compact");
        banner.style.top = `${bannerTop}px`;
        banner.style.left = `${prompt.left}px`;
        banner.style.width = `${Math.max(120, prompt.width - MENU_COLUMN_WIDTH - 10)}px`;
        banner.style.right = "auto";
        root.appendChild(banner);
      }
    }
  }
}

function buildHeader(block: BlockChromeEntry, isActive: boolean): HTMLElement {
  const header = document.createElement("div");
  header.className = "tethra-block-overlay-header";

  const path = document.createElement("span");
  path.className = "tethra-block-header-path";
  path.textContent = shortenPath(block.meta.cwd) || "—";
  header.appendChild(path);

  if (block.meta.gitBranch) {
    const branch = document.createElement("span");
    branch.className = "tethra-block-branch";
    branch.textContent = block.meta.gitBranch;
    header.appendChild(branch);
  }

  const command = (block.commandText || "").trim();
  if (command) {
    const cmdWrap = document.createElement("span");
    cmdWrap.className = "tethra-block-header-cmd";
    const prompt = document.createElement("span");
    prompt.className = isActive
      ? "tethra-block-header-prompt is-active"
      : block.exitCode != null && block.exitCode !== 0
        ? "tethra-block-header-prompt is-failed"
        : "tethra-block-header-prompt is-ok";
    prompt.textContent = "❯";
    const cmd = document.createElement("span");
    cmd.className = "tethra-block-header-cmd-text";
    cmd.textContent = command;
    cmd.title = command;
    cmdWrap.appendChild(prompt);
    cmdWrap.appendChild(cmd);
    header.appendChild(cmdWrap);
  }

  const spacer = document.createElement("span");
  spacer.className = "tethra-block-overlay-spacer";
  header.appendChild(spacer);

  const right = document.createElement("span");
  right.className = "tethra-block-header-meta";
  if (isActive) {
    const elapsed = block.meta.startedAt
      ? formatDuration(Date.now() - block.meta.startedAt)
      : "—";
    right.textContent = `running ${elapsed}`;
  } else if (block.exitCode != null && block.exitCode !== 0) {
    const duration =
      block.meta.endedAt && block.meta.startedAt
        ? formatDuration(block.meta.endedAt - block.meta.startedAt)
        : "—";
    right.innerHTML = `<span class="tethra-block-exit">exit ${block.exitCode}</span><span> · ${duration}${block.meta.endedAt ? ` · ${formatBlockTime(block.meta.endedAt)}` : ""}</span>`;
  } else if (block.meta.endedAt && block.meta.startedAt) {
    const duration = formatDuration(block.meta.endedAt - block.meta.startedAt);
    right.textContent = `${duration} · ${formatBlockTime(block.meta.endedAt)}`;
  }
  right.style.paddingRight = `${MENU_COLUMN_WIDTH}px`;
  header.appendChild(right);
  return header;
}

function buildWaitingBanner(snapshot: BlockChromeSnapshot): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "tethra-block-waiting tethra-block-overlay-waiting";

  const dot = document.createElement("span");
  dot.className = "tethra-block-waiting-dot";
  banner.appendChild(dot);

  const msg = document.createElement("span");
  msg.textContent =
    snapshot.context.waitingMessage ??
    "Waiting for you — approve the pending change";
  banner.appendChild(msg);

  const spacer = document.createElement("span");
  spacer.className = "tethra-block-overlay-spacer";
  banner.appendChild(spacer);

  if (snapshot.context.onReview) {
    const review = document.createElement("button");
    review.type = "button";
    review.className = "tethra-block-review-btn";
    review.textContent = "Review";
    review.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      snapshot.context.onReview?.();
    });
    banner.appendChild(review);
  }
  return banner;
}

function buildMenuButton(
  block: BlockChromeEntry,
  snapshot: BlockChromeSnapshot,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "tethra-block-menu-wrap tethra-block-overlay-menu";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tethra-block-menu-btn";
  btn.title = "Block actions";
  btn.textContent = "⋮";
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showBlockMenu(event, block, snapshot);
  });
  wrap.appendChild(btn);
  return wrap;
}

function showBlockMenu(
  event: MouseEvent,
  block: BlockChromeEntry,
  snapshot: BlockChromeSnapshot,
): void {
  document.querySelector("[data-tethra-block-menu]")?.remove();
  const menu = document.createElement("div");
  menu.dataset.tethraBlockMenu = "1";
  menu.className = "tethra-block-menu tethra-block-menu-panel";
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  const items: Array<{
    label: string;
    primary?: boolean;
    run: () => void;
  }> = [
    {
      label: "Copy command",
      primary: true,
      run: () => void writeClipboardText(block.commandText || ""),
    },
    {
      label: "Copy output",
      run: () => void writeClipboardText(block.outputText || ""),
    },
    {
      label: "Share block",
      run: () =>
        void writeClipboardText(
          [block.commandText, block.outputText].filter(Boolean).join("\n\n"),
        ),
    },
    {
      label: "Re-run",
      run: () => {
        if (block.commandText) {
          armShellInjectGate();
          snapshot.onRerun?.(block.commandText);
        }
      },
    },
  ];
  if (snapshot.context.isAgentSession && snapshot.context.onJumpToAgent) {
    items.push({
      label: "Jump to agent",
      run: () => snapshot.context.onJumpToAgent?.(),
    });
  }

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = item.label;
    if (item.primary) btn.className = "is-active";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      menu.remove();
      item.run();
    });
    menu.appendChild(btn);
  }

  const dismiss = () => {
    menu.remove();
    window.removeEventListener("mousedown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
  };
  const onDown = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) dismiss();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") dismiss();
  };
  document.body.appendChild(menu);
  window.addEventListener("mousedown", onDown, true);
  window.addEventListener("keydown", onKey, true);
}
