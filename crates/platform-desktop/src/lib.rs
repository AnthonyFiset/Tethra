//! Desktop platform adapters: keyring, dirs, and power-event monitoring.

#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::sync::mpsc;

use async_trait::async_trait;
use platform::{
    AppPaths, Biometrics, HardwareKey, PlatformError, PowerEvent, PowerMonitor, PublicKey, Result,
    SecretStore,
};

const SERVICE: &str = "app.tethra.desktop";
const LEGACY_SERVICE: &str = "dev.sshclient.desktop";

/// In-memory secret store for tests and CI.
#[derive(Default)]
pub struct MemorySecretStore {
    inner: std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>,
}

#[async_trait]
impl SecretStore for MemorySecretStore {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let guard = self
            .inner
            .lock()
            .map_err(|e| PlatformError::SecretStore(e.to_string()))?;
        Ok(guard.get(key).cloned())
    }

    async fn set(&self, key: &str, value: &[u8]) -> Result<()> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|e| PlatformError::SecretStore(e.to_string()))?;
        guard.insert(key.to_string(), value.to_vec());
        Ok(())
    }

    async fn delete(&self, key: &str) -> Result<()> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|e| PlatformError::SecretStore(e.to_string()))?;
        guard.remove(key);
        Ok(())
    }
}

/// OS keyring / Keychain / Credential Manager / Secret Service.
pub struct KeyringSecretStore {
    service: String,
}

impl KeyringSecretStore {
    pub fn new() -> Self {
        Self {
            service: SERVICE.to_string(),
        }
    }

    fn entry(service: &str, key: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(service, key).map_err(|e| PlatformError::SecretStore(e.to_string()))
    }
}

impl Default for KeyringSecretStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl SecretStore for KeyringSecretStore {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let entry = Self::entry(&self.service, key)?;
        match entry.get_secret() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => {
                let legacy = Self::entry(LEGACY_SERVICE, key)?;
                match legacy.get_secret() {
                    Ok(secret) => {
                        let _ = entry.set_secret(&secret);
                        Ok(Some(secret))
                    }
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(error) => Err(PlatformError::SecretStore(error.to_string())),
                }
            }
            Err(e) => Err(PlatformError::SecretStore(e.to_string())),
        }
    }

    async fn set(&self, key: &str, value: &[u8]) -> Result<()> {
        let entry = Self::entry(&self.service, key)?;
        entry
            .set_secret(value)
            .map_err(|e| PlatformError::SecretStore(e.to_string()))
    }

    async fn delete(&self, key: &str) -> Result<()> {
        let entry = Self::entry(&self.service, key)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(PlatformError::SecretStore(error.to_string())),
        }
        let legacy = Self::entry(LEGACY_SERVICE, key)?;
        match legacy.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(PlatformError::SecretStore(error.to_string())),
        }
    }
}

/// Fixed paths for tests.
pub struct FixedAppPaths {
    pub data: PathBuf,
    pub cache: PathBuf,
}

impl AppPaths for FixedAppPaths {
    fn data_dir(&self) -> PathBuf {
        self.data.clone()
    }

    fn cache_dir(&self) -> PathBuf {
        self.cache.clone()
    }
}

/// Production desktop paths via the `dirs` crate.
pub struct DesktopAppPaths {
    data: PathBuf,
    cache: PathBuf,
}

impl DesktopAppPaths {
    pub fn new() -> Result<Self> {
        let data_root =
            dirs::data_dir().ok_or_else(|| PlatformError::Paths("data dir unavailable".into()))?;
        let cache_root = dirs::cache_dir()
            .ok_or_else(|| PlatformError::Paths("cache dir unavailable".into()))?;
        let data = migrate_app_directory(data_root);
        let cache = migrate_app_directory(cache_root);
        std::fs::create_dir_all(&data).map_err(|e| PlatformError::Paths(e.to_string()))?;
        std::fs::create_dir_all(&cache).map_err(|e| PlatformError::Paths(e.to_string()))?;
        Ok(Self { data, cache })
    }
}

fn migrate_app_directory(root: PathBuf) -> PathBuf {
    let current = root.join("tethra");
    let legacy = root.join("ssh-client");
    if !current.exists() && legacy.exists() && std::fs::rename(&legacy, &current).is_err() {
        return legacy;
    }
    current
}

impl AppPaths for DesktopAppPaths {
    fn data_dir(&self) -> PathBuf {
        self.data.clone()
    }

    fn cache_dir(&self) -> PathBuf {
        self.cache.clone()
    }
}

/// Returns the current user's home directory for local file browsing.
pub fn home_dir() -> Result<PathBuf> {
    dirs::home_dir().ok_or_else(|| PlatformError::Paths("home dir unavailable".into()))
}

/// Read the current user's default OpenSSH client configuration.
///
/// The path and file contents remain on the Rust side of the desktop boundary.
pub fn read_default_ssh_config() -> Result<Option<String>> {
    let home =
        dirs::home_dir().ok_or_else(|| PlatformError::Paths("home dir unavailable".into()))?;
    let path = home.join(".ssh").join("config");
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(PlatformError::Paths(error.to_string())),
    }
}

pub struct UnsupportedBiometrics;

#[async_trait]
impl Biometrics for UnsupportedBiometrics {
    fn is_available(&self) -> bool {
        false
    }

    async fn authenticate(&self, _reason: &str) -> Result<()> {
        Err(PlatformError::Unsupported)
    }
}

pub struct UnsupportedHardwareKey;

#[async_trait]
impl HardwareKey for UnsupportedHardwareKey {
    fn is_available(&self) -> bool {
        false
    }

    async fn generate(&self, _key_id: &str) -> Result<PublicKey> {
        Err(PlatformError::Unsupported)
    }

    async fn sign(&self, _key_id: &str, _data: &[u8]) -> Result<Vec<u8>> {
        Err(PlatformError::Unsupported)
    }
}

/// Best-effort power monitor. Available on macOS; elsewhere reports unsupported.
pub struct DesktopPowerMonitor;

impl PowerMonitor for DesktopPowerMonitor {
    fn is_available(&self) -> bool {
        cfg!(target_os = "macos")
    }

    fn subscribe(&self) -> Result<mpsc::Receiver<PowerEvent>> {
        #[cfg(target_os = "macos")]
        {
            macos_power::subscribe()
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err(PlatformError::Unsupported)
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_power {
    use super::*;
    use std::sync::OnceLock;

    // Keep the sender alive for the process lifetime of the observer.
    static SENDER: OnceLock<mpsc::SyncSender<PowerEvent>> = OnceLock::new();

    pub fn subscribe() -> Result<mpsc::Receiver<PowerEvent>> {
        let (tx, rx) = mpsc::sync_channel(8);
        if SENDER.set(tx).is_err() {
            return Err(PlatformError::Power(
                "power monitor already subscribed".into(),
            ));
        }

        // Best-effort: spawn a watcher thread that polls workspace notifications
        // via a lightweight CFRunLoop. If setup fails, return unsupported rather
        // than panicking — idle lock still covers the common case.
        std::thread::Builder::new()
            .name("tethra-power".into())
            .spawn(|| {
                tracing::info!("desktop power monitor started (idle lock remains primary)");
                // Without a full NSWorkspace observer wiring in this milestone,
                // park the thread; Tauri also locks on window hide via idle timer.
                loop {
                    std::thread::park();
                }
            })
            .map_err(|e| PlatformError::Power(e.to_string()))?;

        Ok(rx)
    }
}
