import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "../lib/cn";
import {
  clearTerminalSearch,
  findTerminalNext,
  findTerminalPrevious,
  focusTerminal,
  onTerminalSearchResults,
} from "./registry";

interface TerminalFindBarProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

export function TerminalFindBar({
  sessionId,
  open,
  onClose,
}: TerminalFindBarProps): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [resultIndex, setResultIndex] = useState(-1);
  const [resultCount, setResultCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    const unlisten = onTerminalSearchResults(sessionId, (index, count) => {
      setResultIndex(index);
      setResultCount(count);
    });
    return unlisten;
  }, [open, sessionId]);

  useEffect(() => {
    if (!open) {
      clearTerminalSearch(sessionId);
      setQuery("");
      setResultIndex(-1);
      setResultCount(0);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, sessionId]);

  useEffect(() => {
    if (!open) return;
    if (!query) {
      clearTerminalSearch(sessionId);
      setResultIndex(-1);
      setResultCount(0);
      return;
    }
    findTerminalNext(sessionId, query, {
      caseSensitive,
      incremental: true,
    });
  }, [query, caseSensitive, open, sessionId]);

  if (!open) return null;

  function close(): void {
    clearTerminalSearch(sessionId);
    onClose();
    focusTerminal(sessionId);
  }

  function next(): void {
    if (!query) return;
    findTerminalNext(sessionId, query, { caseSensitive });
  }

  function prev(): void {
    if (!query) return;
    findTerminalPrevious(sessionId, query, { caseSensitive });
  }

  const countLabel =
    resultCount === 0
      ? "No results"
      : `${Math.max(1, resultIndex + 1)} of ${resultCount}`;

  return (
    <div
      className="absolute top-2 right-2 z-40 flex items-center gap-1 rounded-md border border-line-strong bg-elevated px-1.5 py-1 shadow-lg shadow-black/40"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) prev();
          else next();
        }
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find"
        aria-label="Find in terminal"
        className="h-7 w-40 rounded border border-line bg-base px-2 text-ui text-fg outline-none focus:border-accent"
      />
      <span
        className={cn(
          "min-w-14 shrink-0 text-center font-mono text-micro",
          resultCount === 0 && query ? "text-fg-subtle" : "text-fg-muted",
        )}
      >
        {query ? countLabel : ""}
      </span>
      <button
        type="button"
        title="Previous (Shift+Enter)"
        aria-label="Previous match"
        onClick={prev}
        className="grid size-7 cursor-pointer place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        title="Next (Enter)"
        aria-label="Next match"
        onClick={next}
        className="grid size-7 cursor-pointer place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        title="Match case"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((value) => !value)}
        className={cn(
          "grid h-7 min-w-7 cursor-pointer place-items-center rounded px-1 font-mono text-micro font-semibold",
          caseSensitive
            ? "bg-accent/20 text-accent"
            : "text-fg-muted hover:bg-hover hover:text-fg",
        )}
      >
        Aa
      </button>
      <button
        type="button"
        title="Close (Esc)"
        aria-label="Close find"
        onClick={close}
        className="grid size-7 cursor-pointer place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg"
      >
        <X size={14} />
      </button>
    </div>
  );
}
