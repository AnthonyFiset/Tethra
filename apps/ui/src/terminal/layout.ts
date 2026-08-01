/** Pane / split layout tree for M7. Session IDs live in Rust; this is view state. */

export type SplitOrientation = "horizontal" | "vertical";

export type LayoutNode =
  | { type: "leaf"; sessionId: string }
  | {
      type: "split";
      id: string;
      orientation: SplitOrientation;
      /** Ratio of the first child (0–1). */
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

export function leaf(sessionId: string): LayoutNode {
  return { type: "leaf", sessionId };
}

export function split(
  orientation: SplitOrientation,
  first: LayoutNode,
  second: LayoutNode,
  ratio = 0.5,
): LayoutNode {
  return {
    type: "split",
    id: crypto.randomUUID(),
    orientation,
    ratio: clampRatio(ratio),
    first,
    second,
  };
}

function clampRatio(ratio: number): number {
  return Math.min(0.85, Math.max(0.15, ratio));
}

/** Collect every session id in the tree (depth-first). */
export function collectSessionIds(node: LayoutNode): string[] {
  if (node.type === "leaf") return [node.sessionId];
  return [...collectSessionIds(node.first), ...collectSessionIds(node.second)];
}

/** Replace a leaf session id, or no-op if missing. */
export function replaceSession(
  node: LayoutNode,
  from: string,
  to: string,
): LayoutNode {
  if (node.type === "leaf") {
    return node.sessionId === from ? leaf(to) : node;
  }
  return {
    ...node,
    first: replaceSession(node.first, from, to),
    second: replaceSession(node.second, from, to),
  };
}

/** Remove a leaf; collapses the parent split to the surviving sibling. */
export function removeSession(
  node: LayoutNode,
  sessionId: string,
): LayoutNode | null {
  if (node.type === "leaf") {
    return node.sessionId === sessionId ? null : node;
  }
  const first = removeSession(node.first, sessionId);
  const second = removeSession(node.second, sessionId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

/** Split the leaf that holds `sessionId`, placing `newSessionId` as the other pane. */
export function splitLeaf(
  node: LayoutNode,
  sessionId: string,
  newSessionId: string,
  orientation: SplitOrientation,
): LayoutNode {
  if (node.type === "leaf") {
    if (node.sessionId !== sessionId) return node;
    return split(orientation, node, leaf(newSessionId));
  }
  return {
    ...node,
    first: splitLeaf(node.first, sessionId, newSessionId, orientation),
    second: splitLeaf(node.second, sessionId, newSessionId, orientation),
  };
}

/** Update the ratio on the split with the given id. */
export function setSplitRatio(
  node: LayoutNode,
  splitId: string,
  ratio: number,
): LayoutNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) {
    return { ...node, ratio: clampRatio(ratio) };
  }
  return {
    ...node,
    first: setSplitRatio(node.first, splitId, ratio),
    second: setSplitRatio(node.second, splitId, ratio),
  };
}

/** True when `sessionId` appears somewhere in the tree. */
export function containsSession(node: LayoutNode, sessionId: string): boolean {
  return collectSessionIds(node).includes(sessionId);
}
