import { useEffect, useState } from "react";
import { blockCount, subscribeBlockChanges } from "../terminal/blocks";
import { focusTerminal } from "../terminal/registry";

interface PromptPanelProps {
  sessionId: string;
}

/** Bottom frame + hint row (keystrokes stay in xterm — click frame to focus). */
export function PromptPanel({ sessionId }: PromptPanelProps): React.JSX.Element {
  const [blocks, setBlocks] = useState(() => blockCount(sessionId));

  useEffect(() => {
    setBlocks(blockCount(sessionId));
    return subscribeBlockChanges(sessionId, () => {
      setBlocks(blockCount(sessionId));
    });
  }, [sessionId]);

  return (
    <div className="shrink-0 border-t border-elevated bg-rail px-3.5 pt-2 pb-3">
      <button
        type="button"
        onClick={() => focusTerminal(sessionId)}
        className="block w-full min-h-11 cursor-pointer rounded-[10px] border border-line-strong bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
        aria-label="Focus terminal"
      />
      <div className="flex gap-3.5 px-1 pt-1.5 text-[11px] text-fg-subtle">
        <span>⌘F find</span>
        <span>⌘K commands</span>
        <span>⇧⏎ multiline</span>
        <span className="flex-1" />
        <span className="font-mono">
          blocks: {blocks} · scrollback synced
        </span>
      </div>
    </div>
  );
}
