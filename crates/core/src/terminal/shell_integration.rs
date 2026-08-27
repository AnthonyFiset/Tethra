//! Shell integration scripts and SSH connect wrappers (OSC 133 + OSC 7).
//!
//! Scripts are pure data. Local temp-file wrapping lives in the desktop shell
//! (platform APIs are forbidden in `core`).

/// Bash script sourced before an interactive bash session.
/// Emits OSC 133 A/B/C/D and OSC 7 cwd. Harmless if the outer terminal
/// ignores the sequences.
pub const BASH_INTEGRATION: &str = r#"
# Tethra shell integration (bash) — OSC 133 + OSC 7
export COLORTERM="${COLORTERM:-truecolor}"
__tethra_has_cmd=0
# Inside tmux, wrap OSC in the passthrough envelope so marks reach the
# outer terminal (needs tmux allow-passthrough on — our conf sets it).
__tethra_osc() {
  if [ -n "${TMUX:-}" ]; then
    printf '\033Ptmux;\033\033]%s\007\033\\' "$1"
  else
    printf '\033]%s\007' "$1"
  fi
}
__tethra_prompt_start() {
  __tethra_osc '133;A'
  __tethra_osc '133;B'
  local _host="${HOSTNAME:-}"
  __tethra_osc "7;file://${_host}${PWD}"
  local _branch
  _branch=$(command -v git >/dev/null 2>&1 && git branch --show-current 2>/dev/null)
  if [ -n "$_branch" ]; then
    __tethra_osc "133;G;${_branch}"
  fi
}
__tethra_at_prompt=0
__tethra_ready=0
__tethra_preexec() {
  # bash fires DEBUG for EVERY simple command — including our own precmd,
  # other PROMPT_COMMAND parts, completion, and shell startup. Only the
  # FIRST command of a line the user actually ran may emit 133;C; anything
  # else produces phantom blocks and flickering covers.
  [ "$__tethra_ready" = 1 ] || return 0
  [ -n "${COMP_LINE:-}" ] && return 0
  [ "$__tethra_at_prompt" = 1 ] || return 0
  case "$BASH_COMMAND" in
    __tethra_precmd*) return 0 ;;
  esac
  case ";${__tethra_prompt_chain:-};" in
    *";${BASH_COMMAND};"*) return 0 ;;
  esac
  __tethra_at_prompt=0
  __tethra_has_cmd=1
  __tethra_osc '133;C'
}
__tethra_precmd() {
  local __ec=$?
  if [ "$__tethra_has_cmd" -eq 1 ]; then
    __tethra_osc "133;D;${__ec}"
    __tethra_has_cmd=0
  fi
  __tethra_prompt_start
  __tethra_at_prompt=1
  __tethra_ready=1
}
# Idempotent hook install — callable again after user rc files run, in case
# one of them replaced PROMPT_COMMAND or the DEBUG trap.
__tethra_hook() {
  case ";${PROMPT_COMMAND:-};" in
    *";__tethra_precmd;"*) ;;
    *)
      __tethra_prompt_chain="${PROMPT_COMMAND:-}"
      PROMPT_COMMAND="__tethra_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
      ;;
  esac
  trap '__tethra_preexec' DEBUG
}
if [ -z "${TETHRA_SHELL_INTEGRATION:-}" ]; then
  export TETHRA_SHELL_INTEGRATION=1
  __tethra_hook
  # Warp-style Tab: cycle candidates inline (zsh menu-select feel) instead of
  # bash's default bell + reprint-the-list-on-every-press.
  if [ -n "${BASH_VERSION:-}" ]; then
    bind 'set show-all-if-ambiguous on' 2>/dev/null
    bind 'set menu-complete-display-prefix on' 2>/dev/null
    bind '"\t": menu-complete' 2>/dev/null
    bind '"\e[Z": menu-complete-backward' 2>/dev/null
    # Match the local zsh feel: colored candidate lists (dirs/types) and a
    # colored completion prefix. Readline has no moving highlight bar.
    bind 'set colored-stats on' 2>/dev/null
    bind 'set colored-completion-prefix on' 2>/dev/null
    bind 'set visible-stats on' 2>/dev/null
  fi
  # No initial __tethra_prompt_start: PROMPT_COMMAND runs before the first
  # prompt already — an extra call here double-emits A/B.
