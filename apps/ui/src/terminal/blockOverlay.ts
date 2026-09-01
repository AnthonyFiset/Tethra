import type { Terminal } from "@xterm/xterm";
import { writeClipboardText } from "../lib/ipc";
import { armShellInjectGate } from "./inject";
import type { BlockChromeSnapshot, BlockChromeEntry } from "./blocks";
import { getBlockChromeSnapshot, sessionScreenApp } from "./blocks";
import {
  BLOCK_COLORS,
  formatBlockTime,
  formatDuration,
  shortenPath,
} from "./blockChrome";
import { requestBlockMenu } from "./blockMenuBridge";

interface OverlayHost {
  root: HTMLElement;
  terminal: Terminal;
  disposables: { dispose(): void }[];
}

const hosts = new Map<string, OverlayHost>();
const pendingSync = new Map<string, number>();

/** Right pad for hover action cluster. */
const ACTIONS_WIDTH = 108;
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
  disposables.push(
    terminal.onScroll(() => scheduleBlockOverlaySync(sessionId)),
  );
  disposables.push(
    terminal.onResize(() => scheduleBlockOverlaySync(sessionId)),
  );
  disposables.push(
    terminal.onRender(() => scheduleBlockOverlaySync(sessionId)),
  );
  disposables.push(
    terminal.buffer.onBufferChange(() => scheduleBlockOverlaySync(sessionId)),
  );

  hosts.set(sessionId, { root, terminal, disposables });
  scheduleBlockOverlaySync(sessionId);
}

export function scheduleBlockOverlaySync(sessionId: string): void {
  if (!hosts.has(sessionId)) return;
  // Pre-paint coalescing: a microtask runs before the browser paints the
  // frame xterm just rendered, so covers/headers land in the SAME paint.
  // rAF ran a frame later and flashed raw PS1/output for ~16ms on every
  // write burst (visible on ls and on session attach).
  if (pendingSync.has(sessionId)) return;
  pendingSync.set(sessionId, 1);
  queueMicrotask(() => {
    pendingSync.delete(sessionId);
    syncBlockOverlay(sessionId);
  });
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
        _renderService?: {
          dimensions?: { css?: { cell?: { height?: number } } };
        };
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
  // Always derive height from the measured cell — never trust a DOM row's
  // getBoundingClientRect().height alone (WebGL/odd layouts returned the
  // full screen height, so opaque PS1 covers blanked all remote output).
  const height = cellH > 0 ? cellH : 16;

  const rows = terminal.element?.querySelector(".xterm-rows");
  const row = rows?.children.item(rel) as HTMLElement | null;
  if (row) {
    const rowRect = row.getBoundingClientRect();
    if (rowRect.height > 0) {
      // Use the row's top for alignment, but never its height if it's > 2 cells.
      const safeH = rowRect.height <= height * 2 ? rowRect.height : height;
      return {
        top: rowRect.top - rootRect.top,
        height: safeH,
        left: rowRect.left - rootRect.left,
        width: rowRect.width,
      };
    }
  }

  const screen = terminal.element?.querySelector(
    ".xterm-screen",
  ) as HTMLElement | null;
  if (!screen) return null;
  const screenRect = screen.getBoundingClientRect();
  return {
    top: screenRect.top - rootRect.top + rel * height,
    height,
    left: screenRect.left - rootRect.left,
    width: screenRect.width,
  };
}

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

  // Alt-screen / TUI (Claude Code, Codex, vim…): the app owns every cell.
  // No headers, no covers, no blanking — chrome floated into its UI.
  if (sessionScreenApp(sessionId)) return;

  const buf = terminal.buffer.active;
  const viewportStart = buf.viewportY;
  const viewportEnd = buf.viewportY + terminal.rows - 1;

  // Collect viewport PS1 rows once, then assign each block an exclusive cover
  // line. Only *strict* prompt rows — never "~" alone or arbitrary "#"/">" hits.
  const promptRows: { y: number; cmd: string }[] = [];
  for (let y = viewportStart; y <= viewportEnd; y++) {
    const raw = buf.getLine(y)?.translateToString(true) ?? "";
    if (!raw.trim()) continue;
    if (!lineLooksLikePrompt(raw)) continue;
    const cmd = stripPs1Local(raw).trim();
    promptRows.push({ y, cmd });
  }
  const usedRows = new Set<number>();

  for (const block of snapshot.blocks) {
    const coverLine = pickExclusiveCoverLine(
      terminal,
      block,
      snapshot,
      promptRows,
      usedRows,
    );
    // No confident cover → no chrome (never paint over output).
    renderBlock(root, terminal, block, snapshot, coverLine);
  }

  // Raw "root@host:~#" rows leak between styled blocks whenever their
  // covers die: bash tab-completion reprints the PS1, tmux redraws restore
  // old prompt lines, and `clear` DISPOSES block markers so finished
  // blocks' chrome vanishes mid-session (the "shows all the details"
  // glitch during apt). Blank every unused STRICT prompt row across the
  // whole viewport, composing or running — output rows are safe: only
  // user@host / ornament-~ prompt shapes qualify.
  const activeBlock = snapshot.blocks.find((b) => b.kind === "active");
  if (activeBlock && !snapshot.running && !snapshot.uncoverLivePrompt) {
    const from = viewportStart;
    for (let y = from; y <= viewportEnd; y++) {
      if (usedRows.has(y)) continue;
      const raw = buf.getLine(y)?.translateToString(true) ?? "";
      if (!raw.trim()) continue;
      if (!strictPromptRow(raw)) continue;
      const rect = lineRect(terminal, root, y);
      if (!rect) continue;
      usedRows.add(y);
      const blank = document.createElement("div");
      blank.className = "tethra-block-overlay-blank";
      blank.style.top = `${rect.top}px`;
      blank.style.height = `${rect.height}px`;
      applyHorizontal(blank, rect.left, rect.width);
      root.appendChild(blank);
    }
  }
}

