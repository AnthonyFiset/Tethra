import { useEffect, useRef, useState } from "react";
import { Folder, GitBranch } from "lucide-react";
import { sendTerminalInput } from "../lib/ipc";
import { cn } from "../lib/cn";
import {
  blockCount,
  readActiveShellInputLine,
  sessionHasRunningCommand,
  setUncoverLivePrompt,
  subscribeBlockChanges,
} from "../terminal/blocks";
import {
  focusTerminal,
  getTerminalInstance,
} from "../terminal/registry";
import { scheduleBlockOverlaySync } from "../terminal/blockOverlay";

interface PromptPanelProps {
  sessionId: string;
  /** When true, this panel is the default typing target. */
  active?: boolean;
  cwd?: string;
  gitBranch?: string;
  meta?: string;
}

const encoder = new TextEncoder();

/** Map a keyboard event to raw PTY bytes (xterm-compatible). */
function encodeKeyToPty(event: KeyboardEvent): Uint8Array | null {
  if (event.isComposing) return null;
  // App chords (⌘K, ⌘F, …) stay with the UI.
  if (event.metaKey) return null;

  if (event.ctrlKey && !event.altKey) {
    const k = event.key.length === 1 ? event.key.toLowerCase() : "";
    if (k >= "a" && k <= "z") {
      return new Uint8Array([k.charCodeAt(0) - 96]);
    }
    if (event.key === "Enter") return new Uint8Array([0x0a]); // LF
    return null;
  }

  switch (event.key) {
    case "Enter":
      return new Uint8Array([0x0d]);
    case "Backspace":
      return new Uint8Array([0x7f]);
    case "Tab":
      return new Uint8Array([0x09]);
    case "Escape":
      return new Uint8Array([0x1b]);
    case "ArrowUp":
      return encoder.encode("\x1b[A");
    case "ArrowDown":
      return encoder.encode("\x1b[B");
    case "ArrowRight":
      return encoder.encode("\x1b[C");
    case "ArrowLeft":
      return encoder.encode("\x1b[D");
    case "Home":
      return encoder.encode("\x1b[H");
    case "End":
      return encoder.encode("\x1b[F");
    case "Delete":
      return encoder.encode("\x1b[3~");
    case "PageUp":
      return encoder.encode("\x1b[5~");
    case "PageDown":
      return encoder.encode("\x1b[6~");
    default:
      if (event.key.length === 1) return encoder.encode(event.key);
      return null;
  }
}

/**
 * Warp-style session input: every keystroke is forwarded live to the PTY.
 * The box mirrors the shell's own input line (OSC 133 prompt → cursor) so
 * Tab completion and history appear here. No divergent local draft.
 *
 * Fallback (if mirror stays empty after live keys): uncover the live PS1
 * and show a caret-only box — see `uncover` state.
 */
