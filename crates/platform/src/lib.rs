//! Platform capability traits.
//!
//! Implementations live in `platform-desktop` / `platform-ios`.
//! `core` receives these as `Arc<dyn Trait>` and never touches the OS itself.

#![forbid(unsafe_code)]

use std::path::PathBuf;

use async_trait::async_trait;
use thiserror::Error;

/// Errors originating from platform adapters.
#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("secret store error: {0}")]
    SecretStore(String),
    #[error("path error: {0}")]
    Paths(String),
    #[error("biometrics error: {0}")]
    Biometrics(String),
    #[error("hardware key error: {0}")]
    HardwareKey(String),
    #[error("power monitor error: {0}")]
    Power(String),
    #[error("unsupported on this platform")]
    Unsupported,
}

pub type Result<T> = std::result::Result<T, PlatformError>;

/// Opaque public key material from a hardware-backed key.
/// Secure Enclave produces ECDSA P-256 (`ecdsa-sha2-nistp256`).
#[derive(Debug, Clone)]
pub struct PublicKey {
    pub algorithm: String,
    pub bytes: Vec<u8>,
}

#[async_trait]
pub trait SecretStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    async fn set(&self, key: &str, value: &[u8]) -> Result<()>;
    async fn delete(&self, key: &str) -> Result<()>;
}

pub trait AppPaths: Send + Sync {
    fn data_dir(&self) -> PathBuf;
    fn cache_dir(&self) -> PathBuf;
}

#[async_trait]
pub trait Biometrics: Send + Sync {
    fn is_available(&self) -> bool;
    async fn authenticate(&self, reason: &str) -> Result<()>;
}

/// Hardware-backed signing.
/// Desktop impls may return [`PlatformError::Unsupported`] — core must handle that.
#[async_trait]
pub trait HardwareKey: Send + Sync {
    fn is_available(&self) -> bool;
    async fn generate(&self, key_id: &str) -> Result<PublicKey>;
    async fn sign(&self, key_id: &str, data: &[u8]) -> Result<Vec<u8>>;
}

/// System power / session events used to auto-lock the vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerEvent {
    Suspend,
    Resume,
    ScreenLocked,
    ScreenUnlocked,
}

/// Subscribe to power events. Desktop may return unsupported.
pub trait PowerMonitor: Send + Sync {
    fn is_available(&self) -> bool;
    /// Start monitoring. Events are delivered on the returned channel.
    fn subscribe(&self) -> Result<std::sync::mpsc::Receiver<PowerEvent>>;
}
