//! Encrypted vault: create / unlock / lock / recover / change password.
//!
//! Key material never leaves this module except through deliberate decrypt APIs
//! while the vault is unlocked.

mod crypto;
mod kdf;
mod records;
mod repository;
mod store;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use platform::{AppPaths, SecretStore};
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::Zeroize;

use crypto::{EncryptedBlob, VaultKey};
use kdf::Argon2Params;
use store::{ItemKind, ItemRow, RECOVERY_SECRET_KEY, VaultDb, VaultHeader};

use crate::model::SecretString;
use crate::{Error, Result};

pub use records::{HostRecord, PasswordIdentityRecord};
pub use repository::{CreateHostRequest, HostSummary, VaultRepository};
pub use store::RECOVERY_SECRET_KEY as VAULT_RECOVERY_SECRET_KEY;

/// Default idle auto-lock duration.
pub const DEFAULT_IDLE_LOCK: Duration = Duration::from_secs(15 * 60);

/// Snapshot of vault availability without exposing secrets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultStatus {
    pub exists: bool,
    pub unlocked: bool,
    pub recovery_available: bool,
}

enum LockState {
    Locked,
    Unlocked {
        vault_key: VaultKey,
        last_activity: Instant,
    },
}

/// Portable encrypted vault backed by SQLite under [`AppPaths::data_dir`].
pub struct Vault {
    paths: Arc<dyn AppPaths>,
    secrets: Arc<dyn SecretStore>,
    db: Mutex<VaultDb>,
    state: Mutex<LockState>,
    idle_timeout: Duration,
}

impl Vault {
    pub fn open(paths: Arc<dyn AppPaths>, secrets: Arc<dyn SecretStore>) -> Result<Self> {
        Self::open_with_idle(paths, secrets, DEFAULT_IDLE_LOCK)
    }

    pub fn open_with_idle(
        paths: Arc<dyn AppPaths>,
        secrets: Arc<dyn SecretStore>,
        idle_timeout: Duration,
    ) -> Result<Self> {
        let db_path = vault_db_path(paths.as_ref());
        let db = VaultDb::open(db_path)?;
        Ok(Self {
            paths,
            secrets,
            db: Mutex::new(db),
            state: Mutex::new(LockState::Locked),
            idle_timeout,
        })
    }

    pub fn db_path(&self) -> PathBuf {
        vault_db_path(self.paths.as_ref())
    }

    pub async fn status(&self) -> Result<VaultStatus> {
        self.touch_idle().await?;
        let db = self.db.lock().await;
        let exists = db.has_header()?;
        let recovery_available = if exists {
            db.read_header()?.recovery_wrapped_vault_key.is_some()
        } else {
            false
        };
        let unlocked = matches!(*self.state.lock().await, LockState::Unlocked { .. });
        Ok(VaultStatus {
            exists,
            unlocked,
            recovery_available,
        })
    }

    /// Create a new vault. Optionally stores a recovery key in the secret store.
    pub async fn create(
        &self,
        password: &SecretString,
        enable_recovery: bool,
    ) -> Result<VaultStatus> {
        {
            let db = self.db.lock().await;
            if db.has_header()? {
                return Err(Error::VaultAlreadyExists);
            }
        }

        let salt = kdf::random_salt()?;
        let params = Argon2Params::default();
        let derived = kdf::derive_keys(password.expose().as_bytes(), &salt, &params)?;
        let vault_key = VaultKey::random()?;
        let wrapped = crypto::wrap_key(&derived.enc_key, &vault_key)?;

        let recovery_wrapped = if enable_recovery {
            match self.install_recovery_key(&vault_key).await {
                Ok(blob) => Some(blob),
                Err(Error::Platform(_)) | Err(Error::Unsupported(_)) => None,
                Err(other) => return Err(other),
            }
        } else {
            None
        };

        let header = VaultHeader {
            salt: salt.to_vec(),
            argon2: params,
            wrapped_vault_key: wrapped,
            recovery_wrapped_vault_key: recovery_wrapped,
            created_at: Utc::now(),
        };

        {
            let mut db = self.db.lock().await;
            db.write_header(&header)?;
        }

        *self.state.lock().await = LockState::Unlocked {
            vault_key,
            last_activity: Instant::now(),
        };

        drop(derived);
        self.status().await
    }

