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
__tethra_prompt_start() {
  printf '\033]133;A\007'
  printf '\033]133;B\007'
  local _host="${HOSTNAME:-}"
  printf '\033]7;file://%s%s\007' "$_host" "$PWD"
  local _branch
  _branch=$(command -v git >/dev/null 2>&1 && git branch --show-current 2>/dev/null)
  if [ -n "$_branch" ]; then
    printf '\033]133;G;%s\007' "$_branch"
  fi
}
__tethra_preexec() {
  __tethra_has_cmd=1
  printf '\033]133;C\007'
}
__tethra_precmd() {
  local __ec=$?
  if [ "$__tethra_has_cmd" -eq 1 ]; then
    printf '\033]133;D;%s\007' "$__ec"
    __tethra_has_cmd=0
  fi
  __tethra_prompt_start
}
if [ -z "${TETHRA_SHELL_INTEGRATION:-}" ]; then
  export TETHRA_SHELL_INTEGRATION=1
  if [[ -n "${PROMPT_COMMAND:-}" ]]; then
    PROMPT_COMMAND="__tethra_precmd;${PROMPT_COMMAND}"
  else
    PROMPT_COMMAND="__tethra_precmd"
  fi
  trap '__tethra_preexec' DEBUG
  # Warp-style Tab: cycle candidates inline (zsh menu-select feel) instead of
  # bash's default bell + reprint-the-list-on-every-press.
  if [ -n "${BASH_VERSION:-}" ]; then
    bind 'set show-all-if-ambiguous on' 2>/dev/null
    bind 'set menu-complete-display-prefix on' 2>/dev/null
    bind '"\t": menu-complete' 2>/dev/null
    bind '"\e[Z": menu-complete-backward' 2>/dev/null
  fi
  __tethra_prompt_start
fi
"#;

/// Zsh script sourced before an interactive zsh session.
pub const ZSH_INTEGRATION: &str = r#"
# Tethra shell integration (zsh) — OSC 133 + OSC 7
export COLORTERM="${COLORTERM:-truecolor}"
typeset -g __tethra_has_cmd=0
__tethra_prompt_start() {
  printf '\033]133;A\007'
  printf '\033]133;B\007'
  printf '\033]7;file://%s%s\007' "${HOST:-}" "${PWD}"
  local _branch
  _branch=$(command -v git >/dev/null 2>&1 && git branch --show-current 2>/dev/null)
  if [[ -n "$_branch" ]]; then
    printf '\033]133;G;%s\007' "$_branch"
  fi
}
__tethra_preexec() {
  __tethra_has_cmd=1
  printf '\033]133;C\007'
}
__tethra_precmd() {
  local __ec=$?
  if (( __tethra_has_cmd )); then
    printf '\033]133;D;%s\007' "$__ec"
    __tethra_has_cmd=0
  fi
  __tethra_prompt_start
}
if [[ -z "${TETHRA_SHELL_INTEGRATION:-}" ]]; then
  export TETHRA_SHELL_INTEGRATION=1
  autoload -Uz add-zsh-hook 2>/dev/null || true
  add-zsh-hook precmd __tethra_precmd 2>/dev/null || precmd_functions+=(__tethra_precmd)
  add-zsh-hook preexec __tethra_preexec 2>/dev/null || preexec_functions+=(__tethra_preexec)
  __tethra_prompt_start
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
    assert!(ZSH_INTEGRATION.contains("]7;file://"));
    assert!(BASH_INTEGRATION.contains("133;G;"));
    assert!(ZSH_INTEGRATION.contains("133;G;"));
  }
}
