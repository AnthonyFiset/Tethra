import { useCallback, useRef } from "react";
import { cn } from "../lib/cn";
import {
  type LayoutNode,
  type SplitOrientation,
  setSplitRatio,
} from "./layout";

interface SplitPanesProps {
  layout: LayoutNode;
  focusedId?: string;
  zoomedId?: string;
  narrow: boolean;
  onFocus: (sessionId: string) => void;
  onLayoutChange: (layout: LayoutNode) => void;
  renderPane: (sessionId: string, focused: boolean) => React.ReactNode;
}

export function SplitPanes({
  layout,
  focusedId,
  zoomedId,
  narrow,
  onFocus,
  onLayoutChange,
  renderPane,
}: SplitPanesProps): React.JSX.Element {
  // Below 768px or zoomed: only the focused / zoomed leaf.
  if (narrow || zoomedId) {
    const sessionId =
      zoomedId ??
      focusedId ??
      (layout.type === "leaf" ? layout.sessionId : firstLeaf(layout));
    return (
      <div
        className={cn(
          "relative size-full min-h-0 min-w-0",
          zoomedId && "ring-1 ring-inset ring-accent/50",
        )}
      >
        {renderPane(sessionId, true)}
      </div>
    );
  }

  return (
    <PaneNode
      node={layout}
      root={layout}
      focusedId={focusedId}
      onFocus={onFocus}
      onLayoutChange={onLayoutChange}
      renderPane={renderPane}
    />
  );
}

function PaneNode({
  node,
  root,
  focusedId,
  onFocus,
  onLayoutChange,
  renderPane,
}: {
  node: LayoutNode;
  root: LayoutNode;
  focusedId?: string;
  onFocus: (sessionId: string) => void;
  onLayoutChange: (layout: LayoutNode) => void;
  renderPane: (sessionId: string, focused: boolean) => React.ReactNode;
}): React.JSX.Element {
  if (node.type === "leaf") {
    const focused = node.sessionId === focusedId;
    return (
      <div
        className={cn(
          "relative size-full min-h-0 min-w-0 overflow-hidden",
          focused && "ring-1 ring-inset ring-accent/40",
        )}
        onMouseDown={() => onFocus(node.sessionId)}
      >
        {renderPane(node.sessionId, focused)}
      </div>
    );
  }

  const horizontal = node.orientation === "horizontal";
  return (
    <div
      className={cn(
        "flex size-full min-h-0 min-w-0",
        horizontal ? "flex-row" : "flex-col",
      )}
    >
      <div
        className="min-h-0 min-w-0"
        style={{
          flexBasis: `${node.ratio * 100}%`,
          flexGrow: 0,
          flexShrink: 0,
        }}
      >
        <PaneNode
          node={node.first}
          root={root}
          focusedId={focusedId}
          onFocus={onFocus}
          onLayoutChange={onLayoutChange}
          renderPane={renderPane}
        />
      </div>
      <SplitSash
        orientation={node.orientation}
        onDrag={(ratio) => onLayoutChange(setSplitRatio(root, node.id, ratio))}
        startRatio={node.ratio}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <PaneNode
          node={node.second}
          root={root}
          focusedId={focusedId}
          onFocus={onFocus}
          onLayoutChange={onLayoutChange}
          renderPane={renderPane}
        />
      </div>
    </div>
  );
}

function SplitSash({
  orientation,
  onDrag,
  startRatio,
}: {
  orientation: SplitOrientation;
  onDrag: (ratio: number) => void;
  startRatio: number;
}): React.JSX.Element {
  const dragging = useRef(false);
  const ratioRef = useRef(startRatio);
  ratioRef.current = startRatio;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const sash = event.currentTarget;
      const parent = sash.parentElement;
      if (!parent) return;
      dragging.current = true;
      sash.setPointerCapture(event.pointerId);
      const horizontal = orientation === "horizontal";
      const rect = parent.getBoundingClientRect();

      const move = (clientX: number, clientY: number) => {
        const ratio = horizontal
          ? (clientX - rect.left) / rect.width
          : (clientY - rect.top) / rect.height;
        onDrag(ratio);
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        move(ev.clientX, ev.clientY);
      };
      const onPointerUp = (ev: PointerEvent) => {
        dragging.current = false;
        sash.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [onDrag, orientation],
  );

  const horizontal = orientation === "horizontal";
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      className={cn(
        "shrink-0 bg-line transition-colors hover:bg-accent/50",
        horizontal
          ? "w-1 cursor-col-resize hover:w-1.5"
          : "h-1 cursor-row-resize hover:h-1.5",
      )}
    />
  );
}

function firstLeaf(node: LayoutNode): string {
  if (node.type === "leaf") return node.sessionId;
  return firstLeaf(node.first);
}
