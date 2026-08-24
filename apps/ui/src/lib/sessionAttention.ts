/** Ephemeral agent session attention state (not vault-synced). */

import type { AgentAttentionState } from "../lib/generated/AgentAttentionState";

export type SessionAttention = {
  state: AgentAttentionState;
  message?: string;
  /** Host cannot watch detached sessions (old/missing tmux). */
  noWatch?: boolean;
};

/**
 * Merge attention updates. Waiting is only accepted from explicit agent
 * signals (`bel` / `osc`). Silence never arms waiting (idle shells must stay
 * clean). Exit/activity/tmux may still clear or set non-waiting states.
 */
export function mergeAttention(
  prev: SessionAttention | undefined,
  next: SessionAttention,
  source: string,
): SessionAttention {
  if (source === "silence") {
    return prev ?? { state: "running" };
  }
  if (
    next.state === "waiting" &&
    source !== "bel" &&
    source !== "osc" &&
    source !== "tmux"
  ) {
    // Defense: unknown sources cannot raise the Review banner.
    return prev ?? { state: "running", noWatch: next.noWatch };
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

export function attentionDotClass(state: AgentAttentionState): string {
  switch (state) {
    case "waiting":
      return "bg-warning";
    case "failed":
      return "bg-danger";
    default:
      return "bg-success";
  }
}
