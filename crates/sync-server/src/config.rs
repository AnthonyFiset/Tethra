//! Persistent sync-server configuration.

use std::fs;
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const CONFIG_DIR_NAME: &str = "tethra-sync";
const CONFIG_FILE_NAME: &str = "config.toml";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Config {
    pub data_dir: PathBuf,
    /// Bind address, e.g. `0.0.0.0:8787`.
    pub listen: String,
    pub token: String,
    /// Hint shown to clients / TUI, e.g. `http://thinkpad:8787`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_url: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir(),
            listen: "0.0.0.0:8787".into(),
            token: String::new(),
            client_url: None,
        }
    }
}

impl Config {
    pub fn listen_addr(&self) -> Result<SocketAddr, String> {
        self.listen
            .parse()
            .map_err(|e| format!("invalid listen address {:?}: {e}", self.listen))
    }

    pub fn port(&self) -> Result<u16, String> {
        Ok(self.listen_addr()?.port())
    }
}

pub fn config_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME")
        && !xdg.is_empty()
    {
        return PathBuf::from(xdg).join(CONFIG_DIR_NAME);
    }
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join(CONFIG_DIR_NAME)
}

pub fn config_path() -> PathBuf {
    config_dir().join(CONFIG_FILE_NAME)
}

pub fn default_data_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tethra-sync")
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

pub fn load(path: &Path) -> Result<Config, String> {
    let bytes = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let text = String::from_utf8(bytes).map_err(|e| format!("utf8 {}: {e}", path.display()))?;
    toml::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

pub fn load_if_present() -> Result<Option<Config>, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(load(&path)?))
}

pub fn save(path: &Path, config: &Config) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let body = toml::to_string_pretty(config).map_err(|e| format!("serialize config: {e}"))?;
    write_private(path, body.as_bytes()).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(())
}

pub fn save_default(config: &Config) -> Result<(), String> {
    save(&config_path(), config)
}

fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        file.set_permissions(perms)?;
    }
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

/// Merge CLI / env overrides onto a base config (flags win when `Some`).
pub fn apply_overrides(
    mut base: Config,
    data_dir: Option<PathBuf>,
    listen: Option<String>,
    token: Option<String>,
    client_url: Option<String>,
) -> Config {
    if let Some(dir) = data_dir {
        base.data_dir = dir;
    }
    if let Some(addr) = listen {
        base.listen = addr;
    }
    if let Some(tok) = token.filter(|t| !t.is_empty()) {
        base.token = tok;
    }
    if let Some(url) = client_url.filter(|u| !u.is_empty()) {
        base.client_url = Some(url);
    }
    base
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn roundtrip_toml() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let config = Config {
            data_dir: PathBuf::from("/tmp/tethra-sync"),
            listen: "0.0.0.0:8787".into(),
            token: "secret".into(),
            client_url: Some("http://thinkpad:8787".into()),
        };
        save(&path, &config).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, config);
    }

    #[test]
    fn overrides_win() {
        let base = Config::default();
        let merged = apply_overrides(
            base,
            Some(PathBuf::from("/data")),
            Some("127.0.0.1:9".into()),
            Some("tok".into()),
            Some("http://x:9".into()),
        );
        assert_eq!(merged.data_dir, PathBuf::from("/data"));
        assert_eq!(merged.listen, "127.0.0.1:9");
        assert_eq!(merged.token, "tok");
        assert_eq!(merged.client_url.as_deref(), Some("http://x:9"));
    }
}