fi
"#;

/// Zsh script sourced before an interactive zsh session.
pub const ZSH_INTEGRATION: &str = r#"
# Tethra shell integration (zsh) — OSC 133 + OSC 7
export COLORTERM="${COLORTERM:-truecolor}"
typeset -g __tethra_has_cmd=0
__tethra_osc() {
  if [[ -n "${TMUX:-}" ]]; then
    printf '\033Ptmux;\033\033]%s\007\033\\' "$1"
  else
    printf '\033]%s\007' "$1"
  fi
}
__tethra_prompt_start() {
  __tethra_osc '133;A'
  __tethra_osc '133;B'
  __tethra_osc "7;file://${HOST:-}${PWD}"
  local _branch
  _branch=$(command -v git >/dev/null 2>&1 && git branch --show-current 2>/dev/null)
  if [[ -n "$_branch" ]]; then
    __tethra_osc "133;G;${_branch}"
  fi
}
__tethra_preexec() {
  __tethra_has_cmd=1
  __tethra_osc '133;C'
}
__tethra_precmd() {
  local __ec=$?
  if (( __tethra_has_cmd )); then
    __tethra_osc "133;D;${__ec}"
    __tethra_has_cmd=0
  fi
  __tethra_prompt_start
}
if [[ -z "${TETHRA_SHELL_INTEGRATION:-}" ]]; then
  export TETHRA_SHELL_INTEGRATION=1
  autoload -Uz add-zsh-hook 2>/dev/null || true
  add-zsh-hook precmd __tethra_precmd 2>/dev/null || precmd_functions+=(__tethra_precmd)
  add-zsh-hook preexec __tethra_preexec 2>/dev/null || preexec_functions+=(__tethra_preexec)
  # No initial __tethra_prompt_start: precmd runs before the first prompt.
fi
"#;

/// Prepend common user tool paths (Homebrew, etc.) so non-login SSH sessions
/// still find `brew` / `tmux` / CLIs the way Terminal.app does.
const PATH_BOOTSTRAP: &str = r#"
for _tethra_p in /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin /usr/local/sbin "$HOME/.local/bin"; do
  [ -d "$_tethra_p" ] || continue
  case ":$PATH:" in *":$_tethra_p:"*) ;; *) PATH="$_tethra_p:$PATH" ;; esac
done
export PATH
unset _tethra_p
"#;

