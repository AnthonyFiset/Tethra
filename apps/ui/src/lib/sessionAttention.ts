/** Ephemeral agent session attention state (not vault-synced). */

import type { AgentAttentionState } from "../lib/generated/AgentAttentionState";

export type SessionAttention = {
  state: AgentAttentionState;
  message?: string;
  /** Host cannot watch detached sessions (old/missing tmux). */
  noWatch?: boolean;
};

/** Explicit signals beat silence; never regress done/failed → waiting via silence. */
export function mergeAttention(
  prev: SessionAttention | undefined,
  next: SessionAttention,
  source: string,
): SessionAttention {
  if (source === "silence") {
    if (
      prev?.state === "waiting" ||
      prev?.state === "done" ||
      prev?.state === "failed"
    ) {
      return prev;
    }
  }
  return {
    state: next.state,
    message: next.message ?? prev?.message,
    noWatch: next.noWatch ?? prev?.noWatch,
  };
}

export function attentionChipClass(state: AgentAttentionState): string {
  switch (state) {
    case "waiting":
      return "bg-warning/15 text-warning";
    case "done":
      return "bg-success/15 text-success";
    case "failed":
      return "bg-danger/15 text-danger";
    default:
      return "bg-elevated text-fg-subtle";
  }
}

export function attentionLabel(state: AgentAttentionState): string {
  switch (state) {
    case "waiting":
      return "waiting";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "running";
  }
}
