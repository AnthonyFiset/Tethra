import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { readClipboardText } from "../lib/ipc";
import { cn } from "../lib/cn";
import {
  attachTerminal,
  clearTerminal,
  copyTerminalSelection,
  fitTerminal,
  getTerminalInstance,
  getTerminalSelectionForCopy,
} from "./registry";
import {
  scheduleBlockOverlaySync,
  setBlockOverlayHost,
} from "./blockOverlay";
import { TerminalFindBar } from "./TerminalFindBar";

interface TerminalViewProps {
  sessionId: string;
  /** Whether this pane/tab is the keyboard focus target. */
  active: boolean;
  /** When false, keep mounted but hide (tab stack). Pane mode stays visible. */
  visible?: boolean;
  color: string;
  /** Fill a split pane instead of absolute stacking. */
  pane?: boolean;
  /** Show the find bar for this session. */
  findOpen?: boolean;
  onFindOpen?: () => void;
  onFindClose?: () => void;
  onPaste?: (text: string) => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onClose?: () => void;
  onAssist?: (selection?: string) => void;
  /** `session` omits the host-color top hairline (context bar replaces it). */
  chrome?: "default" | "session";
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
  findOpen = false,
  onFindOpen,
  onFindClose,
  onPaste,
  onSplitRight,
  onSplitDown,
  onClose,
  onAssist,
  chrome = "default",
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container) return;

    attachTerminal(sessionId, container);
    let fitTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (!visible) return;
      window.clearTimeout(fitTimer);
      fitTimer = window.setTimeout(() => {
        fitTerminal(sessionId);
        scheduleBlockOverlaySync(sessionId);
      }, 180);
    });
    observer.observe(container);

    const terminal = getTerminalInstance(sessionId);
    if (terminal && overlay) {
      setBlockOverlayHost(sessionId, overlay, terminal);
    }

    return () => {
      observer.disconnect();
      window.clearTimeout(fitTimer);
      setBlockOverlayHost(sessionId, null, null);
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
        boxShadow:
          chrome === "session" ? undefined : `inset 0 3px 0 0 ${color}`,
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
        className="size-full overflow-hidden px-3.5 py-2"
      />
      {/* Unpadded: overlay math uses live cell metrics against this root.
          overflow visible so a waiting banner below the last row can paint
          into the prompt strip instead of being clipped to a hairline. */}
      <div
        ref={overlayRef}
        className="tethra-block-overlay-root pointer-events-none absolute inset-0 overflow-visible"
        aria-hidden="true"
      />

      <TerminalFindBar
        sessionId={sessionId}
        open={findOpen}
        onClose={() => onFindClose?.()}
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
            {onFindOpen && (
              <button {...itemProps(onFindOpen)}>
                Find
                <span className="tethra-menu-shortcut">⌘F</span>
              </button>
            )}
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
