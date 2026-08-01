//! Local shell wrapper that injects OSC 133 / OSC 7 integration without
//! editing user dotfiles.

use std::fs;
use std::path::PathBuf;

use platform::ShellSpec;
use ssh_client_core::terminal::{BASH_INTEGRATION, ZSH_INTEGRATION};

/// Wrap a local [`ShellSpec`] so the interactive shell loads Tethra integration.
/// On I/O failure, returns the original spec unchanged.
pub fn wrap_local_shell(spec: ShellSpec) -> ShellSpec {
    match wrap_inner(&spec) {
        Ok(wrapped) => wrapped,
        Err(_) => spec,
    }
}

fn wrap_inner(spec: &ShellSpec) -> std::io::Result<ShellSpec> {
    let name = spec
        .program
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut env = spec.env.clone();
    if !env.iter().any(|(k, _)| k == "COLORTERM") {
        env.push(("COLORTERM".into(), "truecolor".into()));
    }
    // GUI apps on macOS often start with a minimal PATH; prepend Homebrew so
    // detect/install helpers and child shells see the same tools as Terminal.app.
    prepend_common_path(&mut env);

    if name.contains("zsh") {
        let dir = write_zsh_zdotdir()?;
        env.push(("ZDOTDIR".into(), dir.to_string_lossy().into_owned()));
        let mut args = Vec::new();
        // Always login+interactive so ~/.zprofile (Homebrew) loads.
        args.push("-l".into());
        args.push("-i".into());
        return Ok(ShellSpec {
            program: spec.program.clone(),
            args,
            cwd: spec.cwd.clone(),
            env,
        });
    }

    if name.contains("bash") || name == "sh" {
        let rcfile = write_bash_rcfile()?;
        let args = vec![
            "--rcfile".into(),
            rcfile.to_string_lossy().into_owned(),
            "-i".into(),
        ];
        let program = if name == "sh" {
            PathBuf::from("bash")
        } else {
            spec.program.clone()
        };
        return Ok(ShellSpec {
            program,
            args,
            cwd: spec.cwd.clone(),
            env,
        });
    }

    Ok(ShellSpec {
        program: spec.program.clone(),
        args: spec.args.clone(),
        cwd: spec.cwd.clone(),
        env,
    })
}

fn prepend_common_path(env: &mut Vec<(String, String)>) {
    let extras = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
    ];
    let current = env
        .iter()
        .find(|(k, _)| k == "PATH")
        .map(|(_, v)| v.clone())
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default();
    let mut parts: Vec<String> = extras
        .iter()
        .filter(|p| PathBuf::from(p).is_dir())
        .map(|p| (*p).to_string())
        .collect();
    for part in std::env::split_paths(&current) {
        let s = part.to_string_lossy().into_owned();
        if !s.is_empty() && !parts.iter().any(|p| p == &s) {
            parts.push(s);
        }
    }
    let joined = parts.join(":");
    if let Some((_, value)) = env.iter_mut().find(|(k, _)| k == "PATH") {
        *value = joined;
    } else {
        env.push(("PATH".into(), joined));
    }
}

fn write_bash_rcfile() -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join("tethra-shell-integration");
    fs::create_dir_all(&dir)?;
    let path = dir.join("bashrc");
    let mut body = String::from(BASH_INTEGRATION);
    body.push('\n');
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for name in [".bash_profile", ".profile", ".bashrc"] {
            let rc = home.join(name);
            if rc.is_file() {
                body.push_str(&format!(
                    "[ -f '{}' ] && . '{}'\n",
                    rc.display(),
                    rc.display()
                ));
            }
        }
    }
    fs::write(&path, body)?;
    Ok(path)
}

fn write_zsh_zdotdir() -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join("tethra-shell-integration/zdot");
    fs::create_dir_all(&dir)?;
    let si = dir.join(".tethra_si");
    fs::write(&si, ZSH_INTEGRATION)?;

    // Capture the user's real config dir BEFORE we override ZDOTDIR.
    let user_zdot = std::env::var_os("ZDOTDIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from));

    let mut zprofile = String::new();
    if let Some(ref home) = user_zdot {
        for name in [".zprofile", ".zlogin"] {
            let file = home.join(name);
            if file.is_file() {
                zprofile.push_str(&format!(
                    "[ -f '{}' ] && source '{}'\n",
                    file.display(),
                    file.display()
                ));
            }
        }
    }
    fs::write(dir.join(".zprofile"), zprofile)?;

    let mut zshrc = format!("source '{}'\n", si.display());
    if let Some(home) = user_zdot {
        let user_rc = home.join(".zshrc");
        if user_rc.is_file() {
            zshrc.push_str(&format!(
                "[ -f '{}' ] && source '{}'\n",
                user_rc.display(),
                user_rc.display()
            ));
        }
    }
    fs::write(dir.join(".zshrc"), zshrc)?;
    Ok(dir)
}
