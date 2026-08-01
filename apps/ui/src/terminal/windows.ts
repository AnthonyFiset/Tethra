/** Multi-window helpers. Sessions stay in Rust; windows only hold layout. */

import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const CHANNEL = "tethra-workspace";

export type WorkspaceTab = {
  sessionId: string;
  hostId: string;
  title: string;
  kind: "terminal" | "local" | "sftp";
  connected: boolean;
  color?: string | null;
  remotePath?: string;
  localPath?: string;
  cwd?: string;
};

export type WorkspaceTransfer = {
  type: "adopt" | "reclaim";
  fromLabel: string;
  /** For adopt: only this window should take the tabs. */
  toLabel?: string;
  tabs: WorkspaceTab[];
  /** Serialized layout tree JSON, or null. */
  layoutJson: string | null;
  activeId?: string;
  zoomedId?: string;
};

export function currentWindowLabel(): string {
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    return "main";
  }
}

export function isMainWindow(): boolean {
  return currentWindowLabel() === "main";
}

export function workspaceBus(): BroadcastChannel {
  return new BroadcastChannel(CHANNEL);
}

/** Open an empty secondary workspace window. */
export async function openWorkspaceWindow(): Promise<string> {
  const label = `workspace-${crypto.randomUUID().slice(0, 8)}`;
  const window = new WebviewWindow(label, {
    url: "/",
    title: "Tethra",
    width: 1000,
    height: 700,
    minWidth: 420,
    minHeight: 520,
    focus: true,
    backgroundColor: "#0D0D0D",
  });
  await new Promise<void>((resolve, reject) => {
    window.once("tauri://created", () => resolve());
    window.once("tauri://error", (event) =>
      reject(new Error(String(event.payload))),
    );
  });
  return label;
}

/** Move tabs into a new window without closing Rust sessions. */
export async function moveTabsToNewWindow(payload: {
  tabs: WorkspaceTab[];
  layoutJson: string | null;
  activeId?: string;
  zoomedId?: string;
}): Promise<void> {
  const fromLabel = currentWindowLabel();
  const label = await openWorkspaceWindow();
  // Give the new window a moment to mount listeners.
  await new Promise((r) => setTimeout(r, 250));
  const bus = workspaceBus();
  const message: WorkspaceTransfer = {
    type: "adopt",
    fromLabel,
    toLabel: label,
    tabs: payload.tabs,
    layoutJson: payload.layoutJson,
    activeId: payload.activeId,
    zoomedId: payload.zoomedId,
  };
  bus.postMessage(message);
  // Also stash for windows that race the broadcast.
  sessionStorage.setItem(`tethra.transfer.${label}`, JSON.stringify(message));
  bus.close();
}

export function takePendingTransfer(label: string): WorkspaceTransfer | null {
  const key = `tethra.transfer.${label}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  sessionStorage.removeItem(key);
  try {
    return JSON.parse(raw) as WorkspaceTransfer;
  } catch {
    return null;
  }
}
