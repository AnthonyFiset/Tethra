/** Desktop notifications for agent attention (waiting / done / failed). */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  getNotifyDone,
  getNotifyFailed,
  getNotifyWaiting,
} from "./prefs";
import type { AgentAttentionState } from "./generated/AgentAttentionState";

async function ensurePermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    return granted;
  } catch {
    return false;
  }
}

export async function maybeNotifyAttention(options: {
  state: AgentAttentionState;
  title: string;
  body?: string;
  /** Passed back via notification extra for click-to-reattach. */
  runningSessionId: string;
}): Promise<void> {
  const { state, title, body, runningSessionId } = options;
  if (state === "waiting" && !getNotifyWaiting()) return;
  if (state === "done" && !getNotifyDone()) return;
  if (state === "failed" && !getNotifyFailed()) return;
  if (state === "running") return;

  if (!(await ensurePermission())) return;

  const label =
    state === "waiting"
      ? "needs attention"
      : state === "failed"
        ? "failed"
        : "done";

  try {
    sendNotification({
      title: `Tethra · ${title}`,
      body: body ?? `Session ${label}`,
      extra: { runningSessionId },
    });
  } catch {
    // Notification plugin unavailable (browser preview).
  }
}
