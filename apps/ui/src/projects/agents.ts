import type { AgentSpecDto } from "../lib/ipc";

/** Resolve a project default agent, following deprecated successors. */
export function resolveAgentForLaunch(
  agents: AgentSpecDto[],
  preferredId: string | null | undefined,
): { agent: AgentSpecDto | undefined; migratedFrom?: string } {
  const shell = agents.find((entry) => entry.id === "shell");
  const requested = preferredId
    ? agents.find((entry) => entry.id === preferredId)
    : undefined;
  if (!requested) {
    return { agent: shell };
  }
  if (requested.status === "deprecated" && requested.successor) {
    const successor = agents.find((entry) => entry.id === requested.successor);
    if (successor) {
      return { agent: successor, migratedFrom: requested.name };
    }
  }
  return { agent: requested };
}

/** Install command for the probed (or local) platform. */
export function installCommandFor(
  agent: AgentSpecDto,
  platform: string | undefined,
): string | undefined {
  const specific =
    platform === "macos"
      ? agent.installMacos
      : platform === "linux"
        ? agent.installLinux
        : platform === "windows"
          ? agent.installWindows
          : null;
  return specific ?? agent.installDefault ?? undefined;
}

export function agentDisplayName(
  agents: AgentSpecDto[],
  agentId: string | null | undefined,
): string {
  if (!agentId) return "shell";
  const { agent } = resolveAgentForLaunch(agents, agentId);
  return agent?.name ?? agentId;
}

/** Prefer successor id when the stored agent is deprecated. */
export function resolvedAgentId(
  agents: AgentSpecDto[],
  preferredId: string | null | undefined,
): string | undefined {
  const { agent } = resolveAgentForLaunch(agents, preferredId);
  return agent?.id;
}
