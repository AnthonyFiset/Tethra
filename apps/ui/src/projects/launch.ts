import type { AgentSpecDto } from "../lib/ipc";
import { TETHRA_TMUX_CONF, TETHRA_TMUX_SOCKET } from "./tmuxConf";

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
 *
 * tmux uses a dedicated socket (`-L tethra`) and an embedded Tethra config
 * (`allow-passthrough`, no status bar) so OSC 133/52 work and we never load
 * the user's `~/.tmux.conf`.
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
  /**
   * Absolute path to a `0600` env file (local or remote). Sourced then unlinked.
   * Never put secrets on the tmux command line.
   */
  byokEnvPath?: string;
}): string {
  const pathQ = shellSingleQuote(options.path);
  const argv = agentArgv(options.agent);
  const localWindows = !options.remote && options.platform === "windows";
  const wantMux =
    Boolean(options.agent?.persistent) &&
    !localWindows &&
    options.muxAvailable !== false;

  const byokPreamble =
    options.byokEnvPath && !localWindows
      ? [
          `set -a`,
          `. ${shellSingleQuote(options.byokEnvPath)}`,
          `set +a`,
          `rm -f ${shellSingleQuote(options.byokEnvPath)}`,
        ]
      : [];

  if (!wantMux) {
    if (localWindows) {
      // cwd set at spawn; only launch agent if any. BYOK file injection is POSIX.
      return argv ? `${argv}\r\n` : "";
    }
    const head = [...byokPreamble];
    if (options.cwdAlreadySet) {
      if (argv) head.push(argv);
      return head.length ? `${head.join("\n")}\n` : "";
    }
    if (argv) {
      head.push(`cd ${pathQ} && ${argv}`);
      return `${head.join("\n")}\n`;
    }
    head.push(`cd ${pathQ}`);
    return `${head.join("\n")}\n`;
  }

  const sessionQ = shellSingleQuote(muxSessionName(options.projectId));
  const inner = argv ?? "$SHELL";
  const socketQ = shellSingleQuote(TETHRA_TMUX_SOCKET);
  // Heredoc body — conf has no expansions.
  const confHeredoc = TETHRA_TMUX_CONF;

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

  // The script is TYPED into the shell, so every line above echoes with a
  // PS1/PS2 in front of it. Wipe screen + scrollback right before the mux
  // takes over — inside each branch, because the shell reads and echoes
  // the whole compound before running any of it. Without this the echoed
  // heredoc sat in scrollback under the agent's inline redraw and the
  // block parser turned `done` / `export PATH` / `fi` into blocks.
  const wipe = `  ${WIPE_SCREEN}`;
  return [
    ...byokPreamble,
    ...pathBootstrap,
    ...ensureRemote,
    `if command -v tmux >/dev/null 2>&1; then`,
    wipe,
    `  _tethra_tmux_conf=$(mktemp "\${TMPDIR:-/tmp}/tethra-tmux.XXXXXX") || exit 1`,
    `  cat > "\$_tethra_tmux_conf" <<'TETHRA_TMUX_EOF'`,
    confHeredoc,
    `TETHRA_TMUX_EOF`,
    `  tmux -L ${socketQ} -f "\$_tethra_tmux_conf" new-session -A -s ${sessionQ} -c ${pathQ} -- ${inner}`,
    `  rm -f "\$_tethra_tmux_conf"`,
    `elif command -v zellij >/dev/null 2>&1; then`,
    wipe,
    `  cd ${pathQ} && zellij attach -c ${sessionQ} -- ${inner}`,
    `else`,
    wipe,
    `  echo "tethra: no tmux/zellij — session will not persist across disconnects" >&2`,
    `  cd ${pathQ} && ${inner}`,
    `fi`,
    "",
  ].join("\n");
}

/**
 * ED2 (push viewport to scrollback, as `clear` does) → ED3 (drop that
 * scrollback) → cursor home. Order matters: ED3 first would be undone by
 * the ED2 push. Plain bytes outside any sync block, so the renderer's
 * sync filter passes them through untouched.
 */
export const WIPE_SCREEN = "printf '\\033[2J\\033[3J\\033[H'";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
