//! iOS platform adapters — stubs until M8.
//!
//! Exists so the mobile port shape is obvious from day one.
//! Core must compile for `aarch64-apple-ios` without this crate.

#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::sync::mpsc;

use async_trait::async_trait;
use bytes::Bytes;
use platform::{
    AppPaths, Biometrics, HardwareKey, LocalPty, LocalPtySession, PlatformError, PowerEvent,
    PowerMonitor, PtySize, PublicKey, Result, SecretStore, ShellSpec,
};
use tokio::sync::mpsc as tokio_mpsc;

pub struct IosSecretStoreStub;

#[async_trait]
impl SecretStore for IosSecretStoreStub {
    async fn get(&self, _key: &str) -> Result<Option<Vec<u8>>> {
        Err(PlatformError::Unsupported)
    }

    async fn set(&self, _key: &str, _value: &[u8]) -> Result<()> {
        Err(PlatformError::Unsupported)
    }

    async fn delete(&self, _key: &str) -> Result<()> {
        Err(PlatformError::Unsupported)
    }
}

pub struct IosAppPathsStub;

impl AppPaths for IosAppPathsStub {
    fn data_dir(&self) -> PathBuf {
        PathBuf::from("/Library/Application Support/tethra")
    }

    fn cache_dir(&self) -> PathBuf {
        PathBuf::from("/Library/Caches/tethra")
    }
}

pub struct IosBiometricsStub;

#[async_trait]
impl Biometrics for IosBiometricsStub {
    fn is_available(&self) -> bool {
        false
    }

    async fn authenticate(&self, _reason: &str) -> Result<()> {
        Err(PlatformError::Unsupported)
    }
}

pub struct IosHardwareKeyStub;

#[async_trait]
impl HardwareKey for IosHardwareKeyStub {
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

pub struct IosPowerMonitorStub;

impl PowerMonitor for IosPowerMonitorStub {
    fn is_available(&self) -> bool {
        false
    }

    fn subscribe(&self) -> Result<mpsc::Receiver<PowerEvent>> {
        Err(PlatformError::Unsupported)
    }
}

pub struct IosLocalPtyStub;

impl LocalPty for IosLocalPtyStub {
    fn is_available(&self) -> bool {
        false
    }

    fn default_shell(&self) -> Option<ShellSpec> {
        None
    }

    fn spawn(
        &self,
        _spec: ShellSpec,
        _size: PtySize,
    ) -> Result<(Box<dyn LocalPtySession>, tokio_mpsc::Receiver<Bytes>)> {
        Err(PlatformError::Unsupported)
    }
}