/// Build a remote `exec` command that installs integration and starts the
/// user's login shell (`$SHELL`), not a hardcoded bash.
///
/// Detects zsh vs bash from `$SHELL` / passwd; unknown shells get COLORTERM
/// only and `exec` the real shell so we never force `bash-3.2` on macOS.
///
/// Important: when we set a temporary `ZDOTDIR` for integration, we must still
/// source the user's real `~/.zprofile` / `~/.zshrc` (Homebrew's `brew shellenv`
/// almost always lives in `.zprofile` on macOS).
pub fn ssh_default_wrapper_command() -> String {
    let bash_b64 = base64_encode(BASH_INTEGRATION.as_bytes());
    let zsh_b64 = base64_encode(ZSH_INTEGRATION.as_bytes());
    format!(
        r#"export COLORTERM="${{COLORTERM:-truecolor}}"
{path_bootstrap}
_shell="${{SHELL:-}}"
if [ -z "$_shell" ] && command -v getent >/dev/null 2>&1; then
  _shell=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)
fi
if [ -z "$_shell" ] && [ -x /usr/bin/dscl ]; then
  _shell=$(dscl . -read "/Users/$(id -un)" UserShell 2>/dev/null | awk '{{print $2}}')
fi
_shell="${{_shell:-/bin/bash}}"
_base=$(basename "$_shell")
case "$_base" in
  zsh)
    _td=$(mktemp -d "${{TMPDIR:-/tmp}}/tethra-si.XXXXXX") || exit 1
    _user_zdot="${{ZDOTDIR:-$HOME}}"
    if command -v base64 >/dev/null 2>&1; then
      echo '{zsh_b64}' | base64 -d > "$_td/.tethra_si"
    else
      printf '%s' '{zsh_escaped}' > "$_td/.tethra_si"
    fi
    # Login files: Homebrew PATH usually lives in ~/.zprofile, not ~/.zshrc.
    {{
      printf '%s\n' 'emulate -L zsh'
      printf '%s\n' '[ -f "'"$_user_zdot"'/.zprofile" ] && source "'"$_user_zdot"'/.zprofile"'
      printf '%s\n' '[ -f "'"$_user_zdot"'/.zlogin" ] && source "'"$_user_zdot"'/.zlogin"'
    }} > "$_td/.zprofile"
    {{
      printf '%s\n' 'source "'"$_td"'/.tethra_si"'
      printf '%s\n' '[ -f "'"$_user_zdot"'/.zshrc" ] && source "'"$_user_zdot"'/.zshrc"'
    }} > "$_td/.zshrc"
    export ZDOTDIR="$_td"
    exec "$_shell" -l -i
    ;;
  bash|sh)
    _t=$(mktemp "${{TMPDIR:-/tmp}}/tethra-si.XXXXXX") || exit 1
    if command -v base64 >/dev/null 2>&1; then
      echo '{bash_b64}' | base64 -d > "$_t"
    else
      printf '%s' '{bash_escaped}' > "$_t"
    fi
    # Login-style profiles first (PATH), then interactive rc.
    if [ -f "$HOME/.bash_profile" ]; then
      printf '\n[ -f "$HOME/.bash_profile" ] && . "$HOME/.bash_profile"\n' >> "$_t"
    elif [ -f "$HOME/.profile" ]; then
      printf '\n[ -f "$HOME/.profile" ] && . "$HOME/.profile"\n' >> "$_t"
    fi
    if [ -f "$HOME/.bashrc" ]; then
      printf '\n[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n' >> "$_t"
    fi
    # A user rc file may have replaced PROMPT_COMMAND or the DEBUG trap —
    # re-install our hooks last (idempotent).
    printf '\ntype __tethra_hook >/dev/null 2>&1 && __tethra_hook\n' >> "$_t"
    exec "$_shell" --rcfile "$_t" -i
    ;;
  *)
    exec "$_shell" -l -i
    ;;
esac"#,
        path_bootstrap = PATH_BOOTSTRAP.trim(),
        zsh_b64 = zsh_b64,
        zsh_escaped = shell_single_quote_escape(ZSH_INTEGRATION),
        bash_b64 = bash_b64,
        bash_escaped = shell_single_quote_escape(BASH_INTEGRATION),
    )
}

/// Persistent variant: run the default wrapper INSIDE a named tmux session
/// (`tmux -L tethra new-session -A`), so the shell — and everything running
/// in it — survives app restarts and disconnects. Falls back to the plain
/// wrapper when tmux is missing. Shell integration still applies because the
/// tmux session's initial command is the wrapper itself.
/// Integration generation stamped on every tmux session we create (via the
/// `session-created` hook). Attaching to a session whose stamp is older —
/// or missing entirely — replaces it: the shell inside predates the OSC
/// passthrough emitter and can never produce block marks again.
pub const TMUX_INTEGRATION_VERSION: &str = "3";

