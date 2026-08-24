import { blockCount } from "../terminal/blocks";

interface PromptPanelProps {
  sessionId: string;
}

/** Visual frame + hint row beneath the PTY (keystrokes stay in xterm). */
export function PromptPanel({ sessionId }: PromptPanelProps): React.JSX.Element {
  const blocks = blockCount(sessionId);

  return (
    <div className="shrink-0 border-t border-elevated bg-rail px-3.5 pt-2 pb-3">
      <div
        className="flex min-h-11 items-center gap-[11px] rounded-[10px] border border-line-strong bg-surface px-4 py-2.5 font-mono text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
        aria-hidden="true"
      >
        <span className="font-semibold text-accent">❯</span>
        <span className="text-fg-subtle">Type in the terminal above</span>
        <span className="flex-1" />
        <span className="text-[10.5px] text-fg-subtle">⏎ run</span>
      </div>
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
