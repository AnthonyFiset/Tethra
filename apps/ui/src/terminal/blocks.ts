import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import { writeClipboardText } from "../lib/ipc";
import type { TerminalBlockPhase } from "../lib/generated/TerminalBlockPhase";
import {
  getTerminalCwd,
  getTerminalGitBranch,
  getTerminalInstance,
} from "./registry";
import { armShellInjectGate } from "./inject";
import {
  BLOCK_COLORS,
  COLLAPSE_LINE_THRESHOLD,
  commandSummary,
  formatBlockTime,
  formatDuration,
  shortenPath,
} from "./blockChrome";

interface BlockMeta {
  cwd?: string;
  gitBranch?: string;
  startedAt: number;
  endedAt?: number;
}

interface FinishedBlock {
  start: IMarker;
  end: IMarker;
  commandText: string;
  outputText: string;
  exitCode: number | null;
  meta: BlockMeta;
  lineCount: number;
  collapsed: boolean;
  decoration?: IDecoration;
  coverDecoration?: IDecoration;
  disposables: { dispose(): void }[];
}

interface ActiveBlock {
  start: IMarker;
  meta: BlockMeta;
  decoration?: IDecoration;
  disposables: { dispose(): void }[];
}

interface SessionBlockContext {
  waiting?: boolean;
  waitingMessage?: string;
  isAgentSession?: boolean;
  onReview?: () => void;
  onJumpToAgent?: () => void;
}

interface BlockTracker {
  open: {
    commandStart?: IMarker;
    outputStart?: IMarker;
    commandText?: string;
    outputText?: string;
    meta?: BlockMeta;
  };
  pending: Array<{ phase: TerminalBlockPhase; exitCode: number | null }>;
  finished: FinishedBlock[];
  active?: ActiveBlock;
  context: SessionBlockContext;
  onRerun?: (command: string) => void;
}

const trackers = new Map<string, BlockTracker>();
const blockListeners = new Map<string, Set<() => void>>();

function ensure(sessionId: string): BlockTracker {
  let tracker = trackers.get(sessionId);
  if (!tracker) {
    tracker = {
      open: {},
      pending: [],
      finished: [],
      context: {},
    };
    trackers.set(sessionId, tracker);
  }
  return tracker;
}

function notify(sessionId: string): void {
  blockListeners.get(sessionId)?.forEach((fn) => fn());
}

export function subscribeBlockChanges(
  sessionId: string,
  listener: () => void,
): () => void {
  const set = blockListeners.get(sessionId) ?? new Set();
  set.add(listener);
  blockListeners.set(sessionId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) blockListeners.delete(sessionId);
  };
}

export function setBlockRerunHandler(
  sessionId: string,
  onRerun: ((command: string) => void) | undefined,
): void {
  ensure(sessionId).onRerun = onRerun;
}

export function setBlockSessionContext(
  sessionId: string,
  context: SessionBlockContext,
): void {
  const tracker = ensure(sessionId);
  tracker.context = context;
  const terminal = getTerminalInstance(sessionId);
  if (
    terminal &&
    tracker.active?.start &&
    !tracker.active.start.isDisposed
  ) {
    refreshActiveBlock(sessionId, terminal);
  }
}

export function queueBlockPhase(
  sessionId: string,
  phase: TerminalBlockPhase,
  exitCode: number | null,
): void {
  ensure(sessionId).pending.push({ phase, exitCode });
}

export function flushBlockPhases(
  sessionId: string,
  terminal: Terminal,
): void {
  const tracker = trackers.get(sessionId);
  if (!tracker || tracker.pending.length === 0) return;
  const batch = tracker.pending.splice(0, tracker.pending.length);
  for (const item of batch) {
    applyPhase(sessionId, terminal, tracker, item.phase, item.exitCode);
  }
  refreshActiveBlock(sessionId, terminal);
  notify(sessionId);
}

export function refreshActiveBlock(
  sessionId: string,
  terminal: Terminal,
): void {
  const tracker = trackers.get(sessionId);
  if (!tracker?.active?.start || tracker.active.start.isDisposed) return;
  const start = tracker.active.start;
  const meta = tracker.active.meta;
  disposeActive(tracker);
  tracker.active = {
    start,
    meta,
    ...decorateActive(sessionId, terminal, tracker, start, activeHeight(terminal, start)),
  };
}

function activeHeight(terminal: Terminal, start: IMarker): number {
  const endLine = terminal.buffer.active.baseY + terminal.buffer.active.cursorY;
  return Math.max(1, endLine - start.line + 1);
}

