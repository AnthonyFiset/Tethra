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
 * Persistent agents prefer `tmux new-session -A`, then zellij, else a plain
 * launch with a stderr warning. Windows local skips POSIX mux (in-app detach
 * + spawn cwd handle resume / working directory).
 */
export function projectLaunchScript(options: {
  projectId: string;
  path: string;
  agent: AgentSpecDto | undefined;
  remote: boolean;
  /** Client OS from `ensure_local_mux`. */
  platform?: string;
  /** When false, skip mux wrap (still cd + agent on Unix). */
  muxAvailable?: boolean;
  /** When true, PTY already started in `path` — skip cd. */
  cwdAlreadySet?: boolean;
}): string {
  const pathQ = shellSingleQuote(options.path);
  const argv = agentArgv(options.agent);
  const localWindows = !options.remote && options.platform === "windows";
  const wantMux =
    Boolean(options.agent?.persistent) &&
    !localWindows &&
    options.muxAvailable !== false;

  if (!wantMux) {
    if (localWindows) {
      // cwd set at spawn; only launch agent if any.
      return argv ? `${argv}\r\n` : "";
    }
    if (options.cwdAlreadySet) {
      return argv ? `${argv}\n` : "";
    }
    if (argv) return `cd ${pathQ} && ${argv}\n`;
    return `cd ${pathQ}\n`;
  }

  const sessionQ = shellSingleQuote(muxSessionName(options.projectId));
  const inner = argv ?? "$SHELL";

  // Prefer a login-like PATH before probing / installing (Homebrew on macOS).
  const pathBootstrap = [
    `for _p in /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin /usr/local/sbin "$HOME/.local/bin"; do`,
    `  [ -d "$_p" ] || continue`,
    `  case ":$PATH:" in *":$_p:"*) ;; *) PATH="$_p:$PATH" ;; esac`,
    `done`,
    `export PATH`,
  ];

  // On remote hosts, try user-level installers before falling back (no sudo prompts).
  const ensureRemote = options.remote
    ? [
        `if ! command -v tmux >/dev/null 2>&1 && ! command -v zellij >/dev/null 2>&1; then`,
        `  if command -v brew >/dev/null 2>&1; then`,
        `    echo "tethra: installing tmux via Homebrew on this host…" >&2`,
        `    brew install tmux || true`,
        `  fi`,
        `fi`,
      ]
    : [];

  return [
    ...pathBootstrap,
    ...ensureRemote,
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