    pub async fn unlock(&self, password: &SecretString) -> Result<VaultStatus> {
        let header = {
            let db = self.db.lock().await;
            if !db.has_header()? {
                return Err(Error::VaultNotFound);
            }
            db.read_header()?
        };

        let derived = kdf::derive_keys(password.expose().as_bytes(), &header.salt, &header.argon2)?;
        let vault_key = crypto::unwrap_key(&derived.enc_key, &header.wrapped_vault_key)?;
        drop(derived);

        *self.state.lock().await = LockState::Unlocked {
            vault_key,
            last_activity: Instant::now(),
        };
        self.status().await
    }

    /// Recover using the keyring-held recovery key and set a new master password.
    pub async fn recover_with_new_password(
        &self,
        new_password: &SecretString,
    ) -> Result<VaultStatus> {
        let mut header = {
            let db = self.db.lock().await;
            if !db.has_header()? {
                return Err(Error::VaultNotFound);
            }
            db.read_header()?
        };

        let recovery_blob = header
            .recovery_wrapped_vault_key
            .clone()
            .ok_or(Error::RecoveryUnavailable)?;

        let recovery_key = self
            .secrets
            .get(RECOVERY_SECRET_KEY)
            .await?
            .ok_or(Error::RecoveryUnavailable)?;
        if recovery_key.len() != kdf::KEY_LEN {
            return Err(Error::RecoveryUnavailable);
        }
        let mut recovery_arr = [0u8; kdf::KEY_LEN];
        recovery_arr.copy_from_slice(&recovery_key);

        let vault_key = crypto::unwrap_key(&recovery_arr, &recovery_blob)
            .map_err(|_| Error::RecoveryUnavailable)?;
        recovery_arr.zeroize();

        let salt = kdf::random_salt()?;
        let params = Argon2Params::default();
        let derived = kdf::derive_keys(new_password.expose().as_bytes(), &salt, &params)?;
        let wrapped = crypto::wrap_key(&derived.enc_key, &vault_key)?;
        drop(derived);

        header.salt = salt.to_vec();
        header.argon2 = params;
        header.wrapped_vault_key = wrapped;

        {
            let mut db = self.db.lock().await;
            db.write_header(&header)?;
        }

        *self.state.lock().await = LockState::Unlocked {
            vault_key,
            last_activity: Instant::now(),
        };
        self.status().await
    }

    pub async fn change_password(
        &self,
        current: &SecretString,
        new_password: &SecretString,
    ) -> Result<()> {
        let header = {
            let db = self.db.lock().await;
            db.read_header()?
        };
        let derived = kdf::derive_keys(current.expose().as_bytes(), &header.salt, &header.argon2)?;
        let vault_key = crypto::unwrap_key(&derived.enc_key, &header.wrapped_vault_key)?;
        drop(derived);

        let salt = kdf::random_salt()?;
        let params = Argon2Params::default();
        let new_derived = kdf::derive_keys(new_password.expose().as_bytes(), &salt, &params)?;
        let wrapped = crypto::wrap_key(&new_derived.enc_key, &vault_key)?;
        drop(new_derived);

        let mut header = header;
        header.salt = salt.to_vec();
        header.argon2 = params;
        header.wrapped_vault_key = wrapped;

        {
            let mut db = self.db.lock().await;
            db.write_header(&header)?;
        }

        *self.state.lock().await = LockState::Unlocked {
            vault_key,
            last_activity: Instant::now(),
        };
        Ok(())
    }

    pub async fn lock(&self) -> Result<()> {
        *self.state.lock().await = LockState::Locked;
        Ok(())
    }

