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

    if name.contains("zsh") {
        let dir = write_zsh_zdotdir()?;
        env.push(("ZDOTDIR".into(), dir.to_string_lossy().into_owned()));
        let mut args = Vec::new();
        if spec.args.iter().any(|a| a == "-l" || a == "--login") {
            args.push("-l".into());
        }
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
        let mut args = vec![
            "--rcfile".into(),
            rcfile.to_string_lossy().into_owned(),
            "-i".into(),
        ];
        if spec.args.iter().any(|a| a == "-l" || a == "--login") {
            args.insert(0, "-l".into());
        }
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

fn write_bash_rcfile() -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join("tethra-shell-integration");
    fs::create_dir_all(&dir)?;
    let path = dir.join("bashrc");
    let mut body = String::from(BASH_INTEGRATION);
    body.push('\n');
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let rc = home.join(".bashrc");
        if rc.is_file() {
            body.push_str(&format!(
                "[ -f '{}' ] && . '{}'\n",
                rc.display(),
                rc.display()
            ));
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
    let user_home = std::env::var_os("ZDOTDIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from));
    let mut zshrc = format!("source '{}'\n", si.display());
    if let Some(home) = user_home {
        let user_rc = home.join(".zshrc");
        zshrc.push_str(&format!(
            "[ -f '{}' ] && source '{}'\n",
            user_rc.display(),
            user_rc.display()
        ));
    }
    fs::write(dir.join(".zshrc"), zshrc)?;
    Ok(dir)
}
