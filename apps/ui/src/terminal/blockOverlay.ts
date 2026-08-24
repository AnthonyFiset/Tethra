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

const HEADER_HEIGHT = 22;
const MENU_RESERVE = 34;

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
      renderCollapsed(sessionId, root, terminal, block, snapshot);
      continue;
    }
    renderBlock(sessionId, root, terminal, block, snapshot);
  }
}

function rowMetrics(
  terminal: Terminal,
  root: HTMLElement,
  bufferLine: number,
): { top: number; height: number } | null {
  const buffer = terminal.buffer.active;
  const rel = bufferLine - buffer.viewportY;
  if (rel < 0 || rel >= terminal.rows) return null;
  const rows = terminal.element?.querySelector(".xterm-rows");
  const row = rows?.children.item(rel) as HTMLElement | null;
  if (!row) return null;
  const rootRect = root.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  return {
    top: rowRect.top - rootRect.top,
    height: rowRect.height,
  };
}

function blockBounds(
  terminal: Terminal,
  root: HTMLElement,
  startLine: number,
  endLine: number,
): { top: number; height: number } | null {
  const start = rowMetrics(terminal, root, startLine);
  const end = rowMetrics(terminal, root, endLine);
  const rootRect = root.getBoundingClientRect();
  const rootHeight = root.clientHeight;

  if (start && end) {
    return { top: start.top, height: end.top + end.height - start.top };
  }
  if (start && !end) {
    return { top: start.top, height: rootHeight - start.top };
  }
  if (!start && end) {
    return { top: 0, height: end.top + end.height };
  }

  const buffer = terminal.buffer.active;
  if (endLine < buffer.viewportY) return null;
  if (startLine > buffer.viewportY + terminal.rows - 1) return null;

  const cellHeight =
    terminal.element
      ?.querySelector(".xterm-rows > div")
      ?.getBoundingClientRect().height ??
    terminal.options.fontSize! * (terminal.options.lineHeight ?? 1);

  const topLine = Math.max(startLine, buffer.viewportY);
  const bottomLine = Math.min(endLine, buffer.viewportY + terminal.rows - 1);
  const top = (topLine - buffer.viewportY) * cellHeight;
  const height = (bottomLine - topLine + 1) * cellHeight;
  void rootRect;
  return { top, height };
}

function renderCollapsed(
  sessionId: string,
  root: HTMLElement,
  terminal: Terminal,
  block: BlockChromeEntry,
  snapshot: BlockChromeSnapshot,
): void {
  const metrics = rowMetrics(terminal, root, block.startLine);
  if (!metrics) return;

  const row = document.createElement("div");
  row.className = "tethra-block-overlay-collapsed";
  row.style.top = `${metrics.top}px`;
  row.style.height = `${metrics.height}px`;

  const duration =
    block.meta.endedAt && block.meta.startedAt
      ? formatDuration(block.meta.endedAt - block.meta.startedAt)
      : "—";
  const railColor =
    block.exitCode !== null && block.exitCode !== 0
      ? BLOCK_COLORS.fail
      : BLOCK_COLORS.ok;

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
  void snapshot;
}

function renderBlock(
  sessionId: string,
  root: HTMLElement,
  terminal: Terminal,
  block: BlockChromeEntry,
  snapshot: BlockChromeSnapshot,
): void {
  const bounds = blockBounds(terminal, root, block.startLine, block.endLine);
  if (!bounds || bounds.height <= 0) return;

  const failed = block.exitCode !== null && block.exitCode !== 0;
  const isActive = block.kind === "active";
  const railColor = isActive
    ? BLOCK_COLORS.accent
    : failed
      ? BLOCK_COLORS.fail
      : BLOCK_COLORS.ok;
  const railOpacity = isActive ? "1" : failed ? "0.7" : "0.55";

  const frame = document.createElement("div");
  frame.className = isActive
    ? "tethra-block-overlay-frame tethra-block-overlay-active"
    : failed
      ? "tethra-block-overlay-frame tethra-block-overlay-failed"
      : "tethra-block-overlay-frame tethra-block-overlay-ok";
  frame.style.top = `${bounds.top}px`;
  frame.style.height = `${bounds.height}px`;

  const rail = document.createElement("div");
  rail.className = "tethra-block-overlay-rail";
  rail.style.background = railColor;
  rail.style.opacity = railOpacity;
  frame.appendChild(rail);

  const headerTop = Math.max(0, bounds.top - HEADER_HEIGHT);
  const header = buildHeader(block, snapshot, isActive);
  header.style.top = `${headerTop}px`;
  root.appendChild(header);

  if (isActive && snapshot.context.waiting) {
    const banner = buildWaitingBanner(snapshot);
    const bannerHeight = 40;
    banner.style.top = `${bounds.top + bounds.height - bannerHeight}px`;
    root.appendChild(banner);
  }

  root.appendChild(frame);

  const menu = buildMenuButton(block, snapshot);
  menu.style.top = `${headerTop + 2}px`;
  root.appendChild(menu);
}

function buildHeader(
  block: BlockChromeEntry,
  snapshot: BlockChromeSnapshot,
  isActive: boolean,
): HTMLElement {
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
    right.style.paddingRight = `${MENU_RESERVE}px`;
  } else if (block.exitCode != null && block.exitCode !== 0) {
    const duration =
      block.meta.endedAt && block.meta.startedAt
        ? formatDuration(block.meta.endedAt - block.meta.startedAt)
        : "—";
    right.innerHTML = `<span class="tethra-block-exit">exit ${block.exitCode}</span><span> · ${duration}${block.meta.endedAt ? ` · ${formatBlockTime(block.meta.endedAt)}` : ""}</span>`;
    right.style.paddingRight = `${MENU_RESERVE}px`;
  } else if (block.meta.endedAt && block.meta.startedAt) {
    const duration = formatDuration(block.meta.endedAt - block.meta.startedAt);
    right.textContent = `${duration} · ${formatBlockTime(block.meta.endedAt)}`;
    right.style.paddingRight = `${MENU_RESERVE}px`;
  }
  header.appendChild(right);
  void snapshot;
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
