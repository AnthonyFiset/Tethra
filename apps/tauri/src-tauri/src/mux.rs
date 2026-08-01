//! Detect / install multiplexers and probe host tools (tmux, agent CLIs).

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;
use ssh_client_core::ssh::Action;
use tauri::State;
use ts_rs::TS;

use crate::{AppState, parse_uuid, redacted_error};

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct MuxEnsureResultDto {
    platform: String,
    available: bool,
    kind: Option<String>,
    path: Option<String>,
    installed: bool,
    title: Option<String>,
    body: Option<String>,
    install_command: Option<String>,
    can_auto_install: bool,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct MissingToolDto {
    /// Stable id: `tmux`, `claude`, …
    id: String,
    /// Human label.
    label: String,
    /// Why it matters.
    reason: String,
    /// Exact install command for the probed OS (no multi-OS mashup).
    install_command: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct ToolsProbeDto {
    /// `macos` | `linux` | `windows` | `unknown`
    platform: String,
    /// Raw `uname -s` when available.
    uname: Option<String>,
    has_tmux: bool,
    has_zellij: bool,
    has_brew: bool,
    /// Tools that are missing and worth installing.
    missing: Vec<MissingToolDto>,
}

fn host_platform() -> String {
    if cfg!(target_os = "macos") {
        "macos".into()
    } else if cfg!(target_os = "linux") {
        "linux".into()
    } else if cfg!(target_os = "windows") {
        "windows".into()
    } else {
        std::env::consts::OS.into()
    }
}

fn look_up(program: &str) -> Option<PathBuf> {
    let file_name = if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_string()
    };

    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join(&file_name));
            candidates.push(dir.join(program));
        }
    }
    for dir in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
    ] {
        candidates.push(PathBuf::from(dir).join(&file_name));
        candidates.push(PathBuf::from(dir).join(program));
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn find_mux() -> Option<(String, PathBuf)> {
    if let Some(path) = look_up("tmux") {
        return Some(("tmux".into(), path));
    }
    if let Some(path) = look_up("zellij") {
        return Some(("zellij".into(), path));
    }
    None
}

fn passwordless_sudo() -> bool {
    Command::new("sudo")
        .args(["-n", "true"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn linux_tmux_install(has_brew: bool) -> (String, bool) {
    if has_brew {
        return ("brew install tmux".into(), true);
    }
    if look_up("apt-get").is_some() || look_up("apt").is_some() {
        return ("sudo apt-get install -y tmux".into(), passwordless_sudo());
    }
    if look_up("dnf").is_some() {
        return ("sudo dnf install -y tmux".into(), passwordless_sudo());
    }
    if look_up("pacman").is_some() {
        return (
            "sudo pacman -S --noconfirm tmux".into(),
            passwordless_sudo(),
        );
    }
    ("sudo apt install tmux".into(), false)
}

fn platform_from_uname(uname: &str) -> String {
    let u = uname.trim().to_ascii_lowercase();
    if u.contains("darwin") {
        "macos".into()
    } else if u.contains("linux") {
        "linux".into()
    } else if u.contains("mingw") || u.contains("msys") || u.contains("cygwin") {
        "windows".into()
    } else if u.is_empty() {
        "unknown".into()
    } else {
        u
    }
}

fn install_for(tool: &str, platform: &str, has_brew: bool) -> Option<(String, String, String)> {
    // (id, label, command)
    match (tool, platform) {
        ("tmux", "macos") => Some(("tmux".into(), "tmux".into(), "brew install tmux".into())),
        ("tmux", "linux") => {
            let (cmd, _) = linux_tmux_install(has_brew);
            Some(("tmux".into(), "tmux".into(), cmd))
        }
        ("tmux", "windows") => Some((
            "tmux".into(),
            "tmux (WSL)".into(),
            "wsl -- sudo apt-get install -y tmux".into(),
        )),
        ("zellij", "macos") => Some((
            "zellij".into(),
            "zellij".into(),
            "brew install zellij".into(),
        )),
        ("zellij", "linux") if has_brew => Some((
            "zellij".into(),
            "zellij".into(),
            "brew install zellij".into(),
        )),
        _ => {
            let preset = ssh_client_core::agents::agent_preset_by_command(tool)
                .ok()
                .flatten()?;
            let cmd = match (platform, has_brew) {
                ("macos", false)
                    if preset
                        .install
                        .macos
                        .as_deref()
                        .is_some_and(|c| c.contains("brew")) =>
                {
                    preset
                        .install
                        .default
                        .as_deref()
                        .or(preset.install.macos.as_deref())
                }
                _ => preset.install.for_platform(platform),
            }?;
            Some((
                preset.command.clone(),
                preset.display_name.clone(),
                cmd.to_string(),
            ))
        }
    }
}

fn reason_for(tool: &str) -> String {
    match tool {
        "tmux" => "Keeps project sessions alive across disconnects and quitting Tethra.".into(),
        "zellij" => "Alternative multiplexer when tmux is unavailable.".into(),
        other => {
            if let Ok(Some(preset)) = ssh_client_core::agents::agent_preset_by_command(other) {
                format!(
                    "Required to launch the {} agent for this project.",
                    preset.display_name
                )
            } else {
                "Required for this project’s default agent.".into()
            }
        }
    }
}

fn probe_script(extra_commands: &[String]) -> String {
    let mut extras = String::new();
    for cmd in extra_commands {
        let key = cmd.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
        extras.push_str(&format!(
            "if command -v {cmd} >/dev/null 2>&1; then echo cmd_{key}=1; else echo cmd_{key}=0; fi\n"
        ));
    }
    format!(
        r#"
for _p in /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin /usr/local/sbin "$HOME/.local/bin"; do
  [ -d "$_p" ] || continue
  case ":$PATH:" in *":$_p:"*) ;; *) PATH="$_p:$PATH" ;; esac
done
export PATH
# Load login PATH when possible (Homebrew shellenv lives in zprofile).
[ -f "$HOME/.zprofile" ] && . "$HOME/.zprofile" >/dev/null 2>&1 || true
[ -f "$HOME/.bash_profile" ] && . "$HOME/.bash_profile" >/dev/null 2>&1 || true
echo TETHRA_PROBE_BEGIN
echo uname=$(uname -s 2>/dev/null || echo unknown)
if command -v tmux >/dev/null 2>&1; then echo tmux=1; else echo tmux=0; fi
if command -v zellij >/dev/null 2>&1; then echo zellij=1; else echo zellij=0; fi
if command -v brew >/dev/null 2>&1; then echo brew=1; else echo brew=0; fi
{extras}
echo TETHRA_PROBE_END
"#
    )
}

fn parse_probe(stdout: &str, want_tools: &[String]) -> ToolsProbeDto {
    let mut uname = String::new();
    let mut has_tmux = false;
    let mut has_zellij = false;
    let mut has_brew = false;
    let mut cmd_hits: std::collections::HashMap<String, bool> = std::collections::HashMap::new();

    let mut in_block = false;
    for line in stdout.lines() {
        let line = line.trim();
        if line == "TETHRA_PROBE_BEGIN" {
            in_block = true;
            continue;
        }
        if line == "TETHRA_PROBE_END" {
            break;
        }
        if !in_block {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            match k {
                "uname" => uname = v.to_string(),
                "tmux" => has_tmux = v == "1",
                "zellij" => has_zellij = v == "1",
                "brew" => has_brew = v == "1",
                other if other.starts_with("cmd_") => {
                    cmd_hits.insert(other[4..].to_string(), v == "1");
                }
                _ => {}
            }
        }
    }

    let platform = if uname.is_empty() {
        host_platform()
    } else {
        platform_from_uname(&uname)
    };

    let mut missing = Vec::new();

    // Persistence: need tmux or zellij.
    if !has_tmux
        && !has_zellij
        && let Some((id, label, cmd)) = install_for("tmux", &platform, has_brew)
    {
        missing.push(MissingToolDto {
            id,
            label,
            reason: reason_for("tmux"),
            install_command: cmd,
        });
    }

    for tool in want_tools {
        if tool.is_empty() || tool == "tmux" || tool == "zellij" {
            continue;
        }
        let key = tool.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
        let present = cmd_hits.get(&key).copied().unwrap_or(false);
        if present {
            continue;
        }
        if let Some((id, label, cmd)) = install_for(tool, &platform, has_brew) {
            missing.push(MissingToolDto {
                id,
                label,
                reason: reason_for(tool),
                install_command: cmd,
            });
        } else {
            missing.push(MissingToolDto {
                id: tool.clone(),
                label: tool.clone(),
                reason: reason_for(tool),
                install_command: format!(
                    "# install `{tool}` for this host, then reopen the project"
                ),
            });
        }
    }

    ToolsProbeDto {
        platform,
        uname: if uname.is_empty() { None } else { Some(uname) },
        has_tmux,
        has_zellij,
        has_brew,
        missing,
    }
}

fn run_local_probe(script: &str) -> Result<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let output = Command::new(&shell)
        .args(["-lc", script])
        .output()
        .map_err(|error| format!("local probe failed: {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Probe local or remote host for tmux / agent CLIs. Only reports what is missing.
/// `commands` are extra binaries to require (e.g. `claude`, `codex`); empty entries skipped.
#[tauri::command]
pub async fn probe_host_tools(
    state: State<'_, AppState>,
    host_id: Option<String>,
    commands: Vec<String>,
) -> Result<ToolsProbeDto, String> {
    let want: Vec<String> = commands
        .into_iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .collect();
    let script = probe_script(&want);

    let stdout = if let Some(id) = host_id {
        let host_uuid = parse_uuid(&id, "host")?;
        state
            .approval_gate
            .approve(&Action::Exec {
                host_id: host_uuid,
                command: "probe_host_tools".into(),
            })
            .await
            .map_err(redacted_error)?;
        let result = state
            .manager
            .exec(host_uuid, &script)
            .await
            .map_err(redacted_error)?;
        String::from_utf8_lossy(&result.stdout).into_owned()
    } else {
        tokio::task::spawn_blocking(move || run_local_probe(&script))
            .await
            .map_err(|error| error.to_string())??
    };

    Ok(parse_probe(&stdout, &want))
}

fn missing_hint(platform: &str) -> MuxEnsureResultDto {
    let (title, body, install_command, can_auto_install) = match platform {
        "macos" => {
            let has_brew = look_up("brew").is_some();
            (
                Some("Install tmux for full session persistence".into()),
                Some(
                    "Projects already resume when you close a tab and reopen them. \
                     Install tmux so sessions also survive quitting Tethra."
                        .into(),
                ),
                Some("brew install tmux".into()),
                has_brew,
            )
        }
        "linux" => {
            let (cmd, auto) = linux_tmux_install(look_up("brew").is_some());
            (
                Some("Install tmux for full session persistence".into()),
                Some(
                    "Projects already resume when you close a tab and reopen them. \
                     Install tmux so sessions also survive quitting Tethra."
                        .into(),
                ),
                Some(cmd),
                auto,
            )
        }
        "windows" => (
            Some("tmux is optional on Windows".into()),
            Some(
                "Local projects already resume while Tethra is running. For sessions \
                 that survive quitting the app, use a remote Unix host with tmux."
                    .into(),
            ),
            Some("wsl -- sudo apt-get install -y tmux".into()),
            false,
        ),
        _ => (
            Some("Install tmux for full session persistence".into()),
            Some("Install tmux so project sessions survive quitting Tethra.".into()),
            Some("Install tmux via your system package manager".into()),
            false,
        ),
    };

    MuxEnsureResultDto {
        platform: platform.into(),
        available: false,
        kind: None,
        path: None,
        installed: false,
        title,
        body: body.clone(),
        install_command,
        can_auto_install,
        message: body,
    }
}

fn available_status(kind: String, path: PathBuf, installed: bool) -> MuxEnsureResultDto {
    MuxEnsureResultDto {
        platform: host_platform(),
        available: true,
        kind: Some(kind),
        path: Some(path.display().to_string()),
        installed,
        title: None,
        body: None,
        install_command: None,
        can_auto_install: false,
        message: if installed {
            Some("Installed tmux — project sessions can now survive quitting Tethra.".into())
        } else {
            None
        },
    }
}

fn run_install(command: &str, args: &[&str]) -> Result<(), String> {
    let status = Command::new(command)
        .args(args)
        .status()
        .map_err(|error| format!("failed to run {command}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "{command} {} exited with {}",
            args.join(" "),
            status
        ))
    }
}

#[tauri::command]
pub async fn detect_local_mux() -> Result<MuxEnsureResultDto, String> {
    let platform = host_platform();
    if let Some((kind, path)) = find_mux() {
        return Ok(available_status(kind, path, false));
    }
    Ok(missing_hint(&platform))
}

#[tauri::command]
pub async fn install_local_mux(state: State<'_, AppState>) -> Result<MuxEnsureResultDto, String> {
    if let Some((kind, path)) = find_mux() {
        return Ok(available_status(kind, path, false));
    }

    let platform = host_platform();
    let hint = missing_hint(&platform);
    if !hint.can_auto_install {
        return Ok(hint);
    }

    let command = hint
        .install_command
        .clone()
        .ok_or_else(|| "no install command for this platform".to_string())?;

    state
        .approval_gate
        .approve(&Action::LocalExec {
            command: command.clone(),
        })
        .await
        .map_err(redacted_error)?;

    if command.starts_with("brew ") {
        run_install("brew", &["install", "tmux"])?;
    } else if command.contains("apt-get") {
        run_install("sudo", &["-n", "apt-get", "install", "-y", "tmux"])?;
    } else if command.contains("dnf") {
        run_install("sudo", &["-n", "dnf", "install", "-y", "tmux"])?;
    } else if command.contains("pacman") {
        run_install("sudo", &["-n", "pacman", "-S", "--noconfirm", "tmux"])?;
    } else {
        return Err(format!(
            "refusing to auto-run unrecognized install: {command}"
        ));
    }

    if let Some((kind, path)) = find_mux() {
        return Ok(available_status(kind, path, true));
    }

    Err("install finished but tmux was not found on PATH — open a new terminal and retry".into())
}

#[tauri::command]
pub async fn ensure_local_mux() -> Result<MuxEnsureResultDto, String> {
    detect_local_mux().await
}

#[tauri::command]
pub async fn terminal_session_alive(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, String> {
    let id = parse_uuid(&session_id, "session")?;
    if state.local_sessions.lock().await.contains_key(&id) {
        return Ok(true);
    }
    Ok(state.sessions.lock().await.contains_key(&id))
}

/// Kill a tmux/zellij session by name on a remote host (or locally when `host_id` is None).
#[tauri::command]
pub async fn kill_mux_session(
    state: State<'_, AppState>,
    host_id: Option<String>,
    mux_session: String,
) -> Result<(), String> {
    let name = mux_session.trim();
    if name.is_empty() || name.contains('\'') || name.contains('\n') {
        return Err("invalid mux session name".into());
    }
    let script = mux_kill_script(name);

    if let Some(id) = host_id {
        let host_uuid = parse_uuid(&id, "host")?;
        state
            .approval_gate
            .approve(&Action::Exec {
                host_id: host_uuid,
                command: format!("kill_mux:{name}"),
            })
            .await
            .map_err(redacted_error)?;
        let _ = state
            .manager
            .exec(host_uuid, &script)
            .await
            .map_err(redacted_error)?;
        Ok(())
    } else {
        run_local_script(&script).await.map(|_| ())
    }
}

fn mux_kill_script(name: &str) -> String {
    format!(
        r#"
for _p in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  [ -d "$_p" ] || continue
  case ":$PATH:" in *":$_p:"*) ;; *) PATH="$_p:$PATH" ;; esac
done
export PATH
if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t '{name}' 2>/dev/null || true
fi
if command -v zellij >/dev/null 2>&1; then
  zellij kill-session '{name}' 2>/dev/null || zellij delete-session -f '{name}' 2>/dev/null || true
fi
"#
    )
}

fn mux_alive_script(name: &str) -> String {
    format!(
        r#"
for _p in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  [ -d "$_p" ] || continue
  case ":$PATH:" in *":$_p:"*) ;; *) PATH="$_p:$PATH" ;; esac
done
export PATH
echo TETHRA_MUX_BEGIN
if command -v tmux >/dev/null 2>&1 && tmux has-session -t '{name}' 2>/dev/null; then
  echo alive=1
elif command -v zellij >/dev/null 2>&1 && zellij list-sessions 2>/dev/null | grep -F '{name}' >/dev/null; then
  echo alive=1
else
  echo alive=0
fi
echo TETHRA_MUX_END
"#
    )
}

