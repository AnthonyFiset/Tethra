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

interface BlockMeta {
  cwd?: string;
  gitBranch?: string;
  startedAt: number;
  endedAt?: number;
}

interface FinishedBlock {
  id: string;
  prompt: IMarker;
  command: IMarker;
  end: IMarker;
  /** commandText came from the input box — authoritative, skip heuristics. */
  fromInput?: boolean;
  commandText: string;
  outputText: string;
  exitCode: number | null;
  meta: BlockMeta;
  lineCount: number;
}

interface ActiveBlock {
  prompt: IMarker;
  command: IMarker;
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
    promptStart?: IMarker;
    commandStart?: IMarker;
    outputStart?: IMarker;
    commandText?: string;
    /** commandText came from the input box (authoritative, skip dup guards). */
    commandFromInput?: boolean;
    outputText?: string;
    meta?: BlockMeta;
  };
  pending: Array<{ phase: TerminalBlockPhase; exitCode: number | null }>;
  finished: FinishedBlock[];
  active?: ActiveBlock;
  context: SessionBlockContext;
  onRerun?: (command: string) => void;
  nextId: number;
  /** When true, leave the live PS1 uncovered (input-box mirror failed). */
  uncoverLivePrompt: boolean;
}

export type BlockChromeEntry = {
  id: string;
  kind: "active" | "ok" | "failed";
  /**
   * Active block whose command has not started running yet (no OSC 133;C).
   * The user is composing in the input box — the overlay must not echo the
   * typed text into a header, only blank the raw PS1 row.
   */
  composing?: boolean;
  /** OSC 133;A prompt row — header anchors here. */
  promptLine: number;
  /**
   * OSC 133;B command row when known. The styled header covers
   * [promptLine, commandLine] so the raw PS1 never shows beside the
   * Warp command line.
   */
  commandLine: number;
  endLine: number;
  commandText: string;
  outputText: string;
  exitCode: number | null;
  meta: BlockMeta;
  lineCount: number;
};

