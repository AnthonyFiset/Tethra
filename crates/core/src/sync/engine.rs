//! Orchestrates pull → LWW apply → push for a configured backend.

use std::sync::Arc;

use chrono::Utc;

use crate::sync::SyncBackend;
use crate::sync::conflict::wins_over;
use crate::sync::encode::{item_row_from_sync, sync_item_from_row};
use crate::sync::types::{SyncCursor, SyncedVaultHeader};
use crate::vault::Vault;
use crate::vault::store::{ItemKind, ItemRow, VaultHeader};
use crate::{Error, Result};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncStatus {
    pub configured: bool,
    pub backend_kind: String,
    pub last_cursor: Option<String>,
    pub last_synced_at: Option<String>,
    pub last_error: Option<String>,
    pub last_pulled: u32,
    pub last_pushed: u32,
    pub last_applied: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncReport {
    pub pulled: u32,
    pub applied: u32,
    pub pushed: u32,
    pub cursor: String,
}

pub(crate) const MISMATCH_MESSAGE: &str = "this device's vault was created separately from the synced vault; \
reset this device's vault and join the sync server before unlocking";

/// Two headers describe the same vault when the wrapped key and its KDF inputs
/// match; anything else derives a different vault key.
fn same_vault(a: &SyncedVaultHeader, b: &SyncedVaultHeader) -> bool {
    a.salt == b.salt && a.argon2 == b.argon2 && a.wrapped_vault_key == b.wrapped_vault_key
}

/// Coordinates vault rows with a [`SyncBackend`].
pub struct SyncEngine {
    vault: Arc<Vault>,
    backend: Arc<dyn SyncBackend>,
    cursor: tokio::sync::Mutex<SyncCursor>,
    status: tokio::sync::Mutex<SyncStatus>,
}

impl SyncEngine {
    pub fn new(
        vault: Arc<Vault>,
        backend: Arc<dyn SyncBackend>,
        backend_kind: impl Into<String>,
    ) -> Self {
        let backend_kind = backend_kind.into();
        Self {
            vault,
            backend,
            cursor: tokio::sync::Mutex::new(SyncCursor::default()),
            status: tokio::sync::Mutex::new(SyncStatus {
                configured: true,
                backend_kind,
                ..SyncStatus::default()
            }),
        }
    }

    pub async fn status(&self) -> SyncStatus {
        self.status.lock().await.clone()
    }

    /// Publish the local password-wrapped vault header so another device can
    /// unlock with the same master password.
    ///
    /// Refuses to overwrite a different vault's header: the wrapped key is what
    /// every synced row is encrypted against, so clobbering it would strand the
    /// other devices' items.
    pub async fn publish_header(&self) -> Result<()> {
        let local = self.vault.export_sync_header().await?;
        match self.backend.get_header().await? {
            Some(remote) if !same_vault(&remote, &local) => {
                Err(Error::Sync(MISMATCH_MESSAGE.into()))
            }
            Some(_) => Ok(()),
            None => self.backend.put_header(&local).await,
        }
    }

    /// True when the backend holds a header for a different vault than this
    /// device's, which means the master password cannot decrypt synced rows.
    pub async fn header_matches_backend(&self) -> Result<bool> {
        let Some(remote) = self.backend.get_header().await? else {
            return Ok(true);
        };
        let local = self.vault.export_sync_header().await?;
        Ok(same_vault(&remote, &local))
    }

    /// If the local vault does not exist but the backend has a header, import
    /// it so unlock can proceed with the shared master password.
    pub async fn bootstrap_from_backend_if_needed(&self) -> Result<bool> {
        let exists = self.vault.status().await?.exists;
        if exists {
            return Ok(false);
        }
        let Some(header) = self.backend.get_header().await? else {
            return Ok(false);
        };
        self.vault.import_sync_header(&header).await?;
        Ok(true)
    }

    /// Pull remote changes, apply LWW, push local non-`local_only` rows.
    pub async fn sync_now(&self) -> Result<SyncReport> {
        if !self.vault.is_unlocked().await? {
            return Err(Error::VaultLocked);
        }

        let result = self.sync_now_inner().await;
        match &result {
            Ok(report) => {
                let mut status = self.status.lock().await;
                status.last_cursor = Some(report.cursor.clone());
                status.last_synced_at = Some(Utc::now().to_rfc3339());
                status.last_error = None;
                status.last_pulled = report.pulled;
                status.last_pushed = report.pushed;
                status.last_applied = report.applied;
            }
            Err(err) => {
                let mut status = self.status.lock().await;
                status.last_error = Some(err.to_string());
            }
        }
        result
    }

    async fn sync_now_inner(&self) -> Result<SyncReport> {
        // Seeds the shared header on a fresh backend, and refuses to run at all
        // when this device's vault key differs from the one already published.
        self.publish_header().await?;

        let since = self.cursor.lock().await.clone();
        let (remote_items, remote_cursor) = self.backend.pull(&since).await?;
        let pulled = remote_items.len() as u32;

        let mut applied = 0u32;
        for item in &remote_items {
            let local = self.vault.with_db(|db| db.get_item(item.id)).await?;
            let should_apply = match local {
                Some(ref row) if row.local_only => false,
                Some(ref row) => wins_over(item, row),
                None => true,
            };
            if !should_apply {
                continue;
            }
            let row = item_row_from_sync(item)?;
            self.vault.with_db_mut(|db| db.upsert_item(&row)).await?;
            applied += 1;
        }

        let local_rows = self.vault.list_sync_eligible_items().await?;
        let outgoing: Vec<_> = local_rows.iter().map(sync_item_from_row).collect();
        let pushed = outgoing.len() as u32;
        let push_cursor = self.backend.push(&outgoing).await?;

        // Advance to the max of pull/push cursors.
        let next = if push_cursor.parse_revision() > remote_cursor.parse_revision() {
            push_cursor
        } else {
            remote_cursor
        };
        *self.cursor.lock().await = next.clone();

        Ok(SyncReport {
            pulled,
            applied,
            pushed,
            cursor: next.0,
        })
    }
}

impl Vault {
    /// Export the password-wrapped header for sync (no recovery wrap).
    pub async fn export_sync_header(&self) -> Result<SyncedVaultHeader> {
        let header = self.with_db(|db| db.read_header()).await?;
        Ok(SyncedVaultHeader {
            salt: header.salt,
            argon2: header.argon2,
            wrapped_vault_key: header.wrapped_vault_key,
            created_at: header.created_at,
        })
    }

    /// Import a synced header into an empty local vault database.
    pub async fn import_sync_header(&self, header: &SyncedVaultHeader) -> Result<()> {
        let exists = self.with_db(|db| db.has_header()).await?;
        if exists {
            return Err(Error::VaultAlreadyExists);
        }
        let local = VaultHeader {
            salt: header.salt.clone(),
            argon2: header.argon2,
            wrapped_vault_key: header.wrapped_vault_key.clone(),
            recovery_wrapped_vault_key: None,
            created_at: header.created_at,
        };
        self.with_db_mut(|db| db.write_header(&local)).await
    }

    /// All non-`local_only` rows, including tombstones.
    pub async fn list_sync_eligible_items(&self) -> Result<Vec<ItemRow>> {
        self.require_key().await?;
        self.with_db(|db| {
            let mut rows = Vec::new();
            for kind in [ItemKind::Host, ItemKind::Identity] {
                for row in db.list_items(kind, true)? {
                    if !row.local_only {
                        rows.push(row);
                    }
                }
            }
            Ok(rows)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use platform_desktop::{FixedAppPaths, MemorySecretStore};
    use tempfile::tempdir;

    use super::*;
    use crate::model::SecretString;
    use crate::sync::FileBackend;
    use crate::vault::{CreateHostRequest, VaultRepository};

    async fn vault_at(path: &std::path::Path) -> Arc<Vault> {
        let paths = Arc::new(FixedAppPaths {
            data: path.join("data"),
            cache: path.join("cache"),
        });
        let secrets = Arc::new(MemorySecretStore::default());
        Arc::new(Vault::open_with_idle(paths, secrets, Duration::from_secs(3600)).unwrap())
    }

    #[tokio::test]
    async fn two_devices_share_hosts_not_passwords() {
        let root = tempdir().unwrap();
        let sync_dir = root.path().join("sync");
        std::fs::create_dir_all(&sync_dir).unwrap();

        let device_a = vault_at(&root.path().join("a")).await;
        device_a
            .create(&SecretString::new("shared-password"), false)
            .await
            .unwrap();
        let repo_a = VaultRepository::new(Arc::clone(&device_a));
        let created = repo_a
            .create_host(CreateHostRequest {
                label: "lab".into(),
                hostname: "10.0.0.1".into(),
                port: 22,
                username: "anthony".into(),
                password: Some(SecretString::new("s3cret")),
                color: Some("#4C8DF6".into()),
            })
            .await
            .unwrap();

        let backend_a = Arc::new(FileBackend::new(&sync_dir));
        let engine_a = SyncEngine::new(Arc::clone(&device_a), backend_a, "file");
        let report = engine_a.sync_now().await.unwrap();
        assert_eq!(report.pushed, 1); // host only; identity is local_only

        let device_b = vault_at(&root.path().join("b")).await;
        let backend_b = Arc::new(FileBackend::new(&sync_dir));
        let engine_b = SyncEngine::new(Arc::clone(&device_b), backend_b, "file");
        assert!(engine_b.bootstrap_from_backend_if_needed().await.unwrap());
        device_b
            .unlock(&SecretString::new("shared-password"))
            .await
            .unwrap();
        let report_b = engine_b.sync_now().await.unwrap();
        assert!(report_b.applied >= 1);

        let repo_b = VaultRepository::new(device_b);
        let hosts = repo_b.list_hosts().await.unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].id, created.id);
        assert_eq!(hosts[0].label, "lab");
        assert!(!hosts[0].has_password); // identity stayed on device A
    }

    #[tokio::test]
    async fn separately_created_vault_refuses_to_clobber_header() {
        let root = tempdir().unwrap();
        let sync_dir = root.path().join("sync");
        std::fs::create_dir_all(&sync_dir).unwrap();

        let device_a = vault_at(&root.path().join("a")).await;
        device_a
            .create(&SecretString::new("shared-password"), false)
            .await
            .unwrap();
        let engine_a = SyncEngine::new(
            Arc::clone(&device_a),
            Arc::new(FileBackend::new(&sync_dir)),
            "file",
        );
        engine_a.sync_now().await.unwrap();
        let published = device_a.export_sync_header().await.unwrap();

        // Device B created its own vault instead of joining, so its vault key
        // differs even though the master password is identical.
        let device_b = vault_at(&root.path().join("b")).await;
        device_b
            .create(&SecretString::new("shared-password"), false)
            .await
            .unwrap();
        let engine_b = SyncEngine::new(
            Arc::clone(&device_b),
            Arc::new(FileBackend::new(&sync_dir)),
            "file",
        );

        assert!(!engine_b.header_matches_backend().await.unwrap());
        let err = engine_b.sync_now().await.unwrap_err();
        assert!(
            matches!(&err, Error::Sync(msg) if msg.contains("created separately")),
            "unexpected error: {err:?}"
        );

        // Device A's header must survive device B's attempt.
        let backend = FileBackend::new(&sync_dir);
        assert_eq!(backend.get_header().await.unwrap(), Some(published));
    }
}
