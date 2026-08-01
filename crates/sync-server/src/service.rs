//! systemd --user unit install / uninstall.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub const UNIT_NAME: &str = "tethra-sync.service";
pub const UPDATES_SERVICE: &str = "tethra-updates.service";
pub const UPDATES_TIMER: &str = "tethra-updates.timer";

pub fn unit_path() -> Result<PathBuf, String> {
    let home = crate::config::home_dir().ok_or("HOME is not set")?;
    Ok(home
        .join(".config")
        .join("systemd")
        .join("user")
        .join(UNIT_NAME))
}

fn user_unit_dir() -> Result<PathBuf, String> {
    let home = crate::config::home_dir().ok_or("HOME is not set")?;
    Ok(home.join(".config").join("systemd").join("user"))
}

fn current_exe_string() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    Ok(exe.canonicalize().unwrap_or(exe).display().to_string())
}

/// Write the unit and `systemctl enable`. When `start_now` is true, also `--now`.
pub fn install_with_options(start_now: bool) -> Result<(), String> {
    let exe = current_exe_string()?;

    let path = unit_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }

    let unit = format!(
        r#"[Unit]
Description=Tethra vault sync server
After=network-online.target
Wants=network-online.target

[Service]
ExecStart={exe} serve
Restart=on-failure
RestartSec=3
Environment=RUST_LOG=tethra_sync_server=info

[Install]
WantedBy=default.target
"#
    );
    fs::write(&path, unit).map_err(|e| format!("write {}: {e}", path.display()))?;

    systemctl(&["daemon-reload"])?;
    if start_now {
        systemctl(&["enable", "--now", UNIT_NAME])?;
    } else {
        systemctl(&["enable", UNIT_NAME])?;
        // Avoid racing the interactive TUI for the listen port.
        let _ = systemctl(&["stop", UNIT_NAME]);
    }
    Ok(())
}

/// Install an hourly timer that runs `fetch-updates` so clients see new releases
/// without a manual mirror on the sync host.
pub fn install_updates_timer() -> Result<(), String> {
    let exe = current_exe_string()?;
    let dir = user_unit_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let service = format!(
        r#"[Unit]
Description=Mirror Tethra release assets

[Service]
Type=oneshot
ExecStart={exe} fetch-updates
"#
    );
    let timer = r#"[Unit]
Description=Check for new Tethra releases hourly

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
Persistent=true

[Install]
WantedBy=timers.target
"#;

    let service_path = dir.join(UPDATES_SERVICE);
    let timer_path = dir.join(UPDATES_TIMER);
    fs::write(&service_path, service)
        .map_err(|e| format!("write {}: {e}", service_path.display()))?;
    fs::write(&timer_path, timer).map_err(|e| format!("write {}: {e}", timer_path.display()))?;

    systemctl(&["daemon-reload"])?;
    systemctl(&["enable", "--now", UPDATES_TIMER])?;
    Ok(())
}

pub fn uninstall_updates_timer() -> Result<(), String> {
    let _ = systemctl(&["disable", "--now", UPDATES_TIMER]);
    let dir = user_unit_dir()?;
    for name in [UPDATES_SERVICE, UPDATES_TIMER] {
        let path = dir.join(name);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        }
    }
    let _ = systemctl(&["daemon-reload"]);
    Ok(())
}

pub fn uninstall() -> Result<(), String> {
    let _ = uninstall_updates_timer();
    let _ = systemctl(&["disable", "--now", UNIT_NAME]);
    let path = unit_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    let _ = systemctl(&["daemon-reload"]);
    Ok(())
}

pub fn is_enabled() -> bool {
    systemctl_status_ok(&["is-enabled", UNIT_NAME])
}

pub fn is_active() -> bool {
    systemctl_status_ok(&["is-active", UNIT_NAME])
}

pub fn service_label() -> String {
    match (is_enabled(), is_active()) {
        (true, true) => "enabled + active (user)".into(),
        (true, false) => "enabled, inactive (user)".into(),
        (false, true) => "active but not enabled (user)".into(),
        (false, false) => {
            if unit_path().map(|p| p.exists()).unwrap_or(false) {
                "unit present, not enabled".into()
            } else {
                "not installed".into()
            }
        }
    }
}

fn systemctl(args: &[&str]) -> Result<(), String> {
    let status = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .status()
        .map_err(|e| {
            format!(
                "systemctl --user {}: {e} (is systemd user session available?)",
                args.join(" ")
            )
        })?;
    if !status.success() {
        return Err(format!(
            "systemctl --user {} failed with {status}",
            args.join(" ")
        ));
    }
    Ok(())
}

fn systemctl_status_ok(args: &[&str]) -> bool {
    Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
