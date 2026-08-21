/** Desktop notifications for agent attention (waiting / done / failed). */

import { sendAgentNotification } from "./ipc";
import {
  getNotifyDone,
  getNotifyFailed,
  getNotifyWaiting,
} from "./prefs";
import type { AgentAttentionState } from "./generated/AgentAttentionState";

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

  const label =
    state === "waiting"
      ? "needs attention"
      : state === "failed"
        ? "failed"
        : "done";

  try {
    await sendAgentNotification({
      title: `Tethra · ${title}`,
      body: body ?? `Session ${label}`,
      runningSessionId,
    });
  } catch {
    // Notification plugin unavailable (browser preview).
  }
}