function applyPhase(
  sessionId: string,
  terminal: Terminal,
  tracker: BlockTracker,
  phase: TerminalBlockPhase,
  exitCode: number | null,
): void {
  switch (phase) {
    case "promptStart":
      tracker.open = {};
      break;
    case "commandStart": {
      const marker = terminal.registerMarker(0);
      if (!marker) return;
      disposeActive(tracker);
      const meta: BlockMeta = {
        cwd: getTerminalCwd(sessionId),
        gitBranch: getTerminalGitBranch(sessionId),
        startedAt: Date.now(),
      };
      tracker.open = { commandStart: marker, meta };
      tracker.active = {
        start: marker,
        meta,
        ...decorateActive(sessionId, terminal, tracker, marker, 1),
      };
      break;
    }
    case "outputStart": {
      const marker = terminal.registerMarker(0);
      if (!marker) return;
      const commandText = textBetween(
        terminal,
        tracker.open.commandStart,
        marker,
      );
      tracker.open.outputStart = marker;
      tracker.open.commandText = commandText;
      refreshActiveBlock(sessionId, terminal);
      break;
    }
    case "commandEnd": {
      const end = terminal.registerMarker(0);
      if (!end) return;
      disposeActive(tracker);
      const start = tracker.open.commandStart ?? end;
      const outputStart = tracker.open.outputStart;
      const commandText =
        tracker.open.commandText ??
        textBetween(terminal, tracker.open.commandStart, outputStart ?? end);
      const outputText = textBetween(terminal, outputStart, end);
      const lineCount = Math.max(1, end.line - start.line + 1);
      const meta: BlockMeta = {
        ...tracker.open.meta,
        cwd: tracker.open.meta?.cwd ?? getTerminalCwd(sessionId),
        gitBranch: tracker.open.meta?.gitBranch ?? getTerminalGitBranch(sessionId),
        startedAt: tracker.open.meta?.startedAt ?? Date.now(),
        endedAt: Date.now(),
      };
      const finished: FinishedBlock = {
        start,
        end,
        commandText,
        outputText,
        exitCode,
        meta,
        lineCount,
        collapsed: lineCount >= COLLAPSE_LINE_THRESHOLD,
        disposables: [],
      };
      decorateFinished(sessionId, terminal, tracker, finished);
      tracker.finished.push(finished);
      while (tracker.finished.length > 80) {
        disposeFinished(tracker.finished.shift());
      }
      tracker.open = {};
      break;
    }
    default:
      break;
  }
}