pub fn ssh_persistent_wrapper_command(mux_session: &str) -> String {
    let inner = ssh_default_wrapper_command();
    let inner_b64 = base64_encode(inner.as_bytes());
    let inner_escaped = shell_single_quote_escape(&inner);
    format!(
        r#"{path_bootstrap}
_tw=$(mktemp "${{TMPDIR:-/tmp}}/tethra-wrap.XXXXXX") || exit 1
if command -v base64 >/dev/null 2>&1; then
  echo '{inner_b64}' | base64 -d > "$_tw"
else
  printf '%s' '{inner_escaped}' > "$_tw"
fi
if command -v tmux >/dev/null 2>&1; then
  _tc=$(mktemp "${{TMPDIR:-/tmp}}/tethra-tmux.XXXXXX") || exit 1
  cat > "$_tc" <<'TETHRA_TMUX_EOF'
set -g status off
set -g allow-passthrough on
set -sg escape-time 0
set -g focus-events on
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",*256col*:Tc"
set -ga terminal-overrides ",*:smcup@:rmcup@"
set -g history-limit 100000
setw -g monitor-bell on
set -g visual-bell off
set -g bell-action any
TETHRA_TMUX_EOF
  # Session boot script: stamp the integration version from INSIDE the first
  # pane (deterministic on every tmux version — no hooks), then start the
  # integrated shell.
  _ts=$(mktemp "${{TMPDIR:-/tmp}}/tethra-boot.XXXXXX") || exit 1
  {{
    printf '%s\n' 'tmux -L tethra set @tethra_iv {iv} 2>/dev/null || true'
    printf 'exec sh "%s"\n' "$_tw"
  }} > "$_ts"
  # Server may predate this conf (agent sessions share the socket) — apply
  # the invisibility settings idempotently on every attach: no status bar, no
  # alternate screen (tmux draws inline like a plain shell), passthrough on
  # so OSC 133/7 marks reach the app. Fails harmlessly when no server runs —
  # then `new-session -f` below boots the server WITH this conf.
  tmux -L tethra set -g status off \; set -g allow-passthrough on \; set -sg escape-time 0 \; set -g focus-events on \; set -ga terminal-overrides ',*:smcup@:rmcup@' \; set -g history-limit 100000 2>/dev/null || true
  # Sessions from builds that predate the OSC passthrough emitter can never
  # show block chrome again — replace them once; stamped sessions are kept.
  if tmux -L tethra has-session -t '{name}' 2>/dev/null; then
    _iv=$(tmux -L tethra show-options -qv -t '{name}' @tethra_iv 2>/dev/null)
    case "$_iv" in
      {iv}) ;;
      *) tmux -L tethra kill-session -t '{name}' 2>/dev/null || true ;;
    esac
  fi
  exec tmux -L tethra -f "$_tc" new-session -A -s '{name}' -- sh "$_ts"
fi
exec sh "$_tw"
"#,
        path_bootstrap = PATH_BOOTSTRAP,
        inner_b64 = inner_b64,
        inner_escaped = inner_escaped,
        name = mux_session,
        iv = TMUX_INTEGRATION_VERSION,
    )
}

/// Bash-only wrapper (tests / explicit callers).
pub fn ssh_bash_wrapper_command() -> String {
    let b64 = base64_encode(BASH_INTEGRATION.as_bytes());
    format!(
        "{path_bootstrap}; export COLORTERM=\"${{COLORTERM:-truecolor}}\"; \
         _t=$(mktemp \"${{TMPDIR:-/tmp}}/tethra-si.XXXXXX\") && \
         (command -v base64 >/dev/null && echo '{b64}' | base64 -d > \"$_t\" || printf '%s' '{escaped}' > \"$_t\") && \
         {{ [ -f \"$HOME/.bash_profile\" ] && printf '\\n. \"$HOME/.bash_profile\"\\n' >> \"$_t\"; \
            [ -f \"$HOME/.bashrc\" ] && printf '\\n. \"$HOME/.bashrc\"\\n' >> \"$_t\"; }} ; \
         exec bash --rcfile \"$_t\" -i",
        path_bootstrap = PATH_BOOTSTRAP.trim().replace('\n', " "),
        b64 = b64,
        escaped = shell_single_quote_escape(BASH_INTEGRATION),
    )
}

