import type { IMarker, Terminal } from "@xterm/xterm";
import type { TerminalBlockPhase } from "../lib/generated/TerminalBlockPhase";
import {
  getTerminalCwd,
  getTerminalGitBranch,
  getTerminalInstance,
} from "./registry";
import {
  disposeBlockOverlay,
  scheduleBlockOverlaySync,
} from "./blockOverlay";
import { COLLAPSE_LINE_THRESHOLD } from "./blockChrome";

interface BlockMeta {
  cwd?: string;
  gitBranch?: string;
  startedAt: number;
  endedAt?: number;
}

interface FinishedBlock {
  id: string;
  start: IMarker;
  end: IMarker;
  commandText: string;
  outputText: string;
  exitCode: number | null;
  meta: BlockMeta;
  lineCount: number;
  collapsed: boolean;
}

interface ActiveBlock {
  start: IMarker;
  meta: BlockMeta;
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
  nextId: number;
}

export type BlockChromeEntry = {
  id: string;
  kind: "active" | "ok" | "failed";
  startLine: number;
  endLine: number;
  commandText: string;
  outputText: string;
  exitCode: number | null;
  meta: BlockMeta;
  lineCount: number;
  collapsed: boolean;
};

export type BlockChromeSnapshot = {
  blocks: BlockChromeEntry[];
  context: SessionBlockContext;
  onRerun?: (command: string) => void;
};

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
      nextId: 0,
    };
    trackers.set(sessionId, tracker);
  }
  return tracker;
}

function nextBlockId(tracker: BlockTracker): string {
  tracker.nextId += 1;
  return `block-${tracker.nextId}`;
}

function notify(sessionId: string): void {
  blockListeners.get(sessionId)?.forEach((fn) => fn());
}

function syncChrome(sessionId: string): void {
  scheduleBlockOverlaySync(sessionId);
  notify(sessionId);
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
  syncChrome(sessionId);
}

export function setBlockSessionContext(
  sessionId: string,
  context: SessionBlockContext,
): void {
  ensure(sessionId).context = context;
  syncChrome(sessionId);
}

export function setBlockCollapsed(
  sessionId: string,
  blockId: string,
  collapsed: boolean,
): void {
  const tracker = trackers.get(sessionId);
  if (!tracker) return;
  const block = tracker.finished.find((entry) => entry.id === blockId);
  if (!block) return;
  block.collapsed = collapsed;
  syncChrome(sessionId);
}

export function getBlockChromeSnapshot(
  sessionId: string,
): BlockChromeSnapshot | undefined {
  const tracker = trackers.get(sessionId);
  if (!tracker) return undefined;

  const blocks: BlockChromeEntry[] = [];

  for (const block of tracker.finished) {
    if (block.start.isDisposed || block.end.isDisposed) continue;
    blocks.push({
      id: block.id,
      kind:
        block.exitCode !== null && block.exitCode !== 0 ? "failed" : "ok",
      startLine: block.start.line,
      endLine: block.end.line,
      commandText: block.commandText,
      outputText: block.outputText,
      exitCode: block.exitCode,
      meta: block.meta,
      lineCount: block.lineCount,
      collapsed: block.collapsed,
    });
  }

  if (tracker.active?.start && !tracker.active.start.isDisposed) {
    const terminal = getTerminalInstance(sessionId);
    const endLine = terminal
      ? terminal.buffer.active.baseY + terminal.buffer.active.cursorY
      : tracker.active.start.line;
    blocks.push({
      id: "active",
      kind: "active",
      startLine: tracker.active.start.line,
      endLine: Math.max(tracker.active.start.line, endLine),
      commandText: tracker.open.commandText ?? "",
      outputText: "",
      exitCode: null,
      meta: tracker.active.meta,
      lineCount: Math.max(1, endLine - tracker.active.start.line + 1),
      collapsed: false,
    });
  }

  return {
    blocks,
    context: tracker.context,
    onRerun: tracker.onRerun,
  };
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
  syncChrome(sessionId);
}

export function refreshActiveBlock(
  sessionId: string,
  _terminal: Terminal,
): void {
  syncChrome(sessionId);
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
      tracker.active = {
        start: marker,
        meta: {
          cwd: getTerminalCwd(sessionId),
          gitBranch: getTerminalGitBranch(sessionId),
          startedAt: Date.now(),
        },
      };
      tracker.open = {
        commandStart: marker,
        meta: tracker.active.meta,
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
      break;
    }
    case "commandEnd": {
      const end = terminal.registerMarker(0);
      if (!end) return;
      tracker.active = undefined;
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
        gitBranch:
          tracker.open.meta?.gitBranch ?? getTerminalGitBranch(sessionId),
        startedAt: tracker.open.meta?.startedAt ?? Date.now(),
        endedAt: Date.now(),
      };
      tracker.finished.push({
        id: nextBlockId(tracker),
        start,
        end,
        commandText,
        outputText,
        exitCode,
        meta,
        lineCount,
        collapsed: lineCount >= COLLAPSE_LINE_THRESHOLD,
      });
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

function disposeFinished(block: FinishedBlock | undefined): void {
  if (!block) return;
  block.start.dispose();
  block.end.dispose();
}

export function disposeBlockTracker(sessionId: string): void {
  const tracker = trackers.get(sessionId);
  if (!tracker) return;
  tracker.active = undefined;
  for (const block of tracker.finished) disposeFinished(block);
  tracker.open.commandStart?.dispose();
  tracker.open.outputStart?.dispose();
  trackers.delete(sessionId);
  blockListeners.delete(sessionId);
  disposeBlockOverlay(sessionId);
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