function textBetween(
  terminal: Terminal,
  start: IMarker | undefined,
  end: IMarker | undefined,
): string {
  if (!start || !end) return "";
  if (start.isDisposed || end.isDisposed) return "";
  const from = start.line;
  const to = end.line;
  if (from < 0 || to < 0 || to < from) return "";
  const lines: string[] = [];
  for (let y = from; y <= to; y++) {
    const line = terminal.buffer.active.getLine(y);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join("\n").trim();
}

function decorateActive(
  sessionId: string,
  terminal: Terminal,
  tracker: BlockTracker,
  marker: IMarker,
  height: number,
): { decoration?: IDecoration; disposables: { dispose(): void }[] } {
  const disposables: { dispose(): void }[] = [];
  const decoration = terminal.registerDecoration({
    marker,
    width: terminal.cols,
    height,
    layer: "top",
  });
  if (!decoration) return { disposables };

  const onRender = decoration.onRender((element) => {
    element.replaceChildren();
    element.className = "tethra-block-active";
    element.style.pointerEvents = "none";
    element.style.boxSizing = "border-box";
    element.style.border = `1px solid ${BLOCK_COLORS.activeBorder}`;
    element.style.borderRadius = "10px";
    element.style.background = BLOCK_COLORS.activeBg;
    element.style.boxShadow = BLOCK_COLORS.activeShadow;
    element.style.margin = "2px 6px";

    const rail = document.createElement("div");
    rail.className = "tethra-block-rail";
    rail.style.background = BLOCK_COLORS.accent;
    element.appendChild(rail);

    buildBlockHeader(element, tracker, {
      mode: "active",
      commandText: tracker.open.commandText,
      meta: tracker.active?.meta ?? tracker.open.meta,
    });
    buildBlockMenu(element, tracker, {
      commandText: tracker.open.commandText ?? "",
      outputText: "",
      isActive: true,
    });

    if (tracker.context.waiting) {
      buildWaitingBanner(element, tracker);
    }
  });
  disposables.push(onRender, decoration);
  void sessionId;
  return { decoration, disposables };
}

function decorateFinished(
  sessionId: string,
  terminal: Terminal,
  tracker: BlockTracker,
  block: FinishedBlock,
): void {
  if (block.start.isDisposed || block.end.isDisposed) return;
  const failed = block.exitCode !== null && block.exitCode !== 0;
  const railColor = failed ? BLOCK_COLORS.fail : BLOCK_COLORS.ok;
  const railOpacity = block.collapsed ? "0.4" : failed ? "0.7" : "0.55";

  if (block.collapsed) {
    const decoration = terminal.registerDecoration({
      marker: block.start,
      width: terminal.cols,
      height: 1,
      layer: "top",
    });
    if (!decoration) return;
    block.decoration = decoration;
    const duration =
      block.meta.endedAt && block.meta.startedAt
        ? formatDuration(block.meta.endedAt - block.meta.startedAt)
        : "—";
    const onRender = decoration.onRender((element) => {
      element.className = "tethra-block-collapsed";
      element.style.pointerEvents = "auto";
      element.style.cursor = "pointer";
      element.style.display = "flex";
      element.style.alignItems = "center";
      element.style.gap = "12px";
      element.style.padding = "7px 14px";
      element.style.color = BLOCK_COLORS.subtle;
      element.style.fontFamily = "var(--font-mono)";
      element.style.fontSize = "12.5px";

      if (element.dataset.tethraBuilt === "1") return;
      element.dataset.tethraBuilt = "1";

      const rail = document.createElement("div");
      rail.style.width = "3px";
      rail.style.alignSelf = "stretch";
      rail.style.borderRadius = "2px";
      rail.style.background = railColor;
      rail.style.opacity = railOpacity;
      element.appendChild(rail);

      const chevron = document.createElement("span");
      chevron.textContent = "›";
      element.appendChild(chevron);

      const cmd = document.createElement("span");
      cmd.style.color = BLOCK_COLORS.fgMuted;
      cmd.textContent = commandSummary(block.commandText);
      element.appendChild(cmd);

      const lines = document.createElement("span");
      lines.style.fontSize = "11px";
      lines.textContent = `${block.lineCount.toLocaleString()} lines`;
      element.appendChild(lines);

      const spacer = document.createElement("span");
      spacer.style.flex = "1";
      element.appendChild(spacer);

      const time = document.createElement("span");
      time.style.fontSize = "11px";
      time.textContent = `${duration}${block.meta.endedAt ? ` · ${formatBlockTime(block.meta.endedAt)}` : ""}`;
      element.appendChild(time);

      element.addEventListener("click", () => {
        block.collapsed = false;
        block.decoration?.dispose();
        block.coverDecoration?.dispose();
        block.decoration = undefined;
        block.coverDecoration = undefined;
        decorateFinished(sessionId, terminal, tracker, block);
        notify(sessionId);
      });
    });
    block.disposables.push(onRender, decoration);

    if (block.lineCount > 1) {
      const cover = terminal.registerDecoration({
        marker: block.start,
        x: 0,
        width: terminal.cols,
        height: block.lineCount,
        layer: "top",
      });
      if (cover) {
        block.coverDecoration = cover;
        const onCover = cover.onRender((el) => {
          el.style.background = "var(--terminal-bg, #0d0d0d)";
          el.style.opacity = "0.98";
          el.style.pointerEvents = "none";
        });
        block.disposables.push(onCover, cover);
      }
    }
    return;
  }

  const height = Math.max(1, block.end.line - block.start.line + 1);
  const decoration = terminal.registerDecoration({
    marker: block.start,
    width: terminal.cols,
    height,
    layer: "top",
  });
  if (!decoration) return;
  block.decoration = decoration;

  const onRender = decoration.onRender((element) => {
    element.replaceChildren();
    element.className = failed ? "tethra-block-failed" : "tethra-block-ok";
    element.style.pointerEvents = "none";
    element.style.boxSizing = "border-box";

    const rail = document.createElement("div");
    rail.className = "tethra-block-rail";
    rail.style.background = railColor;
    rail.style.opacity = railOpacity;
    element.appendChild(rail);

    buildBlockHeader(element, tracker, {
      mode: failed ? "failed" : "ok",
      commandText: block.commandText,
      meta: block.meta,
      exitCode: block.exitCode,
    });
    buildBlockMenu(element, tracker, {
      commandText: block.commandText,
      outputText: block.outputText,
      isActive: false,
    });
  });
  block.disposables.push(onRender, decoration);
}

function buildBlockHeader(
  element: HTMLElement,
  tracker: BlockTracker,
  opts: {
    mode: "ok" | "failed" | "active";
    commandText?: string;
    meta?: BlockMeta;
    exitCode?: number | null;
  },
): void {
  const header = document.createElement("div");
  header.className = "tethra-block-header";
  const path = document.createElement("span");
  path.textContent = shortenPath(opts.meta?.cwd) || "—";
  header.appendChild(path);

  if (opts.meta?.gitBranch) {
    const branch = document.createElement("span");
    branch.className = "tethra-block-branch";
    branch.textContent = opts.meta.gitBranch;
    header.appendChild(branch);
  }

  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  header.appendChild(spacer);

  const right = document.createElement("span");
  right.className = "tethra-block-header-meta";
  if (opts.mode === "active") {
    const elapsed = opts.meta?.startedAt
      ? formatDuration(Date.now() - opts.meta.startedAt)
      : "—";
    right.textContent = `running ${elapsed}`;
    right.style.marginRight = "30px";
  } else if (opts.mode === "failed" && opts.exitCode != null) {
    const duration =
      opts.meta?.endedAt && opts.meta?.startedAt
        ? formatDuration(opts.meta.endedAt - opts.meta.startedAt)
        : "—";
    right.innerHTML = `<span class="tethra-block-exit">exit ${opts.exitCode}</span><span> · ${duration}${opts.meta?.endedAt ? ` · ${formatBlockTime(opts.meta.endedAt)}` : ""}</span>`;
  } else if (opts.meta?.endedAt && opts.meta?.startedAt) {
    const duration = formatDuration(opts.meta.endedAt - opts.meta.startedAt);
    right.textContent = `${duration} · ${formatBlockTime(opts.meta.endedAt)}`;
  }
  header.appendChild(right);
  element.appendChild(header);
}

function buildBlockMenu(
  element: HTMLElement,
  tracker: BlockTracker,
  block: { commandText: string; outputText: string; isActive: boolean },
): void {
  const wrap = document.createElement("div");
  wrap.className = "tethra-block-menu-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tethra-block-menu-btn";
  btn.title = "Block actions";
  btn.textContent = "⋮";
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showBlockMenu(event, tracker, block);
  });
  wrap.appendChild(btn);
  element.appendChild(wrap);
}