export type BlockChromeSnapshot = {
  blocks: BlockChromeEntry[];
  context: SessionBlockContext;
  onRerun?: (command: string) => void;
  /** Active live prompt should not be covered (mirror fallback). */
  uncoverLivePrompt: boolean;
  /** A command is executing (OSC 133 C seen, no D) — the app owns the
   * screen: no blanking, no text-matched covers (TUI rows fake prompts). */
  running: boolean;
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
      uncoverLivePrompt: false,
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

function markerLine(marker: IMarker | undefined): number | undefined {
  if (!marker || marker.isDisposed) return undefined;
  return marker.line;
}

/** Glyphs that commonly terminate a PS1 before the typed command. */
const PS1_END_CHARS = "$#%>❯➢➤›»⟩〉➜⇒→▶↵";

function ps1EndRe(): RegExp {
  return new RegExp(`[${PS1_END_CHARS}]`);
}

function stripPs1Re(): RegExp {
  return new RegExp(`^.*?[${PS1_END_CHARS}] ?`);
}

/** Leading prompt ornaments (powerline / starship / theme bullets). */
function stripOrnaments(raw: string): string {
  return raw.replace(/^[·•∙▲▶►▸☛➢✩★◆◇○●]\s*/u, "").trimStart();
}

/**
 * Reject multi-token directory listings that lack shell metacharacters.
 * Keeps `git status`, `ls -la`, pipelines, etc.
 */
function looksLikeDirectoryListing(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  // 3-4 plain tokens are overwhelmingly COMMANDS ("sudo apt update",
  // "npm run build", "git status -sb") — this guard silently deleted their
  // blocks for months. Only long runs of bare names look like ls output.
  if (tokens.length < 5) return false;
  if (/[\|;&<>(){}]/.test(text)) return false;
  if (tokens.some((t) => t.startsWith("-") || t.includes("/"))) return false;
  return tokens.every((t) => /^[A-Za-z0-9._+-]+$/.test(t));
}

/**
 * Strict prompt-row detector. Never treat "any line containing #" as a PS1 —
 * that hid remote output under opaque covers when markers drifted.
 */
function looksLikePromptLine(raw: string): boolean {
  const t = raw.trimEnd();
  if (!t) return false;
  // Classic bash/debian: root@ubuntu:~#  /  user@host:~/path$
  if (/^[\w.-]+@[\w.-]+:[^\s]*[#\$](?:\s|$)/.test(t)) return true;
  // user@host … ❯ / user@host %
  if (/^[\w.-]+@[\w.-]+.*[$#%>❯➢➤›»⟩〉➜⇒→▶](?:\s|$)/.test(t)) return true;
  // Ornament / path-only themes: "~ ❯", "▲ ~", "~ %"
  const line = stripOrnaments(t);
  if (/^~(?:\/\S*)?(?:\s+[$#%>❯➢➤›»⟩〉➜⇒→▶]|\s*$|\s+\S)/.test(line)) {
    // Require a prompt glyph OR short idle path — not "Applications Movies…"
    if (ps1EndRe().test(t)) return true;
    if (/^~(?:\/\S*)?$/.test(line.trim())) return true;
    if (/^~(?:\/\S*)?\s+\S/.test(line) && line.split(/\s+/).length <= 6) {
      return true;
    }
  }
  // Prompt glyph near end of the prefix (idle or "❯ cmd")
  if (/[$#%>❯➢➤›»⟩〉➜⇒→▶]\s*\S*$/.test(t) && t.length < 200) {
    // Exclude pure output that happens to include ">" (rare); require
    // the glyph in the first 80 chars (PS1 zone).
    const head = t.slice(0, 80);
    if (ps1EndRe().test(head)) return true;
  }
  return false;
}

/** @deprecated use looksLikePromptLine — kept as alias for call sites. */
function lineHasPs1(raw: string): boolean {
  return looksLikePromptLine(raw);
}

/**
 * Strip a common PS1 prefix. Handles root@host:~# , user@host$ , ornament paths.
 */
function stripPs1(raw: string): string {
  let line = stripOrnaments(raw);
  line = stripOrnaments(line);

  // Classic user@host:path#|$  (Debian/Ubuntu root shells)
  const classic = line.match(/^[\w.-]+@[\w.-]+:[^\s]*[#\$]\s*(.*)$/);
  if (classic) return (classic[1] ?? "").trim();

  // user@host … glyph cmd
  const userHost = line.match(
    /^[\w.-]+@[\w.-]+\s+[^\n]*?[$#%>❯➢➤›»⟩〉➜⇒→▶]\s*(.*)$/,
  );
  if (userHost) return (userHost[1] ?? "").trim();

  if (ps1EndRe().test(line)) {
    // Only strip through a glyph in the PS1 zone (first 80 chars).
    const head = line.slice(0, 80);
    const tail = line.slice(80);
    if (ps1EndRe().test(head)) {
      const after = head.replace(stripPs1Re(), "") + tail;
      const pathPref = after.match(/^~(?:\/\S*)? (.*)$/);
      if (pathPref) return (pathPref[1] ?? "").trim();
      return after.trim();
    }
  }

  const pathPref = line.match(/^~(?:\/\S*)? (.*)$/);
  if (pathPref) return (pathPref[1] ?? "").trim();

  const homeCmd = raw.match(/~(?:\/\S*)?\s+(\S.*)$/);
  if (homeCmd && !looksLikeDirectoryListing(homeCmd[1] ?? "")) {
    return (homeCmd[1] ?? "").trim();
  }

  return line.trim();
}

function isPlausibleCommandText(stripped: string): boolean {
  const t = stripped.trim();
  if (!t) return false;
  if (t.length > 160) return false;
  if (t.includes("\n")) return false;
  if (t === "~" || t === "." || t === "..") return false;
  if (looksLikeDirectoryListing(t)) return false;
  return true;
}

/**
 * Command text from the prompt/command marker line only —
 * never from the output region.
 */
function extractCommandLine(
  terminal: Terminal,
  command: IMarker | undefined,
  prompt: IMarker | undefined,
): string {
  const lineNo = markerLine(command) ?? markerLine(prompt);
  if (lineNo == null) return "";
  const raw = terminal.buffer.active.getLine(lineNo)?.translateToString(true) ?? "";
  // Defense: markers that drifted onto output rows have no PS1.
  if (!lineHasPs1(raw)) return "";
  const stripped = stripPs1(raw).trim();
  return isPlausibleCommandText(stripped) ? stripped : "";
}

/**
 * Walk up from the cursor to find the PS1 row that holds the command.
 * At OSC 133;C (preexec) the command is almost always on the previous line.
 * Never accept a bare output row (e.g. a single "test" dir from ls) even when
 * it sits next to the cursor — that made remote headers show ❯ test.
 */
/**
 * The command line the user submitted (Enter in the input box / live keys).
 * We OWN the editor, so this is the truth for the next command block —
 * buffer scanning at C-time raced tmux redraws and misattributed blocks
 * (every apt block labeled "ls -a" in the field).
 */
const submittedCommands = new Map<string, Array<{ text: string; at: number }>>();

export function noteSubmittedCommand(sessionId: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  const queue = submittedCommands.get(sessionId) ?? [];
  queue.push({ text: t, at: Date.now() });
  // Bound the queue — submissions are consumed by upcoming 133;C marks.
  // Generous: pasting a multi-line script queues one entry per line.
  while (queue.length > 32) queue.shift();
  submittedCommands.set(sessionId, queue);
}

function takeSubmittedCommand(sessionId: string): string | null {
  const queue = submittedCommands.get(sessionId);
  while (queue && queue.length > 0) {
    const entry = queue.shift();
    if (!entry) break;
    // Stale submissions (Enter pressed long ago in another context) must
    // not label an unrelated block.
    if (Date.now() - entry.at <= 30_000) return entry.text;
  }
  return null;
}

/** QA introspection: what the phase handlers saw at application time. */
const phaseLog: Array<Record<string, unknown>> = [];
function recordPhaseLog(
  terminal: Terminal,
  phase: string,
  found: { line: number; commandText: string } | null,
): void {
  const buf = terminal.buffer.active;
  const cursorAbs = buf.baseY + buf.cursorY;
  const rows: string[] = [];
  for (let y = Math.max(0, cursorAbs - 6); y <= cursorAbs; y++) {
    rows.push(
      `${y}:${(buf.getLine(y)?.translateToString(true) ?? "").slice(0, 45)}`,
    );
  }
  phaseLog.push({
    phase,
    cursorAbs,
    baseY: buf.baseY,
    found: found ? { line: found.line, cmd: found.commandText } : null,
    rows,
  });
  if (phaseLog.length > 40) phaseLog.shift();
}

export function getPhaseLog(): Array<Record<string, unknown>> {
  return phaseLog;
}

/** QA: interleaving probe — registry logs each write completion here. */
export function recordOpLog(kind: string, detail: string): void {
  phaseLog.push({ phase: kind, detail });
  if (phaseLog.length > 40) phaseLog.shift();
}

function findCommandAboveCursor(
  terminal: Terminal,
): { line: number; commandText: string } | null {
  const buf = terminal.buffer.active;
  const cursor = buf.baseY + buf.cursorY;
  for (let y = cursor; y >= Math.max(0, cursor - 6); y--) {
    const raw = buf.getLine(y)?.translateToString(true) ?? "";
    if (!raw.trim()) continue;
    if (!looksLikePromptLine(raw)) continue;
    const stripped = stripPs1(raw).trim();
    if (!isPlausibleCommandText(stripped)) continue;
    return { line: y, commandText: stripped };
  }
  return null;
}

function markerAtLine(terminal: Terminal, absLine: number): IMarker | undefined {
  const cursor = terminal.buffer.active.baseY + terminal.buffer.active.cursorY;
  const offset = absLine - cursor;
  // Long-output commands (apt) put their PS1 row far above the cursor.
  if (offset < -4000 || offset > 10) return undefined;
  return terminal.registerMarker(offset) ?? undefined;
}

/**
 * First prompt-shaped row at or above `fromLine`. Between a command's end
 * and its PS1 row lie only output rows, so — once output has settled — this
 * is the command's own row. Used at commandEnd, where the buffer is
 * complete; scanning at C raced in-flight redraw bytes.
 */
function findFirstPromptRowAbove(
  terminal: Terminal,
  fromLine: number,
  maxUp = 2000,
): { line: number; commandText: string } | null {
  const buf = terminal.buffer.active;
  for (let y = fromLine; y >= Math.max(0, fromLine - maxUp); y--) {
    const raw = buf.getLine(y)?.translateToString(true) ?? "";
    if (!raw.trim()) continue;
    if (!looksLikePromptLine(raw)) continue;
    const stripped = stripPs1(raw).trim();
    if (!isPlausibleCommandText(stripped)) continue;
    return { line: y, commandText: stripped };
  }
  return null;
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

/** PromptPanel sets this when the shell-line mirror is unreliable. */
export function setUncoverLivePrompt(
  sessionId: string,
  uncover: boolean,
): void {
  const tracker = ensure(sessionId);
  if (tracker.uncoverLivePrompt === uncover) return;
  tracker.uncoverLivePrompt = uncover;
  syncChrome(sessionId);
}

export function getUncoverLivePrompt(sessionId: string): boolean {
  return trackers.get(sessionId)?.uncoverLivePrompt ?? false;
}

/**
 * Read the shell's current input line (after PS1 through end of line).
 * Used to mirror completions / history into the bottom input box.
 */
/** QA harness introspection — which mirror guard is active, marker rows. */
export function debugBlockState(sessionId: string): Record<string, unknown> {
  const tracker = trackers.get(sessionId);
  const terminal = getTerminalInstance(sessionId);
  return {
    hasTracker: Boolean(tracker),
    hasActive: Boolean(tracker?.active),
    bufferType: terminal?.buffer.active.type,
    promptLine: markerLine(tracker?.active?.prompt),
    commandLine: markerLine(tracker?.active?.command),
    promptDisposed: tracker?.active?.prompt.isDisposed,
    commandDisposed: tracker?.active?.command.isDisposed,
    openPrompt: markerLine(tracker?.open.promptStart),
    openCommand: markerLine(tracker?.open.commandStart),
    openOutput: markerLine(tracker?.open.outputStart),
    finished: tracker?.finished.length,
    pending: tracker?.pending.length,
    finishedDetail: tracker?.finished.map((b) => ({
      cmd: b.commandText,
      promptLine: markerLine(b.prompt) ?? null,
      endLine: markerLine(b.end) ?? null,
      exit: b.exitCode,
    })),
  };
}

export function readActiveShellInputLine(sessionId: string): string | null {
  const tracker = trackers.get(sessionId);
  const terminal = getTerminalInstance(sessionId);
  if (!tracker?.active || !terminal) return null;
  if (terminal.buffer.active.type === "alternate") return null;

  const commandLine =
    markerLine(tracker.active.command) ?? markerLine(tracker.active.prompt);

  const buf = terminal.buffer.active;
  const cursorAbs = buf.baseY + buf.cursorY;
  // Prefer the cursor's row when it's on/after the command marker. `clear`
  // disposes the active block's markers — the live prompt is wherever the
  // cursor is, so fall back to it instead of going dead until the next
  // prompt (typing looked broken after clear: keys reached the shell but
  // the input box mirrored nothing).
  const lineNo =
    commandLine == null
      ? cursorAbs
      : cursorAbs >= commandLine
        ? cursorAbs
        : commandLine;
  const bufLine = buf.getLine(lineNo);
  if (!bufLine) return null;

  // Trailing spaces are real input ("cd " before Tab) — read the untrimmed
  // row and keep everything up to the cursor column. translateToString(true)
  // ate the trailing space, which made Space look dead in the input box.
  const padded = bufLine.translateToString(false);
  const trimmedLen = padded.trimEnd().length;
  const upto =
    lineNo === cursorAbs
      ? Math.max(trimmedLen, Math.min(buf.cursorX, padded.length))
      : trimmedLen;
  const raw = padded.slice(0, upto);
  const head = raw.trimEnd();
  const trailing = raw.slice(head.length);

  const stripped = stripPs1(head);
  // Strip failed on a fancy/idle PS1 — don't mirror the prompt chrome.
  // (Also drops the PS1's own trailing space on an empty prompt.)
  if (!stripped) return "";
  if (stripped === head) {
    // No delimiter matched. Only accept if it looks like typed input
    // (has a command-ish token), not "~ ❯" / path crumbs alone.
    if (!/[a-zA-Z0-9./_-]/.test(stripped)) return "";
    if (/^~(?:\/\S*)?$/.test(stripped.trim())) return "";
  }
  return stripped + trailing;
}

export function getBlockChromeSnapshot(
  sessionId: string,
): BlockChromeSnapshot | undefined {
  const tracker = trackers.get(sessionId);
  if (!tracker) return undefined;

  const blocks: BlockChromeEntry[] = [];
  const seenPromptLines = new Set<number>();
  let disposedSeq = 0;

  for (const block of tracker.finished) {
    const commandText = block.commandText.trim();
    // Bare Enter / empty commands never get chrome. Input-box commands are
    // exact — heuristics (the directory-listing guard) must not veto them.
    if (!commandText) continue;
    if (!block.fromInput && !isPlausibleCommandText(commandText)) continue;

    let promptLine = markerLine(block.prompt);
    let commandLine = markerLine(block.command) ?? promptLine;
    let endLine = markerLine(block.end);
    if (promptLine == null || endLine == null) {
      // Markers die mid-session: `clear` disposes them, and scroll-region
      // output (apt/dpkg progress bars) deletes lines under them. Keep the
      // block — the overlay can still anchor its header by exact command
      // text match on a visible PS1 row. Unique negative sentinels keep
      // dedup/sort/bounds harmless (apt blocks lost their headers while ls
      // kept them — the "inconsistent" report).
      const sentinel = -100000 - disposedSeq++;
      promptLine = sentinel;
      commandLine = sentinel;
      endLine = sentinel;
    }
    if (seenPromptLines.has(promptLine)) continue;
    seenPromptLines.add(promptLine);

    blocks.push({
      id: block.id,
      kind:
        block.exitCode !== null && block.exitCode !== 0 ? "failed" : "ok",
      promptLine,
      commandLine: Math.max(promptLine, commandLine ?? promptLine),
      endLine,
      commandText,
      outputText: block.outputText,
      exitCode: block.exitCode,
      meta: block.meta,
      lineCount: block.lineCount,
    });
  }

  if (tracker.active) {
    const promptMarkerLine = markerLine(tracker.active.prompt);
    const commandMarkerLine = markerLine(tracker.active.command);
    const terminal = getTerminalInstance(sessionId);
    // Live block always tracks the cursor row — A/B markers often sit on an
    // earlier empty prompt line, which painted orphan "~ · 0s" headers.
    const cursorLine = terminal
      ? terminal.buffer.active.baseY + terminal.buffer.active.cursorY
      : undefined;
    const composingNow = !tracker.open.outputStart;
    // Composing/idle: the live block tracks the CURSOR row (A/B markers
    // often sit on an earlier empty prompt line — orphan headers).
    // RUNNING: the cursor lives inside the command's output — a TUI (claude
    // code, vim) parks it mid-screen and the header floated into the app's
    // UI. Anchor running blocks to the PROMPT MARKER only; if the app
    // overwrote that row, the overlay's prompt-shape guard drops the header
    // (the app owns the screen).
    const promptLine = composingNow
      ? (cursorLine ?? promptMarkerLine)
      : promptMarkerLine;
    const commandLine = composingNow
      ? (cursorLine ?? commandMarkerLine ?? promptLine)
      : (commandMarkerLine ?? promptLine);
    if (promptLine != null && commandLine != null) {
      // Composing (no OSC 133;C yet): the input box is the visible editor —
      // NEVER echo the in-progress typing into a styled header (it showed
      // the command twice: box + fake header). Once running, prefer the
      // command captured at outputStart; fall back to the PS1 row.
      const composing = composingNow;
      const liveCmd = composing
        ? ""
        : ((tracker.open.commandText ?? "").trim() ||
          (terminal
            ? (() => {
                const raw =
                  terminal.buffer.active
                    .getLine(promptLine)
                    ?.translateToString(true) ?? "";
                const stripped = stripPs1(raw).trim();
                return isPlausibleCommandText(stripped) ? stripped : "";
              })()
            : ""));
      blocks.push({
        id: "active",
        kind: "active",
        composing,
        promptLine,
        commandLine: Math.max(promptLine, commandLine),
        endLine: Math.max(promptLine, cursorLine ?? commandLine),
        commandText: liveCmd,
        outputText: "",
        exitCode: null,
        meta: tracker.active.meta,
        lineCount: Math.max(1, (cursorLine ?? commandLine) - promptLine + 1),
      });
    }
  }

  return {
    blocks,
    context: tracker.context,
    onRerun: tracker.onRerun,
    uncoverLivePrompt: tracker.uncoverLivePrompt,
    running: Boolean(tracker.active && tracker.open.outputStart),
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
  // Exactly ONE phase per flush op. Each op is enqueued right after the
  // data write that precedes its mark; the backend emits one flush per
  // phase, so counts pair 1:1. Draining the whole queue here applied later
  // phases against an EARLIER buffer state — under bursty output (apt,
  // restore replays) every block got attributed to the oldest prompt row.
  const item = tracker.pending.shift();
  if (!item) return;
  applyPhase(sessionId, terminal, tracker, item.phase, item.exitCode);
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
    case "promptStart": {
      // Always mark the cursor row. The old "empty line → offset -1" heuristic
      // landed on the previous output row, so the real PS1 stayed uncovered.
      const marker = terminal.registerMarker(0);
      if (!marker) return;
      const meta: BlockMeta = {
        cwd: getTerminalCwd(sessionId),
        gitBranch: getTerminalGitBranch(sessionId),
        startedAt: Date.now(),
      };
      tracker.open.promptStart = marker;
      tracker.open.meta = meta;
      // Provisional active: cover PS1 from the first OSC 133;A.
      tracker.active = { prompt: marker, command: marker, meta };
      break;
    }
    case "commandStart": {
      const marker = terminal.registerMarker(0);
      if (!marker) return;
      const prompt = tracker.open.promptStart ?? marker;
      const meta: BlockMeta = tracker.open.meta ?? {
        cwd: getTerminalCwd(sessionId),
        gitBranch: getTerminalGitBranch(sessionId),
        startedAt: Date.now(),
      };
      tracker.active = { prompt, command: marker, meta };
      tracker.open = {
        promptStart: prompt,
        commandStart: marker,
        meta,
      };
      break;
    }
    case "outputStart": {
      const cursorMarker = terminal.registerMarker(0);
      if (!cursorMarker) return;
      // Prefer scanning the live buffer — more reliable than A/B markers
      // which often land before PS1 is painted.
      const found = findCommandAboveCursor(terminal);
      recordPhaseLog(terminal, "C", found);
      // The submitted line from the input box outranks buffer scanning —
      // the scan races tmux redraws (bytes still in flight at phase time)
      // and grabbed OLD prompt rows, labeling apt blocks "ls".
      const submitted = takeSubmittedCommand(sessionId);
      let commandText = submitted ?? found?.commandText ?? "";
      if (submitted) {
        tracker.open.commandFromInput = true;
      }
      let prompt = tracker.open.promptStart;
      let command = tracker.open.commandStart;

      // Rebinding to a scanned row is only safe when that row actually shows
      // THIS command — with in-flight redraw bytes the scan can return an
      // older prompt row, and rebinding there mislabeled/misplaced blocks.
      const foundMatchesCommand =
        found != null &&
        (submitted == null ||
          found.commandText === submitted ||
          found.commandText.startsWith(`${submitted} `));
      if (found && foundMatchesCommand) {
        const rebound = markerAtLine(terminal, found.line);
        if (rebound) {
          // Replace drifted A/B markers with the real PS1 row.
          if (prompt && prompt !== rebound) prompt.dispose();
          if (command && command !== prompt && command !== rebound) {
            command.dispose();
          }
          prompt = rebound;
          command = rebound;
          tracker.open.promptStart = rebound;
          tracker.open.commandStart = rebound;
          if (tracker.active) {
            tracker.active = {
              prompt: rebound,
              command: rebound,
              meta: tracker.active.meta,
            };
          }
        }
      }
      if (!commandText) {
        commandText = extractCommandLine(
          terminal,
          tracker.open.commandStart,
          tracker.open.promptStart,
        );
      }
      tracker.open.outputStart = cursorMarker;
      tracker.open.commandText = commandText;
      break;
    }
    case "commandEnd": {
      const end = terminal.registerMarker(0);
      if (!end) return;
      let command = tracker.open.commandStart ?? end;
      let prompt = tracker.open.promptStart ?? command;
      const outputStart = tracker.open.outputStart;
      // Prefer text captured at outputStart — re-reading markers after the
      // cursor advanced can land on the first output row (styled dup bug).
      let commandText = (tracker.open.commandText ?? "").trim();
      if (!tracker.open.commandFromInput) {
        // The C-time scan raced in-flight redraw bytes and could return an
        // OLDER prompt row (apt blocks labeled "ls"). Now the output has
        // settled: the first prompt row above the end IS this command's row —
        // re-derive text and re-anchor markers from it.
        const settled = findFirstPromptRowAbove(terminal, end.line - 1);
        recordPhaseLog(terminal, `D@${end.line}`, settled);
        if (settled) {
          commandText = settled.commandText;
          const rebound = markerAtLine(terminal, settled.line);
          if (rebound) {
            if (prompt !== rebound && prompt !== end) prompt.dispose();
            if (command !== rebound && command !== prompt && command !== end) {
              command.dispose();
            }
            prompt = rebound;
            command = rebound;
          }
        }
      }
      if (!commandText) {
        const found = findCommandAboveCursor(terminal);
        commandText = found?.commandText ?? "";
      }
      if (!commandText) {
        commandText = extractCommandLine(terminal, command, prompt).trim();
      }
      const outputText = textBetween(terminal, outputStart, end);

      // Remote latency: markers sometimes land on the first output row, so
      // commandText equals that row (e.g. ls → "test"). Prefer the PS1 row.
      // Skip entirely when the text came from the input box — it is exact,
      // and this guard would blank it (e.g. `ls` listing a file named "ls").
      const outFirst = outputText.trim().split("\n")[0]?.trim() ?? "";
      if (
        !tracker.open.commandFromInput &&
        commandText &&
        outFirst === commandText &&
        !/[\s|;&<>]/.test(commandText)
      ) {
        const fromPs1 = extractCommandLine(terminal, prompt, prompt);
        if (fromPs1 && fromPs1 !== commandText) {
          commandText = fromPs1;
        } else {
          const found = findCommandAboveCursor(terminal);
          if (found && found.commandText !== commandText) {
            commandText = found.commandText;
          } else {
            commandText = "";
          }
        }
      }

      tracker.active = undefined;
      recordOpLog(
        "Dend",
        `cmd=${JSON.stringify(commandText)} fromInput=${Boolean(
          tracker.open.commandFromInput,
        )} plausible=${isPlausibleCommandText(commandText)}`,
      );

      const fromInput = Boolean(tracker.open.commandFromInput);
      if (
        !commandText ||
        (!fromInput && !isPlausibleCommandText(commandText))
      ) {
        // Bare Enter — no block, no header.
        prompt.dispose();
        if (command !== prompt) command.dispose();
        end.dispose();
        outputStart?.dispose();
        tracker.open = {};
        break;
      }

      const lineCount = Math.max(1, end.line - prompt.line + 1);
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
        prompt,
        command,
        end,
        fromInput,
        commandText,
        outputText,
        exitCode,
        meta,
        lineCount,
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
  // Output starts on the line *after* the command when they share a marker
  // boundary; include from outputStart as registered.
  const lines: string[] = [];
  for (let y = from; y <= to; y++) {
    const line = terminal.buffer.active.getLine(y);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join("\n").trim();
}

function disposeFinished(block: FinishedBlock | undefined): void {
  if (!block) return;
  block.prompt.dispose();
  block.command.dispose();
  block.end.dispose();
}

export function disposeBlockTracker(sessionId: string): void {
  const tracker = trackers.get(sessionId);
  if (!tracker) return;
  tracker.active = undefined;
  for (const block of tracker.finished) disposeFinished(block);
  tracker.open.promptStart?.dispose();
  tracker.open.commandStart?.dispose();
  tracker.open.outputStart?.dispose();
  trackers.delete(sessionId);
  blockListeners.delete(sessionId);
  disposeBlockOverlay(sessionId);
}

/** Agent CLIs whose bells legitimately mean "the agent needs you". */
const AGENT_COMMAND_RE =
  /^(claude|codex|gemini|agy|opencode|aider)(\s|$)/;

/**
 * True when the session's currently-running command is a known agent CLI.
 * Used to gate BEL-based attention: a shell's tab-completion bell must never
 * raise the "Waiting for you" banner — only a real agent's bell may.
 */
export function sessionRunsAgentCommand(sessionId: string): boolean {
  const tracker = trackers.get(sessionId);
  if (!tracker?.active) return false;
  const cmd = (tracker.open.commandText ?? "").trim();
  return AGENT_COMMAND_RE.test(cmd);
}

/**
 * True while a command is executing in the session (OSC 133 C seen, no D
 * yet). Replaces alt-screen sniffing for input routing: with tmux drawing
 * inline (smcup disabled) the outer terminal never enters the alternate
 * screen, so this is the reliable "keys belong to the running app" signal.
 */
export function sessionHasRunningCommand(sessionId: string): boolean {
  const tracker = trackers.get(sessionId);
  return Boolean(tracker?.active && tracker.open.outputStart);
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
  const finished = tracker.finished.filter((b) => b.commandText.trim()).length;
  return finished + (tracker.active ? 1 : 0);
}
