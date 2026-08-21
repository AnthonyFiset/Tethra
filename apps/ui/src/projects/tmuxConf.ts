/** Minimal tmux config for Tethra-managed sessions (`-L tethra -f …`). */
export const TETHRA_TMUX_CONF = [
  "set -g status off",
  "set -g allow-passthrough on",
  "set -sg escape-time 0",
  "set -g focus-events on",
  'set -g default-terminal "tmux-256color"',
  'set -ga terminal-overrides ",*256col*:Tc"',
  // Detached attention: bell + silence → alert hooks write ~/.tethra/alerts/<session>.
  "setw -g monitor-bell on",
  "setw -g monitor-silence 30",
  "set -g visual-bell off",
  "set -g bell-action any",
  "set -g silence-action any",
  // Idempotent: same command each load; does not stack duplicates.
  "set-hook -g alert-bell 'run-shell \"mkdir -p \\\"$HOME/.tethra/alerts\\\"; printf bell > \\\"$HOME/.tethra/alerts/#{session_name}\\\"\"'",
  "set-hook -g alert-silence 'run-shell \"mkdir -p \\\"$HOME/.tethra/alerts\\\"; printf silence > \\\"$HOME/.tethra/alerts/#{session_name}\\\"\"'",
].join("\n");

/** Dedicated socket so we never fight the user's default tmux server. */
export const TETHRA_TMUX_SOCKET = "tethra";
