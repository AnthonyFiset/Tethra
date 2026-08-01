import type { AgentSpecDto } from "../lib/ipc";

/** Escape a value for single-quoted POSIX shell use. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return shellSingleQuote(value);
}

function agentArgv(agent: AgentSpecDto | undefined): string | null {
  if (!agent || !agent.command.trim()) return null;
  return [agent.command, ...agent.args].map(shellEscape).join(" ");
}

/** Must match `mux_session_name` in crates/core/src/model/project.rs. */
export function muxSessionName(projectId: string): string {
  const cleaned = projectId.replace(/[^A-Za-z0-9_-]/g, "");
  return `tethra-${cleaned.slice(0, 24)}`;
}

/**
 * Build the lines to send into a PTY after connect.
 * Remote + persistent agents prefer `tmux new-session -A`, then zellij, else
 * a plain launch with a stderr warning.
 */
export function projectLaunchScript(options: {
  projectId: string;
  path: string;
  agent: AgentSpecDto | undefined;
  remote: boolean;
}): string {
  const pathQ = shellSingleQuote(options.path);
  const argv = agentArgv(options.agent);
  const wantMux = options.remote && Boolean(options.agent?.persistent);

  if (!wantMux) {
    if (argv) return `cd ${pathQ} && ${argv}\n`;
    return `cd ${pathQ}\n`;
  }

  const sessionQ = shellSingleQuote(muxSessionName(options.projectId));
  const inner = argv ?? "$SHELL";

  return [
    `if command -v tmux >/dev/null 2>&1; then`,
    `  tmux new-session -A -s ${sessionQ} -c ${pathQ} -- ${inner}`,
    `elif command -v zellij >/dev/null 2>&1; then`,
    `  cd ${pathQ} && zellij attach -c ${sessionQ} -- ${inner}`,
    `else`,
    `  echo "tethra: no tmux/zellij — session will not persist across disconnects" >&2`,
    `  cd ${pathQ} && ${inner}`,
    `fi`,
    "",
  ].join("\n");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