function buildWaitingBanner(element: HTMLElement, tracker: BlockTracker): void {
  const banner = document.createElement("div");
  banner.className = "tethra-block-waiting";
  const dot = document.createElement("span");
  dot.className = "tethra-block-waiting-dot";
  banner.appendChild(dot);
  const msg = document.createElement("span");
  msg.textContent =
    tracker.context.waitingMessage ??
    "Waiting for you — approve the pending change";
  banner.appendChild(msg);
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  banner.appendChild(spacer);
  if (tracker.context.onReview) {
    const review = document.createElement("button");
    review.type = "button";
    review.className = "tethra-block-review-btn";
    review.textContent = "Review";
    review.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      tracker.context.onReview?.();
    });
    banner.appendChild(review);
  }
  element.appendChild(banner);
}

function blockMenuItems(
  tracker: BlockTracker,
  block: { commandText: string; outputText: string; isActive: boolean },
): Array<{ label: string; run: () => void; primary?: boolean }> {
  const items: Array<{ label: string; run: () => void; primary?: boolean }> = [
    {
      label: "Copy command",
      run: () => void writeClipboardText(block.commandText || ""),
      primary: true,
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
          tracker.onRerun?.(block.commandText);
        }
      },
    },
  ];
  if (tracker.context.isAgentSession && tracker.context.onJumpToAgent) {
    items.push({
      label: "Jump to agent",
      run: () => tracker.context.onJumpToAgent?.(),
    });
  }
  return items;
}

function showBlockMenu(
  event: MouseEvent,
  tracker: BlockTracker,
  block: { commandText: string; outputText: string; isActive: boolean },
): void {
  document.querySelector("[data-tethra-block-menu]")?.remove();
  const menu = document.createElement("div");
  menu.dataset.tethraBlockMenu = "1";
  menu.className = "tethra-block-menu tethra-block-menu-panel";
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  for (const item of blockMenuItems(tracker, block)) {
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

function disposeActive(tracker: BlockTracker): void {
  if (!tracker.active) return;
  for (const d of tracker.active.disposables) d.dispose();
  tracker.active.decoration?.dispose();
  tracker.active = undefined;
}

function disposeFinished(block: FinishedBlock | undefined): void {
  if (!block) return;
  for (const d of block.disposables) d.dispose();
  block.decoration?.dispose();
  block.coverDecoration?.dispose();
  block.start.dispose();
  block.end.dispose();
}

export function disposeBlockTracker(sessionId: string): void {
  const tracker = trackers.get(sessionId);
  if (!tracker) return;
  disposeActive(tracker);
  for (const block of tracker.finished) disposeFinished(block);
  tracker.open.commandStart?.dispose();
  tracker.open.outputStart?.dispose();
  trackers.delete(sessionId);
  blockListeners.delete(sessionId);
}

export function lastBlockCommand(sessionId: string): string | undefined {
  const tracker = trackers.get(sessionId);
  if (!tracker) return undefined;
  for (let i = tracker.finished.length - 1; i >= 0; i--) {
    const cmd = tracker.finished[i]?.commandText?.trim();
    if (cmd) return cmd;
  }
  return undefined;
}

export function blockCount(sessionId: string): number {
  const tracker = trackers.get(sessionId);
  if (!tracker) return 0;
  return tracker.finished.length + (tracker.active ? 1 : 0);
}