export function PromptPanel({
  sessionId,
  active = true,
  cwd,
  gitBranch,
  meta,
}: PromptPanelProps): React.JSX.Element {
  const [blocks, setBlocks] = useState(() => blockCount(sessionId));
  const [mirror, setMirror] = useState("");
  /**
   * Optimistic local echo: printable keys render immediately instead of
   * waiting for the remote shell's echo (a full network round trip on SSH).
   * `base` is the mirror value the prediction started from; as echoed
   * characters arrive they consume the predicted prefix.
   */
  const [pending, setPending] = useState("");
  const pendingBase = useRef("");
  /** Consecutive refreshes where the shell line contradicted the prediction. */
  const pendingMismatches = useRef(0);
  const mirrorRef = useRef("");
  const [interactive, setInteractive] = useState(false);
  /** A command is executing (OSC 133 C..D) — keys belong to it. */
  const [runningCmd, setRunningCmd] = useState(() =>
    sessionHasRunningCommand(sessionId),
  );
  /** Mirror failed → uncover live PS1; box is caret-only. */
  const [uncover, setUncover] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const uncoverRef = useRef(false);
  uncoverRef.current = uncover;
  const mirrorMisses = useRef(0);
  const forwardedSinceMirror = useRef(0);
  /** True when last forward was an edit key (not Enter/arrows that clear the line). */
  const lastForwardWasEdit = useRef(false);

  useEffect(() => {
    setBlocks(blockCount(sessionId));
    setMirror("");
    mirrorRef.current = "";
    setPending("");
    pendingBase.current = "";
    setUncover(false);
    uncoverRef.current = false;
    mirrorMisses.current = 0;
    lastForwardWasEdit.current = false;
    setUncoverLivePrompt(sessionId, false);
    setRunningCmd(sessionHasRunningCommand(sessionId));
    return subscribeBlockChanges(sessionId, () => {
      setBlocks(blockCount(sessionId));
      setRunningCmd(sessionHasRunningCommand(sessionId));
    });
  }, [sessionId]);

  useEffect(() => {
    const terminal = getTerminalInstance(sessionId);
    if (!terminal) {
      setInteractive(false);
      return;
    }
    const sync = () => {
      // Alt-screen only happens for non-tmux flows now; tmux draws inline
      // (smcup disabled), so running-command state carries the signal.
      setInteractive(terminal.buffer.active.type === "alternate");
    };
    sync();
    const sub = terminal.buffer.onBufferChange(() => sync());
    return () => sub.dispose();
  }, [sessionId]);

  const busyWithApp = interactive || runningCmd;

  function refreshMirror(): void {
    if (uncoverRef.current) {
      setMirror("");
      return;
    }
    const line = readActiveShellInputLine(sessionId);
    if (line == null) {
      mirrorRef.current = "";
      setMirror("");
      setPending("");
      pendingBase.current = "";
      return;
    }
    // Reconcile prediction: echoed characters consume the predicted prefix;
    // anything the shell echoed differently (completion, control) drops the
    // remaining prediction — the shell's line is always the truth. A SINGLE
    // mismatched refresh is not proof though: shell/tmux redraws transiently
    // rewrite the row mid-echo, and dropping instantly made typed characters
    // vanish-then-reappear (the "glitches while typing" report). Keep the
    // prediction for one grace refresh before surrendering.
    setPending((chars) => {
      if (!chars) {
        pendingBase.current = line;
        pendingMismatches.current = 0;
        return chars;
      }
      const base = pendingBase.current;
      if (line.startsWith(base)) {
        const echoed = line.slice(base.length);
        if (chars.startsWith(echoed)) {
          pendingBase.current = line;
          pendingMismatches.current = 0;
          return chars.slice(echoed.length);
        }
      }
      if (pendingMismatches.current < 1) {
        pendingMismatches.current += 1;
        return chars;
      }
      pendingBase.current = line;
      pendingMismatches.current = 0;
      return "";
    });
    mirrorRef.current = line;
    setMirror(line);
    if (forwardedSinceMirror.current > 0) {
      // Empty after Enter/arrows is expected — do not trip uncover fallback.
      if (!lastForwardWasEdit.current) {
        mirrorMisses.current = 0;
      } else if (line.length === 0 && forwardedSinceMirror.current >= 2) {
        mirrorMisses.current += 1;
      } else if (line.length > 0) {
        mirrorMisses.current = 0;
      }
      forwardedSinceMirror.current = 0;
      if (mirrorMisses.current >= 3) {
        uncoverRef.current = true;
        setUncover(true);
        setUncoverLivePrompt(sessionId, true);
        setMirror("");
        scheduleBlockOverlaySync(sessionId);
      }
    }
  }

  // Keep mirror synced to shell output / cursor motion.
  useEffect(() => {
    const terminal = getTerminalInstance(sessionId);
    if (!terminal || busyWithApp) return;
    const tick = () => refreshMirror();
    const d1 = terminal.onRender(() => tick());
    const d2 = terminal.onWriteParsed(() => tick());
    const id = window.setInterval(tick, 200);
    tick();
    return () => {
      d1.dispose();
      d2.dispose();
      window.clearInterval(id);
    };
    // uncover/interactive toggle rebind
  }, [sessionId, busyWithApp, uncover]);

  /** Optimistic echo for the box only — the shell's echo reconciles it. */
  function predictKey(event: KeyboardEvent): void {
    if (uncoverRef.current || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key.length === 1) {
      setPending((p) => {
        if (!p) pendingBase.current = mirrorRef.current;
        return p + event.key;
      });
    } else if (event.key === "Backspace") {
      setPending((p) => (p ? p.slice(0, -1) : p));
    } else {
      // Tab / Enter / arrows / Escape — the shell rewrites the line.
      setPending("");
      pendingBase.current = mirrorRef.current;
    }
  }

  async function forwardBytes(
    data: Uint8Array,
    opts?: { edit?: boolean },
  ): Promise<void> {
    forwardedSinceMirror.current += 1;
    lastForwardWasEdit.current = Boolean(opts?.edit);
    try {
      await sendTerminalInput(sessionId, data, { force: true });
    } catch {
      // leave mirror; shell state unchanged
    }
    requestAnimationFrame(() => refreshMirror());
  }

  // Leaving the session (home view hides the pane): release focus so the
  // hidden pane never traps it behind aria-hidden.
  useEffect(() => {
    if (active) return;
    if (document.activeElement === areaRef.current) {
      areaRef.current?.blur();
    }
  }, [active]);

  // Default focus: bottom input owns the keyboard unless alt-screen is up.
  useEffect(() => {
    if (!active || busyWithApp) return;
    const id = window.requestAnimationFrame(() => {
      areaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [active, busyWithApp, sessionId]);

  // Typing anywhere (outside real inputs) routes into the prompt box.
  useEffect(() => {
    if (!active || busyWithApp) return;

    const isEditable = (node: EventTarget | null): boolean => {
      if (!(node instanceof HTMLElement)) return false;
      if (node === areaRef.current) return true;
      const tag = node.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (node.isContentEditable) return true;
      return Boolean(
        node.closest(
          "[role='dialog'], [role='menu'], [data-radix-menu-content], [cmdk-root], [data-command-palette]",
        ),
      );
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains("xterm-helper-textarea")) {
        areaRef.current?.focus({ preventScroll: true });
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditable(event.target) && event.target !== areaRef.current) {
        return;
      }
      // Already handled by the textarea's onKeyDown when focused there.
      if (event.target === areaRef.current) return;

      const bytes = encodeKeyToPty(event);
      if (!bytes) return;

      event.preventDefault();
      event.stopPropagation();
      areaRef.current?.focus({ preventScroll: true });
      predictKey(event);
      const edit =
        event.key.length === 1 ||
        event.key === "Backspace" ||
        event.key === "Tab" ||
        event.key === "Delete";
      void forwardBytes(bytes, { edit });
    };

    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [active, busyWithApp, sessionId, uncover]);

  useEffect(() => {
    if (!active || !busyWithApp) return;
    focusTerminal(sessionId);
  }, [active, busyWithApp, sessionId]);

  const placeholder = busyWithApp
    ? "Command running — keys go to it (Ctrl+C to stop)"
    : uncover
      ? "Keys go to the shell — type here"
      : "Message the session";

  return (
    <div className="shrink-0 border-t border-elevated bg-rail px-3.5 pt-2 pb-3">
      <div className="mb-1.5 flex min-h-[22px] items-center gap-2 px-0.5 font-mono text-[11px]">
        {cwd ? (
          <span className="flex h-[22px] items-center gap-1.5 rounded-md border border-line bg-surface px-[9px] text-fg-muted">
            <Folder size={10} strokeWidth={2} className="text-fg-subtle" />
            {cwd}
          </span>
        ) : null}
        {gitBranch ? (
          <span className="flex h-[22px] items-center gap-1.5 rounded-md border border-line bg-surface px-[9px] text-[#8bb8ff]">
            <GitBranch size={10} strokeWidth={2} />
            {gitBranch}
          </span>
        ) : null}
        <span className="flex-1" />
        {meta ? <span className="text-fg-subtle">{meta}</span> : null}
      </div>

      <textarea
        ref={areaRef}
        value={uncover ? "" : mirror + pending}
        rows={1}
        readOnly={busyWithApp || uncover}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={() => {
          // Controlled mirror — shell owns the line; ignore local edits.
        }}
        onKeyDown={(event) => {
          if (busyWithApp) return;
          const bytes = encodeKeyToPty(event.nativeEvent);
          if (!bytes) return;
          event.preventDefault();
          event.stopPropagation();
          predictKey(event.nativeEvent);
          const edit =
            event.key.length === 1 ||
            event.key === "Backspace" ||
            event.key === "Tab" ||
            event.key === "Delete";
          void forwardBytes(bytes, { edit });
        }}
        className={cn(
          "block w-full min-h-11 max-h-32 resize-y rounded-[10px] border border-line-strong bg-surface px-3 py-2.5 font-mono text-[13px] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] outline-none placeholder:text-fg-subtle focus:border-accent",
          (busyWithApp || uncover) &&
            "cursor-default text-fg-subtle focus:border-line-strong",
        )}
      />
      <div className="flex gap-3.5 px-1 pt-1.5 text-[11px] text-fg-subtle">
        {busyWithApp ? (
          <span>Keys pass through to the terminal</span>
        ) : uncover ? (
          <span>Live keys → shell · prompt uncovered</span>
        ) : (
          <>
            <span>Live keys → shell</span>
            <span>Tab completes</span>
            <span>⌘F find</span>
            <span>⌘K commands</span>
          </>
        )}
        <span className="flex-1" />
        <span className="font-mono">
          blocks: {blocks} · scrollback synced
        </span>
      </div>
    </div>
  );
}
