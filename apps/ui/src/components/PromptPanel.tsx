import { useEffect, useRef, useState } from "react";
import { sendTerminalInput } from "../lib/ipc";
import { blockCount, subscribeBlockChanges } from "../terminal/blocks";
import { focusTerminal } from "../terminal/registry";

interface PromptPanelProps {
  sessionId: string;
}

/**
 * Session message box: compose locally, Enter sends the line + CR to the PTY,
 * Shift+Enter inserts a newline in the box. Direct terminal typing unchanged.
 */
export function PromptPanel({ sessionId }: PromptPanelProps): React.JSX.Element {
  const [blocks, setBlocks] = useState(() => blockCount(sessionId));
  const [draft, setDraft] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setBlocks(blockCount(sessionId));
    setDraft("");
    return subscribeBlockChanges(sessionId, () => {
      setBlocks(blockCount(sessionId));
    });
  }, [sessionId]);

  async function sendDraft(): Promise<void> {
    const text = draft;
    if (!text) {
      // Bare Enter still sends CR (agent chat / empty submit).
    }
    const payload = `${text.replace(/\n/g, "\r")}\r`.replace(/\r+$/, "\r");
    setDraft("");
    try {
      await sendTerminalInput(
        sessionId,
        new TextEncoder().encode(payload),
        { force: true },
      );
    } catch {
      setDraft(text);
    }
    areaRef.current?.focus();
  }

  return (
    <div className="shrink-0 border-t border-elevated bg-rail px-3.5 pt-2 pb-3">
      <textarea
        ref={areaRef}
        value={draft}
        rows={1}
        placeholder="Message the session"
        aria-label="Message the session"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void sendDraft();
          }
        }}
        className="block w-full min-h-11 max-h-32 resize-y rounded-[10px] border border-line-strong bg-surface px-3 py-2.5 font-mono text-[13px] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] outline-none placeholder:text-fg-subtle focus:border-accent"
      />
      <div className="flex gap-3.5 px-1 pt-1.5 text-[11px] text-fg-subtle">
        <span>⌘F find</span>
        <span>⌘K commands</span>
        <span>⇧⏎ newline</span>
        <button
          type="button"
          onClick={() => focusTerminal(sessionId)}
          className="cursor-pointer text-fg-subtle hover:text-fg-muted"
        >
          click terminal to type
        </button>
        <span className="flex-1" />
        <span className="font-mono">
          blocks: {blocks} · scrollback synced
        </span>
      </div>
    </div>
  );
}
