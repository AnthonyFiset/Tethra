/** Bridge imperative block chrome → React Radix menu (viewport collision). */

import type { BlockChromeEntry, BlockChromeSnapshot } from "./blocks";

export type BlockMenuRequest = {
  anchorX: number;
  anchorY: number;
  block: BlockChromeEntry;
  snapshot: BlockChromeSnapshot;
};

type Listener = (request: BlockMenuRequest | null) => void;

let listener: Listener | null = null;

export function setBlockMenuListener(next: Listener | null): void {
  listener = next;
}

export function requestBlockMenu(request: BlockMenuRequest): void {
  listener?.(request);
}

export function dismissBlockMenu(): void {
  listener?.(null);
}
