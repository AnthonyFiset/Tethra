//! systemd --user unit install / uninstall.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub const UNIT_NAME: &str = "tethra-sync.service";

pub fn unit_path() -> Result<PathBuf, String> {
    let home = crate::config::home_dir().ok_or("HOME is not set")?;
    Ok(home
        .join(".config")
        .join("systemd")
        .join("user")
        .join(UNIT_NAME))
}

/// Write the unit and `systemctl enable`. When `start_now` is true, also `--now`.
pub fn install_with_options(start_now: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let exe = exe.canonicalize().unwrap_or(exe).display().to_string();

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

pub fn uninstall() -> Result<(), String> {
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