fn parse_mux_alive(stdout: &str) -> bool {
    let mut in_block = false;
    for line in stdout.lines() {
        let line = line.trim();
        if line == "TETHRA_MUX_BEGIN" {
            in_block = true;
            continue;
        }
        if line == "TETHRA_MUX_END" {
            break;
        }
        if in_block && line == "alive=1" {
            return true;
        }
    }
    false
}

async fn run_local_script(script: &str) -> Result<String, String> {
    let script = script.to_string();
    tokio::task::spawn_blocking(move || {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let output = Command::new(shell)
            .args(["-lc", &script])
            .output()
            .map_err(|error| format!("local script failed: {error}"))?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Drop vault Running markers whose mux session is already gone on the host.
#[tauri::command]
pub async fn prune_stale_running_sessions(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let sessions = state
        .repo
        .list_running_sessions()
        .await
        .map_err(redacted_error)?;
    let mut removed = 0usize;
    for session in sessions {
        let script = mux_alive_script(&session.mux_session);
        let alive = match state
            .approval_gate
            .approve(&Action::Exec {
                host_id: session.host_id,
                command: format!("probe_mux:{}", session.mux_session),
            })
            .await
        {
            Ok(()) => match state.manager.exec(session.host_id, &script).await {
                Ok(result) => parse_mux_alive(&String::from_utf8_lossy(&result.stdout)),
                Err(_) => true, // don't prune if we can't reach the host
            },
            Err(_) => true,
        };
        if !alive {
            state
                .repo
                .end_running_session(session.id)
                .await
                .map_err(redacted_error)?;
            removed += 1;
        }
    }
    if removed > 0 {
        crate::sync::schedule_background_sync(app, &state);
    }
    Ok(removed)
}

#[allow(dead_code)]
pub fn export_bindings(cfg: &ts_rs::Config) {
    MuxEnsureResultDto::export_all(cfg).unwrap();
    MissingToolDto::export_all(cfg).unwrap();
    ToolsProbeDto::export_all(cfg).unwrap();
}
