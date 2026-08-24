import type { Terminal } from "@xterm/xterm";
import { writeClipboardText } from "../lib/ipc";
import { armShellInjectGate } from "./inject";
import type { BlockChromeSnapshot, BlockChromeEntry } from "./blocks";
import { getBlockChromeSnapshot, setBlockCollapsed } from "./blocks";
import {
  BLOCK_COLORS,
  commandSummary,
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
/** Banner Review sits left of the ⋮ column. */
const BANNER_HEIGHT = 36;
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
    if (block.collapsed) {
      renderCollapsed(sessionId, root, terminal, block);
      continue;
    }
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

function renderCollapsed(
  sessionId: string,
  root: HTMLElement,
  terminal: Terminal,
  block: BlockChromeEntry,
): void {
  // Opaque cover over every visible line of the collapsed block — hides buffer
  // text without stretching xterm. Summary chip sits on the prompt row when
  // visible, else at the top of the visible span.
  const cover = clampedFrame(
    terminal,
    root,
    block.promptLine,
    block.endLine,
  );
  if (!cover) return;

  const coverEl = document.createElement("div");
  coverEl.className = "tethra-block-overlay-cover";
  coverEl.style.top = `${cover.top}px`;
  coverEl.style.height = `${cover.height}px`;
  applyHorizontal(coverEl, cover.left, cover.width);
  root.appendChild(coverEl);

  const prompt = lineRect(terminal, root, block.promptLine);
  const chipTop = prompt?.top ?? cover.top;
  const chipHeight = prompt?.height ?? measureCellHeight(terminal);

  const duration =
    block.meta.endedAt && block.meta.startedAt
      ? formatDuration(block.meta.endedAt - block.meta.startedAt)
      : "—";
  const railColor =
    block.exitCode !== null && block.exitCode !== 0
      ? BLOCK_COLORS.fail
      : BLOCK_COLORS.ok;

  const row = document.createElement("div");
  row.className = "tethra-block-overlay-collapsed";
  row.style.top = `${chipTop}px`;
  row.style.height = `${chipHeight}px`;
  applyHorizontal(row, cover.left, cover.width);

  row.innerHTML = `
    <div class="tethra-block-overlay-rail" style="background:${railColor};opacity:0.4"></div>
    <span class="tethra-block-overlay-chevron">›</span>
    <span class="tethra-block-overlay-cmd">${escapeHtml(commandSummary(block.commandText))}</span>
    <span class="tethra-block-overlay-lines">${block.lineCount.toLocaleString()} lines</span>
    <span class="tethra-block-overlay-spacer"></span>
    <span class="tethra-block-overlay-time">${duration}${block.meta.endedAt ? ` · ${formatBlockTime(block.meta.endedAt)}` : ""}</span>
  `;
  row.addEventListener("click", () => {
    setBlockCollapsed(sessionId, block.id, false);
    scheduleBlockOverlaySync(sessionId);
  });
  root.appendChild(row);
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

  if (bounds) {
    const frame = document.createElement("div");
    frame.className = isActive
      ? "tethra-block-overlay-frame tethra-block-overlay-active"
      : failed
        ? "tethra-block-overlay-frame tethra-block-overlay-failed"
        : "tethra-block-overlay-frame tethra-block-overlay-ok";
    frame.style.top = `${bounds.top}px`;
    frame.style.height = `${bounds.height}px`;
    applyHorizontal(frame, bounds.left, bounds.width);

    const rail = document.createElement("div");
    rail.className = "tethra-block-overlay-rail";
    rail.style.background = railColor;
    rail.style.opacity = railOpacity;
    frame.appendChild(rail);
    root.appendChild(frame);
  }

  const header = buildHeader(block, isActive);
  header.style.top = `${prompt.top}px`;
  header.style.height = `${prompt.height}px`;
  applyHorizontal(header, prompt.left, prompt.width);
  root.appendChild(header);

  const menu = buildMenuButton(block, snapshot);
  menu.style.top = `${prompt.top + Math.max(0, (prompt.height - 24) / 2)}px`;
  menu.style.left = "auto";
  menu.style.right = `${Math.max(6, root.clientWidth - prompt.left - prompt.width + 6)}px`;
  root.appendChild(menu);

  if (isActive && snapshot.context.waiting) {
    const endRect = lineRect(terminal, root, block.endLine);
    if (endRect) {
      let bannerTop = endRect.top + endRect.height + BANNER_GAP;
      // Prefer sitting just below the last line; if that would leave the
      // viewport, pin inside the frame bottom so Review stays visible.
      if (bounds) {
        const maxInside = bounds.top + bounds.height - BANNER_HEIGHT - 2;
        bannerTop = Math.min(bannerTop, maxInside);
        bannerTop = Math.max(bannerTop, bounds.top + 2);
      } else {
        bannerTop = Math.min(bannerTop, root.clientHeight - BANNER_HEIGHT - 4);
      }
      if (bannerTop >= 0) {
        const banner = buildWaitingBanner(snapshot);
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
  path.textContent = shortenPath(block.meta.cwd) || "—";
  header.appendChild(path);

  if (block.meta.gitBranch) {
    const branch = document.createElement("span");
    branch.className = "tethra-block-branch";
    branch.textContent = block.meta.gitBranch;
    header.appendChild(branch);
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