    pub async fn is_unlocked(&self) -> Result<bool> {
        self.touch_idle().await?;
        Ok(matches!(
            *self.state.lock().await,
            LockState::Unlocked { .. }
        ))
    }

    pub(crate) async fn require_key(&self) -> Result<VaultKey> {
        self.touch_idle().await?;
        let mut state = self.state.lock().await;
        match &mut *state {
            LockState::Locked => Err(Error::VaultLocked),
            LockState::Unlocked {
                vault_key,
                last_activity,
            } => {
                *last_activity = Instant::now();
                Ok(vault_key.clone())
            }
        }
    }

    pub(crate) async fn with_db_mut<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut VaultDb) -> Result<T>,
    {
        let mut db = self.db.lock().await;
        f(&mut db)
    }

    pub(crate) async fn with_db<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&VaultDb) -> Result<T>,
    {
        let db = self.db.lock().await;
        f(&db)
    }

    async fn install_recovery_key(&self, vault_key: &VaultKey) -> Result<EncryptedBlob> {
        let recovery = kdf::random_key()?;
        self.secrets
            .set(RECOVERY_SECRET_KEY, &recovery)
            .await
            .map_err(|e| match e {
                platform::PlatformError::Unsupported => {
                    Error::Unsupported("keyring unavailable".into())
                }
                other => Error::from(other),
            })?;
        crypto::wrap_key(&recovery, vault_key)
    }

    async fn touch_idle(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        let expired = match &*state {
            LockState::Unlocked { last_activity, .. } => {
                last_activity.elapsed() >= self.idle_timeout
            }
            LockState::Locked => false,
        };
        if expired {
            *state = LockState::Locked;
        }
        Ok(())
    }
}

fn vault_db_path(paths: &dyn AppPaths) -> PathBuf {
    paths.data_dir().join("vault.sqlite3")
}

/// Encrypt and persist a JSON payload as a vault item.
pub(crate) async fn put_encrypted_json<T: serde::Serialize>(
    vault: &Vault,
    id: Uuid,
    kind: ItemKind,
    version: u64,
    local_only: bool,
    deleted: bool,
    value: &T,
) -> Result<()> {
    let key = vault.require_key().await?;
    let plaintext = serde_json::to_vec(value)?;
    let blob = crypto::encrypt_item(&key, id, version, &plaintext)?;
    let row = ItemRow {
        id,
        kind,
        version,
        updated_at: Utc::now(),
        deleted,
        local_only,
        blob,
    };
    vault.with_db_mut(|db| db.upsert_item(&row)).await
}

/// Decrypt a vault item into JSON.
pub(crate) async fn get_encrypted_json<T: serde::de::DeserializeOwned>(
    vault: &Vault,
    id: Uuid,
) -> Result<(T, ItemRow)> {
    let key = vault.require_key().await?;
    let row = vault
        .with_db(|db| db.get_item(id))
        .await?
        .ok_or_else(|| Error::Other(format!("item not found: {id}")))?;
    if row.deleted {
        return Err(Error::Other(format!("item deleted: {id}")));
    }
    let plaintext = crypto::decrypt_item(&key, row.id, row.version, &row.blob)?;
    let value = serde_json::from_slice(&plaintext)?;
    Ok((value, row))
}

#[cfg(test)]
mod tests {
    use super::*;
    use platform_desktop::{FixedAppPaths, MemorySecretStore};
    use tempfile::tempdir;

    fn test_vault() -> (tempfile::TempDir, Vault) {
        let dir = tempdir().unwrap();
        let paths = Arc::new(FixedAppPaths {
            data: dir.path().join("data"),
            cache: dir.path().join("cache"),
        });
        let secrets = Arc::new(MemorySecretStore::default());
        // Fast idle for most tests.
        let vault = Vault::open_with_idle(paths, secrets, Duration::from_secs(3600)).unwrap();
        (dir, vault)
    }

