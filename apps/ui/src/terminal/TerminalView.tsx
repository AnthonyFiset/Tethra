import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { readClipboardText } from "../lib/ipc";
import { cn } from "../lib/cn";
import {
  attachTerminal,
  clearTerminal,
  copyTerminalSelection,
  fitTerminal,
  getTerminalSelectionForCopy,
} from "./registry";

interface TerminalViewProps {
  sessionId: string;
  /** Whether this pane/tab is the keyboard focus target. */
  active: boolean;
  /** When false, keep mounted but hide (tab stack). Pane mode stays visible. */
  visible?: boolean;
  color: string;
  /** Fill a split pane instead of absolute stacking. */
  pane?: boolean;
  onPaste?: (text: string) => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onClose?: () => void;
  onAssist?: (selection?: string) => void;
}

interface MenuState {
  x: number;
  y: number;
  selection: string;
}

/**
 * Terminal surface + right-click menu.
 *
 * Plain portal menu (not Radix): WKWebView contextmenu suppress races Radix,
 * and xterm mutates the host DOM. Actions run on pointerdown so a document
 * dismiss listener cannot eat the click.
 */
export function TerminalView({
  sessionId,
  active,
  visible = true,
  color,
  pane = false,
  onPaste,
  onSplitRight,
  onSplitDown,
  onClose,
  onAssist,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    attachTerminal(sessionId, container);
    let fitTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (!visible) return;
      window.clearTimeout(fitTimer);
      fitTimer = window.setTimeout(() => fitTerminal(sessionId), 180);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.clearTimeout(fitTimer);
    };
  }, [sessionId, visible]);

  useEffect(() => {
    if (active && visible) {
      requestAnimationFrame(() => fitTerminal(sessionId));
    }
  }, [active, visible, sessionId]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      dismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    // Bubble phase — menu item pointerdown runs first on the button.
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", dismiss);
    };
  }, [menu]);

  async function pasteFromClipboard(): Promise<void> {
    const text = await readClipboardText();
    if (text) onPaste?.(text);
  }

  function run(action: () => void): void {
    setMenu(null);
    // Defer so unmount doesn't cancel the paste/copy promise path.
    queueMicrotask(action);
  }

  function itemProps(action: () => void, disabled = false) {
    return {
      type: "button" as const,
      role: "menuitem" as const,
      disabled,
      // pointerdown: fires before outside-dismiss; click alone was eaten.
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (disabled) return;
        event.preventDefault();
        event.stopPropagation();
        run(action);
      },
    };
  }

  return (
    <div
      className={cn(
        "relative min-h-0",
        pane
          ? "size-full"
          : cn(
              "absolute inset-0",
              visible ? "z-10 block" : "-z-10 invisible",
            ),
      )}
      data-terminal-surface
      style={{
        boxShadow: `inset 0 2px 0 0 ${color}`,
        backgroundColor: "var(--terminal-bg, #0d0d0d)",
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({
          x: event.clientX,
          y: event.clientY,
          selection: getTerminalSelectionForCopy(sessionId),
        });
      }}
    >
      <div
        ref={containerRef}
        aria-label="SSH terminal"
        className="size-full overflow-hidden px-3 py-2"
      />

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="tethra-block-menu"
            style={{
              left: Math.min(menu.x, window.innerWidth - 200),
              top: Math.min(menu.y, window.innerHeight - 220),
              zIndex: 2147483001,
            }}
          >
            <button
              {...itemProps(() => {
                void copyTerminalSelection(sessionId);
              }, !menu.selection)}
            >
              Copy
              <span className="tethra-menu-shortcut">⌘C</span>
            </button>
            <button
              {...itemProps(() => {
                void pasteFromClipboard();
              })}
            >
              Paste
              <span className="tethra-menu-shortcut">⌘V</span>
            </button>
            {onAssist && (
              <button
                {...itemProps(() => {
                  onAssist(menu.selection || undefined);
                })}
              >
                {menu.selection ? "Send selection to Assist" : "Assist"}
              </button>
            )}
            <div className="tethra-menu-sep" />
            <button {...itemProps(() => clearTerminal(sessionId))}>
              Clear
              <span className="tethra-menu-shortcut">⇧⌘K</span>
            </button>
            {onSplitRight && (
              <button {...itemProps(onSplitRight)}>
                Split right
                <span className="tethra-menu-shortcut">⌘\</span>
              </button>
            )}
            {onSplitDown && (
              <button {...itemProps(onSplitDown)}>
                Split down
                <span className="tethra-menu-shortcut">⇧⌘\</span>
              </button>
            )}
            {onClose && (
              <>
                <div className="tethra-menu-sep" />
                <button {...itemProps(onClose)}>
                  Close tab
                  <span className="tethra-menu-shortcut">⌘W</span>
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