/**
 * Much stricter than lineLooksLikePrompt: only unmistakable PS1 shapes.
 * Used for blanking — a false positive here would hide real output, so
 * the loose "glyph somewhere in the head" branch is deliberately absent
 * (ls -l symlink arrows contain ">" and must never be blanked).
 */
function strictPromptRow(raw: string): boolean {
  const t = raw.trimEnd();
  if (!t) return false;
  if (/^[\w.-]+@[\w.-]+:[^\s]*[#\$](?:\s|$)/.test(t)) return true;
  if (/^[\w.-]+@[\w.-]+[^\n]{0,60}[$#%❯](?:\s|$)/.test(t)) return true;
  const line = t.replace(/^[·•∙▲▶►▸☛➢✩★◆◇○●]\s*/u, "").trimStart();
  if (/^~(?:\/\S*)?\s*[$#%❯>]?\s*$/.test(line)) return true;
  // "~ ❯ ls" style (path + glyph + short typed text) — the glyph is required,
  // so multi-column output rows never qualify.
  if (/^~(?:\/\S*)?\s+[$#%❯]\s+\S[^\n]{0,160}$/.test(line)) return true;
  return false;
}

/**
 * Pick a unique viewport row for this block's opaque PS1 cover.
 */
function pickExclusiveCoverLine(
  terminal: Terminal,
  block: BlockChromeEntry,
  snapshot: BlockChromeSnapshot,
  promptRows: { y: number; cmd: string }[],
  usedRows: Set<number>,
): number | null {
  const isActive = block.kind === "active";
  if (isActive && snapshot.uncoverLivePrompt) return null;

  const cmd = block.commandText.trim();
  const buf = terminal.buffer.active;
  const viewportStart = buf.viewportY;
  const viewportEnd = buf.viewportY + terminal.rows - 1;

  const tryTake = (y: number | null | undefined): number | null => {
    if (y == null || y < viewportStart || y > viewportEnd) return null;
    if (usedRows.has(y)) return null;
    usedRows.add(y);
    return y;
  };

  // 1) Exact command match on an unused prompt row nearest the marker.
  // The CURSOR row always belongs to the live prompt: a finished block
  // matching it (user retyping a previous command) painted its header over
  // the text being typed — the box appeared to "type into the terminal".
  const cursorAbs = buf.baseY + buf.cursorY;
  if (cmd && (isActive || !snapshot.running)) {
    const prefer = block.promptLine;
    const matches = promptRows.filter(
      (r) =>
        !usedRows.has(r.y) &&
        (isActive || r.y !== cursorAbs) &&
        (r.cmd === cmd || r.cmd.startsWith(`${cmd} `)),
    );
    matches.sort((a, b) => Math.abs(a.y - prefer) - Math.abs(b.y - prefer));
    if (matches[0]) return tryTake(matches[0].y);
  }

  // 2) Active idle: cover the cursor/marker row.
  if (isActive && !cmd) {
    return tryTake(block.commandLine) ?? tryTake(block.promptLine) ?? null;
  }

  // 3) Active with command but theme strip failed — cover marker if unused
  // and the row is still prompt-shaped.
  if (isActive && cmd) {
    for (const y of [block.commandLine, block.promptLine]) {
      const raw = buf.getLine(y)?.translateToString(true) ?? "";
      if (!lineLooksLikePrompt(raw)) continue;
      if (raw.includes(cmd)) {
        const taken = tryTake(y);
        if (taken != null) return taken;
      }
    }
  }

  // 4) Finished: marker row only if it still shows this command *and*
  // looks like a PS1 (never cover an output row that equals the command text,
  // e.g. ls of a single dir named "test").
  if (cmd) {
    for (const y of [block.commandLine, block.promptLine]) {
      if (y < viewportStart || y > viewportEnd || usedRows.has(y)) continue;
      if (!isActive && y === cursorAbs) continue;
      const raw = buf.getLine(y)?.translateToString(true) ?? "";
      if (!lineLooksLikePrompt(raw)) continue;
      const stripped = stripPs1Local(raw).trim();
      if (stripped === cmd || stripped.startsWith(`${cmd} `)) {
        return tryTake(y);
      }
    }
  }

  return null;
}

function applyHorizontal(el: HTMLElement, left: number, width: number): void {
  el.style.left = `${left}px`;
  el.style.width = `${width}px`;
  el.style.right = "auto";
}

function stripPs1Local(raw: string): string {
  let line = raw.replace(/^[·•∙▲▶►▸☛➢✩★◆◇○●]\s*/u, "").trimStart();
  line = line.replace(/^[·•∙▲▶►▸☛➢✩★◆◇○●]\s*/u, "").trimStart();

  const classic = line.match(/^[\w.-]+@[\w.-]+:[^\s]*[#\$]\s*(.*)$/);
  if (classic) return (classic[1] ?? "").trim();

  const userHost = line.match(
    /^[\w.-]+@[\w.-]+\s+[^\n]*?[$#%>❯➢➤›»⟩〉➜⇒→▶]\s*(.*)$/,
  );
  if (userHost) return (userHost[1] ?? "").trim();

  if (/[$#%>❯➢➤›»⟩〉➜⇒→▶]/.test(line.slice(0, 80))) {
    const head = line.slice(0, 80);
    const tail = line.slice(80);
    line = head.replace(/^.*?[$#%>❯➢➤›»⟩〉➜⇒→▶] ?/, "") + tail;
    const pathPref = line.match(/^~(?:\/\S*)? (.*)$/);
    if (pathPref) return (pathPref[1] ?? "").trim();
    return line.trim();
  }
  const pathPref = line.match(/^~(?:\/\S*)? (.*)$/);
  if (pathPref) return (pathPref[1] ?? "").trim();
  const homeCmd = raw.match(/~(?:\/\S*)?\s+(\S.*)$/);
  if (homeCmd) return (homeCmd[1] ?? "").trim();
  return line.trim();
}

function lineLooksLikePrompt(raw: string): boolean {
  const t = raw.trimEnd();
  if (!t) return false;
  if (/^[\w.-]+@[\w.-]+:[^\s]*[#\$](?:\s|$)/.test(t)) return true;
  if (/^[\w.-]+@[\w.-]+.*[$#%>❯➢➤›»⟩〉➜⇒→▶](?:\s|$)/.test(t)) return true;
  const line = t.replace(/^[·•∙▲▶►▸☛➢✩★◆◇○●]\s*/u, "").trimStart();
  if (/^~(?:\/\S*)?$/.test(line.trim())) return true;
  if (
    /^~(?:\/\S*)?\s+/.test(line) &&
    /[$#%>❯➢➤›»⟩〉➜⇒→▶]/.test(t.slice(0, 80))
  ) {
    return true;
  }
  if (/^~(?:\/\S*)?\s+\S/.test(line) && line.split(/\s+/).length <= 6) {
    return true;
  }
  const head = t.slice(0, 80);
  if (/[$#%>❯➢➤›»⟩〉➜⇒→▶]/.test(head) && t.length < 200) return true;
  return false;
}

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
  coverLine: number | null,
): void {
  const isActive = block.kind === "active";
  const hasCommand = Boolean(block.commandText.trim());

  const cover =
    coverLine == null
      ? null
      : clampedFrame(terminal, root, coverLine, coverLine);

  // Composing (typing in the input box, command not running yet): the block
  // snapshot already reports an EMPTY commandText, so the styled header
  // renders as a bare prompt row — no double echo of typed text. Rendering
  // the header (instead of a pure blank cover, as before) means the live
  // prompt is always visibly styled: after `clear` the screen shows one
  // Warp-style prompt block instead of going completely black.

  // Warp: elevated tint on the cover row only — never span prompt→end
  // (that painted a veil over remote command output when markers drifted).
  if (cover && isActive) {
    const tint = document.createElement("div");
    tint.className = "tethra-block-overlay-tint";
    tint.style.top = `${cover.top}px`;
    tint.style.height = `${cover.height}px`;
    applyHorizontal(tint, cover.left, Math.max(48, cover.width - 4));
    root.appendChild(tint);
  }

  // Don't paint meta-only chrome for finished blocks (defensive).
  // Active idle prompt still gets an opaque cover so raw PS1 stays hidden.
  // Hard-cap height to ~1.5 cells so a bad layout never blankets output.
  if (cover) {
    if (!hasCommand && !isActive) {
      // skip
    } else {
      const cellCap = Math.max(cover.height, 8) * 1.5;
      const group = document.createElement("div");
      group.className = "tethra-block-chrome-group";
      group.style.top = `${cover.top}px`;
      group.style.height = `${Math.min(cover.height, cellCap)}px`;
      group.style.maxHeight = `${cellCap}px`;
      group.style.overflow = "hidden";
      applyHorizontal(group, cover.left, cover.width);

      const header = buildHeader(block, isActive);
      header.style.position = "absolute";
      header.style.inset = "0";
      group.appendChild(header);

      if (hasCommand || isActive) {
        const actions = buildActionCluster(
          block,
          snapshot,
          hasCommand,
          isActive,
        );
        actions.style.top = `${Math.max(0, (cover.height - 22) / 2)}px`;
        actions.style.right = "4px";
        actions.style.left = "auto";
        group.appendChild(actions);
      }
      root.appendChild(group);
    }
  }

  if (isActive && snapshot.context.waiting) {
    const contentLine = lastContentLine(
      terminal,
      block.promptLine,
      block.endLine,
    );
    const contentRect = lineRect(terminal, root, contentLine);
    const endRect = lineRect(terminal, root, block.endLine);
    const prompt = lineRect(terminal, root, block.promptLine);
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
        const left = prompt?.left ?? cover?.left ?? 0;
        const width = prompt?.width ?? cover?.width ?? root.clientWidth;
        banner.style.left = `${left}px`;
        banner.style.width = `${Math.max(120, width - ACTIONS_WIDTH - 10)}px`;
        banner.style.right = "auto";
        root.appendChild(banner);
      }
    }
  }
}

/**
 * Warp anatomy: one row — dim meta · bold command.
 * Must fit a single cell height so the opaque cover fully hides PS1.
 */
function buildHeader(block: BlockChromeEntry, isActive: boolean): HTMLElement {
  const header = document.createElement("div");
  header.className = "tethra-block-overlay-header";

  const metaBits: string[] = [];
  const path = shortenPath(block.meta.cwd);
  if (path) metaBits.push(path);
  if (block.meta.gitBranch) metaBits.push(block.meta.gitBranch);
  if (isActive) {
    const elapsed = block.meta.startedAt
      ? formatDuration(Date.now() - block.meta.startedAt)
      : null;
    if (elapsed) metaBits.push(elapsed);
  } else if (block.exitCode != null && block.exitCode !== 0) {
    metaBits.push(`exit ${block.exitCode}`);
    if (block.meta.endedAt && block.meta.startedAt) {
      metaBits.push(formatDuration(block.meta.endedAt - block.meta.startedAt));
    }
    if (block.meta.endedAt) metaBits.push(formatBlockTime(block.meta.endedAt));
  } else if (block.meta.endedAt && block.meta.startedAt) {
    metaBits.push(formatDuration(block.meta.endedAt - block.meta.startedAt));
    metaBits.push(formatBlockTime(block.meta.endedAt));
  }

  if (metaBits.length > 0) {
    const meta = document.createElement("span");
    meta.className = "tethra-block-header-meta-line";
    meta.textContent = metaBits.join(" · ");
    header.appendChild(meta);
  }

  const command = (block.commandText || "").trim();
  if (command) {
    const cmdWrap = document.createElement("span");
    cmdWrap.className = "tethra-block-header-cmd";
    const mark = document.createElement("span");
    mark.className = isActive
      ? "tethra-block-header-prompt is-active"
      : block.exitCode != null && block.exitCode !== 0
        ? "tethra-block-header-prompt is-failed"
        : "tethra-block-header-prompt is-ok";
    mark.textContent = "❯";
    const cmd = document.createElement("span");
    cmd.className = "tethra-block-header-cmd-text";
    cmd.textContent = command;
    cmd.title = command;
    cmdWrap.appendChild(mark);
    cmdWrap.appendChild(cmd);
    header.appendChild(cmdWrap);
  } else if (isActive) {
    // Bare live prompt (idle or composing in the input box): show the prompt
    // glyph so the row reads as "ready" — never an empty black row.
    const cmdWrap = document.createElement("span");
    cmdWrap.className = "tethra-block-header-cmd";
    const mark = document.createElement("span");
    mark.className = "tethra-block-header-prompt is-active";
    mark.textContent = "❯";
    cmdWrap.appendChild(mark);
    header.appendChild(cmdWrap);
  }

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
    "Waiting for you — the agent needs your input";
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

/** Inline hover actions: copy · share · re-run · ⋮ (Radix menu for the rest). */
function buildActionCluster(
  block: BlockChromeEntry,
  snapshot: BlockChromeSnapshot,
  hasCommand: boolean,
  isActive: boolean,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = isActive
    ? "tethra-block-actions-cluster is-active"
    : "tethra-block-actions-cluster";

  function iconBtn(
    label: string,
    glyph: string,
    run: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tethra-block-action-btn";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.textContent = glyph;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      run();
    });
    return btn;
  }

  if (hasCommand) {
    wrap.appendChild(
      iconBtn("Copy command", "⧉", () => {
        void writeClipboardText(block.commandText || "");
      }),
    );
    wrap.appendChild(
      iconBtn("Share block", "↗", () => {
        void writeClipboardText(
          [block.commandText, block.outputText].filter(Boolean).join("\n\n"),
        );
      }),
    );
    wrap.appendChild(
      iconBtn("Re-run", "↻", () => {
        if (!block.commandText) return;
        armShellInjectGate();
        snapshot.onRerun?.(block.commandText);
      }),
    );
  }

  const more = iconBtn("More", "⋯", () => {
    const rect = more.getBoundingClientRect();
    requestBlockMenu({
      anchorX: rect.right,
      anchorY: rect.bottom,
      block,
      snapshot,
    });
  });
  // pointerdown: fires before outside-dismiss / xterm capture races.
  more.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = more.getBoundingClientRect();
    requestBlockMenu({
      anchorX: rect.right,
      anchorY: rect.bottom,
      block,
      snapshot,
    });
  });
  wrap.appendChild(more);

  return wrap;
}

// Keep color constants referenced so tree-shaking doesn't drop the module export use.
void BLOCK_COLORS;