/// Zsh-only wrapper (tests / explicit callers).
pub fn ssh_zsh_wrapper_command() -> String {
    let b64 = base64_encode(ZSH_INTEGRATION.as_bytes());
    format!(
        r#"{path_bootstrap}
export COLORTERM="${{COLORTERM:-truecolor}}"
_td=$(mktemp -d "${{TMPDIR:-/tmp}}/tethra-si.XXXXXX") || exit 1
_user_zdot="${{ZDOTDIR:-$HOME}}"
(command -v base64 >/dev/null && echo '{b64}' | base64 -d > "$_td/.tethra_si" || true)
printf '%s\n' '[ -f "'"$_user_zdot"'/.zprofile" ] && source "'"$_user_zdot"'/.zprofile"' > "$_td/.zprofile"
printf '%s\n' 'source "'"$_td"'/.tethra_si"' '[ -f "'"$_user_zdot"'/.zshrc" ] && source "'"$_user_zdot"'/.zshrc"' > "$_td/.zshrc"
export ZDOTDIR="$_td"
exec zsh -l -i"#,
        path_bootstrap = PATH_BOOTSTRAP.trim(),
        b64 = b64,
    )
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn shell_single_quote_escape(s: &str) -> String {
    s.replace('\'', "'\\''")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bash_wrapper_contains_markers() {
        let cmd = ssh_bash_wrapper_command();
        assert!(cmd.contains("bash --rcfile"));
        assert!(cmd.contains("COLORTERM"));
    }

    #[test]
    fn default_wrapper_picks_shell_from_environment() {
        let cmd = ssh_default_wrapper_command();
        assert!(cmd.contains("basename \"$_shell\""));
        assert!(cmd.contains("zsh)"));
        assert!(cmd.contains("bash|sh)"));
        assert!(cmd.contains("COLORTERM"));
        assert!(cmd.contains("/opt/homebrew/bin"));
        assert!(cmd.contains("_user_zdot"));
        assert!(cmd.contains(".zprofile"));
        assert!(cmd.contains("-l -i"));
    }

    #[test]
    fn integration_scripts_emit_osc133() {
        assert!(BASH_INTEGRATION.contains("133;A"));
        assert!(BASH_INTEGRATION.contains("133;D"));
        assert!(ZSH_INTEGRATION.contains("133;C"));
    // OSC 7 cwd now goes through the tmux-passthrough emitter.
    assert!(ZSH_INTEGRATION.contains("7;file://"));
    assert!(BASH_INTEGRATION.contains("133;G;"));
    assert!(ZSH_INTEGRATION.contains("133;G;"));
    // Marks must survive tmux (passthrough envelope + emitter).
    assert!(BASH_INTEGRATION.contains("Ptmux;"));
    assert!(ZSH_INTEGRATION.contains("Ptmux;"));
  }

    #[test]
    fn persistent_wrapper_is_invisible_and_versioned() {
        let cmd = ssh_persistent_wrapper_command("tethra-test1");
        // Invisible tmux: no status bar, no alt screen, passthrough on —
        // applied both via conf and idempotently on every attach.
        assert!(cmd.contains("set -g status off"));
        assert!(cmd.contains("allow-passthrough on"));
        assert!(cmd.contains("smcup@:rmcup@"));
        // Every created session stamps itself from inside its first pane.
        assert!(cmd.contains(&format!("@tethra_iv {TMUX_INTEGRATION_VERSION}")));
        // Attaching to a pre-passthrough session replaces it.
        assert!(cmd.contains("kill-session -t 'tethra-test1'"));
        assert!(cmd.contains(&format!("{TMUX_INTEGRATION_VERSION}) ;;")));
        // Client attached from shell birth so first-prompt marks arrive, and
        // the conf boots the server when none is running (fresh host).
        assert!(cmd.contains("-f \"$_tc\" new-session -A -s 'tethra-test1'"));
        // No tmux on host → plain wrapper fallback.
        assert!(cmd.contains("exec sh \"$_tw\""));
    }
}