    #[tokio::test]
    async fn create_unlock_lock_roundtrip() {
        let (_dir, vault) = test_vault();
        let password = SecretString::new("correct horse battery");
        let status = vault.create(&password, true).await.unwrap();
        assert!(status.exists);
        assert!(status.unlocked);
        assert!(status.recovery_available);

        vault.lock().await.unwrap();
        assert!(!vault.is_unlocked().await.unwrap());

        vault
            .unlock(&SecretString::new("wrong"))
            .await
            .expect_err("wrong password");
        vault.unlock(&password).await.unwrap();
        assert!(vault.is_unlocked().await.unwrap());
    }

    #[tokio::test]
    async fn recovery_rewrites_password_wrap() {
        let (_dir, vault) = test_vault();
        vault
            .create(&SecretString::new("old-password"), true)
            .await
            .unwrap();
        vault.lock().await.unwrap();

        vault
            .recover_with_new_password(&SecretString::new("brand-new"))
            .await
            .unwrap();
        vault.lock().await.unwrap();
        vault.unlock(&SecretString::new("brand-new")).await.unwrap();
        vault
            .unlock(&SecretString::new("old-password"))
            .await
            .expect_err("old password must fail after recovery");
    }

    #[tokio::test]
    async fn change_password_keeps_same_vault_key() {
        let (dir, vault) = test_vault();
        vault
            .create(&SecretString::new("first-password"), true)
            .await
            .unwrap();
        let item_id = Uuid::now_v7();
        put_encrypted_json(
            &vault,
            item_id,
            ItemKind::Host,
            1,
            false,
            false,
            &HostRecord {
                id: item_id,
                label: "lab".into(),
                hostname: "127.0.0.1".into(),
                port: 22,
                username: "u".into(),
                identity_id: None,
                jump_host_id: None,
                folder_id: None,
                known_host_key: None,
                tags: vec![],
                color: None,
            },
        )
        .await
        .unwrap();

        vault
            .change_password(
                &SecretString::new("first-password"),
                &SecretString::new("second-password"),
            )
            .await
            .unwrap();
        vault.lock().await.unwrap();
        vault
            .unlock(&SecretString::new("second-password"))
            .await
            .unwrap();
        let (record, _) = get_encrypted_json::<HostRecord>(&vault, item_id)
            .await
            .unwrap();
        assert_eq!(record.label, "lab");

        // Re-open the same SQLite file with a fresh Vault handle.
        drop(vault);
        let paths = Arc::new(FixedAppPaths {
            data: dir.path().join("data"),
            cache: dir.path().join("cache"),
        });
        let secrets = Arc::new(MemorySecretStore::default());
        let reopened = Vault::open_with_idle(paths, secrets, Duration::from_secs(3600)).unwrap();
        reopened
            .unlock(&SecretString::new("second-password"))
            .await
            .unwrap();
        let status = reopened.status().await.unwrap();
        assert!(status.exists);
        assert!(status.unlocked);
    }

    #[tokio::test]
    async fn locked_vault_refuses_item_access() {
        let (_dir, vault) = test_vault();
        vault.create(&SecretString::new("pw"), false).await.unwrap();
        vault.lock().await.unwrap();
        let err = put_encrypted_json(
            &vault,
            Uuid::now_v7(),
            ItemKind::Host,
            1,
            false,
            false,
            &serde_json::json!({"x": 1}),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, Error::VaultLocked));
    }

    #[tokio::test]
    async fn persisted_argon2_params_are_used_on_unlock() {
        let (_dir, vault) = test_vault();
        vault
            .create(&SecretString::new("param-check"), false)
            .await
            .unwrap();
        let header = vault.with_db(|db| db.read_header()).await.unwrap();
        assert_eq!(header.argon2.memory_kib, kdf::DEFAULT_MEMORY_KIB);
        assert_eq!(header.argon2.time_cost, kdf::DEFAULT_TIME_COST);
        assert_eq!(header.argon2.parallelism, kdf::DEFAULT_PARALLELISM);
        assert_eq!(header.salt.len(), kdf::SALT_LEN);
        vault.lock().await.unwrap();
        vault
            .unlock(&SecretString::new("param-check"))
            .await
            .unwrap();
    }
}
