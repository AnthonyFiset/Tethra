import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import type { TerminalBlockPhase } from "../lib/generated/TerminalBlockPhase";

const FAIL = "#e5544b";

interface OpenBlock {
  commandStart?: IMarker;
  outputStart?: IMarker;
  commandText?: string;
  outputText?: string;
}

interface FinishedBlock {
  start: IMarker;
  end: IMarker;
  commandText: string;
  outputText: string;
  exitCode: number | null;
  decoration?: IDecoration;
  disposables: { dispose(): void }[];
}

interface BlockTracker {
  open: OpenBlock;
  /** Block phases waiting for the next xterm write to commit. */
  pending: Array<{ phase: TerminalBlockPhase; exitCode: number | null }>;
  finished: FinishedBlock[];
  onRerun?: (command: string) => void;
}

const trackers = new Map<string, BlockTracker>();

function ensure(sessionId: string): BlockTracker {
  let tracker = trackers.get(sessionId);
  if (!tracker) {
    tracker = { open: {}, pending: [], finished: [] };
    trackers.set(sessionId, tracker);
  }
  return tracker;
}

export function setBlockRerunHandler(
  sessionId: string,
  onRerun: ((command: string) => void) | undefined,
): void {
  ensure(sessionId).onRerun = onRerun;
}

/** Queue an OSC 133 phase; applied after the next buffer write. */
export function queueBlockPhase(
  sessionId: string,
  phase: TerminalBlockPhase,
  exitCode: number | null,
): void {
  ensure(sessionId).pending.push({ phase, exitCode });
}

/** Call from xterm write callback so markers sit on committed buffer lines. */
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
      tracker.open = { commandStart: marker };
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
      const start = tracker.open.commandStart ?? end;
      const outputStart = tracker.open.outputStart;
      const commandText =
        tracker.open.commandText ??
        textBetween(terminal, tracker.open.commandStart, outputStart ?? end);
      const outputText = textBetween(terminal, outputStart, end);
      const finished: FinishedBlock = {
        start,
        end,
        commandText,
        outputText,
        exitCode,
        disposables: [],
      };
      if (exitCode !== null && exitCode !== 0) {
        decorateFailed(sessionId, terminal, tracker, finished);
      }
      tracker.finished.push(finished);
      // Cap retained decorations.
      while (tracker.finished.length > 80) {
        const old = tracker.finished.shift();
        disposeFinished(old);
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

function decorateFailed(
  sessionId: string,
  terminal: Terminal,
  tracker: BlockTracker,
  block: FinishedBlock,
): void {
  if (block.start.isDisposed || block.end.isDisposed) return;
  const height = Math.max(1, block.end.line - block.start.line + 1);
  const decoration = terminal.registerDecoration({
    marker: block.start,
    width: 1,
    height,
    layer: "top",
    overviewRulerOptions: {
      color: FAIL,
      position: "left",
    },
  });
  if (!decoration) return;
  block.decoration = decoration;

  const onRender = decoration.onRender((element) => {
    element.classList.add("tethra-block-failed");
    element.style.left = "0px";
    element.style.width = "100%";
    element.style.pointerEvents = "none";
    element.style.borderLeft = `2px solid ${FAIL}`;
    element.style.boxSizing = "border-box";

    if (element.dataset.tethraActions === "1") return;
    element.dataset.tethraActions = "1";

    const actions = document.createElement("div");
    actions.className = "tethra-block-actions";
    actions.style.pointerEvents = "auto";

    const addBtn = (label: string, title: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      actions.appendChild(btn);
    };

    addBtn("Copy cmd", "Copy command", () => {
      void navigator.clipboard.writeText(block.commandText || "");
    });
    addBtn("Copy out", "Copy output", () => {
      void navigator.clipboard.writeText(block.outputText || "");
    });
    addBtn("Rerun", "Insert command for rerun", () => {
      if (block.commandText) tracker.onRerun?.(block.commandText);
    });

    element.appendChild(actions);
  });
  block.disposables.push(onRender);
  block.disposables.push(decoration);
  void sessionId;
}

function disposeFinished(block: FinishedBlock | undefined): void {
  if (!block) return;
  for (const d of block.disposables) d.dispose();
  block.decoration?.dispose();
  block.start.dispose();
  block.end.dispose();
}

export function disposeBlockTracker(sessionId: string): void {
  const tracker = trackers.get(sessionId);
  if (!tracker) return;
  for (const block of tracker.finished) disposeFinished(block);
  tracker.open.commandStart?.dispose();
  tracker.open.outputStart?.dispose();
  trackers.delete(sessionId);
}
