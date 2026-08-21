/** Minimal tmux config for Tethra-managed sessions (`-L tethra -f …`). */
export const TETHRA_TMUX_CONF = [
  "set -g status off",
  "set -g allow-passthrough on",
  "set -sg escape-time 0",
  "set -g focus-events on",
  'set -g default-terminal "tmux-256color"',
  'set -ga terminal-overrides ",*256col*:Tc"',
].join("\n");

/** Dedicated socket so we never fight the user's default tmux server. */
export const TETHRA_TMUX_SOCKET = "tethra";
