//! Orchestrates pull → LWW apply → push for a configured backend.

use std::sync::Arc;

use chrono::Utc;

use crate::sync::SyncBackend;
use crate::sync::conflict::wins_over;
use crate::sync::encode::{item_row_from_sync, sync_item_from_row};
use crate::sync::types::{RekeyFrom, SyncCursor, SyncedVaultHeader};
use crate::vault::Vault;
use crate::vault::crypto::{self, VaultKey};
use crate::vault::store::{ItemKind, ItemRow, VaultHeader};
use crate::{Error, Result};

const REKEY_AAD: &[u8] = b"tethra-rekey-attestation-v1";

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
/// match; anything else derives a different vault key. `rekey_from` is ignored.
fn same_vault(a: &SyncedVaultHeader, b: &SyncedVaultHeader) -> bool {
    a.salt == b.salt && a.argon2 == b.argon2 && a.wrapped_vault_key == b.wrapped_vault_key
}

fn header_matches_previous(header: &SyncedVaultHeader, rekey: &RekeyFrom) -> bool {
    header.salt == rekey.previous_salt
        && header.argon2 == rekey.previous_argon2
        && header.wrapped_vault_key == rekey.previous_wrapped_vault_key
}

fn attestation_plaintext(header: &SyncedVaultHeader) -> Vec<u8> {
    let mut out =
        Vec::with_capacity(header.salt.len() + header.wrapped_vault_key.ciphertext.len() + 16);
    out.extend_from_slice(&header.salt);
    out.extend_from_slice(&header.wrapped_vault_key.nonce);
    out.extend_from_slice(&header.wrapped_vault_key.ciphertext);
    out
}

fn build_rekey_from(
    previous: &SyncedVaultHeader,
    next: &SyncedVaultHeader,
    vault_key: &VaultKey,
) -> Result<RekeyFrom> {
    let attestation =
        crypto::seal_with_vault_key(vault_key, REKEY_AAD, &attestation_plaintext(next))?;
    Ok(RekeyFrom {
        previous_salt: previous.salt.clone(),
        previous_argon2: previous.argon2,
        previous_wrapped_vault_key: previous.wrapped_vault_key.clone(),
        attestation,
    })
}

fn verify_rekey_attestation(
    vault_key: &VaultKey,
    previous: &SyncedVaultHeader,
    next: &SyncedVaultHeader,
) -> Result<bool> {
    let Some(rekey) = &next.rekey_from else {
        return Ok(false);
    };
    if !header_matches_previous(previous, rekey) {
        return Ok(false);
    }
    let opened = crypto::open_with_vault_key(vault_key, REKEY_AAD, &rekey.attestation)?;
    Ok(opened == attestation_plaintext(next))
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
    /// Refuses to overwrite a different vault's header unless this device is
    /// publishing a coordinated re-key of the remote header.
    pub async fn publish_header(&self) -> Result<()> {
        let local = self.vault.export_sync_header().await?;
        match self.backend.get_header().await? {
            Some(remote) if same_vault(&remote, &local) => Ok(()),
            Some(remote) => {
                if let Some(rekey) = &local.rekey_from
                    && header_matches_previous(&remote, rekey)
                {
                    // Intentional re-key: overwrite remote with attested header.
                    return self.backend.put_header(&local).await;
                }
                Err(Error::Sync(MISMATCH_MESSAGE.into()))
            }
            None => self.backend.put_header(&local).await,
        }
    }

    /// After a master-password change, publish the new wrap with a re-key
    /// attestation so peers can adopt it on next sync.
    pub async fn publish_password_rekey(&self, previous: &SyncedVaultHeader) -> Result<()> {
        let vault_key = self.vault.require_key().await?;
        let mut next = self.vault.export_sync_header().await?;
        next.rekey_from = Some(build_rekey_from(previous, &next, &vault_key)?);
        self.backend.put_header(&next).await
    }

    /// True when the backend holds a header for a different vault than this
    /// device's, which means the master password cannot decrypt synced rows.
    pub async fn header_matches_backend(&self) -> Result<bool> {
        let Some(remote) = self.backend.get_header().await? else {
            return Ok(true);
        };
        let local = self.vault.export_sync_header().await?;
        if same_vault(&remote, &local) {
            return Ok(true);
        }
        // A pending re-key of our header is not a "separately created" vault.
        if self.vault.is_unlocked().await?
            && let Ok(key) = self.vault.require_key().await
            && verify_rekey_attestation(&key, &local, &remote)?
        {
            return Ok(true);
        }
        Ok(false)
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
        // Adopt a peer's coordinated re-key before publishing our own header.
        self.adopt_remote_rekey_if_needed().await?;

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

    async fn adopt_remote_rekey_if_needed(&self) -> Result<()> {
        let Some(remote) = self.backend.get_header().await? else {
            return Ok(());
        };
        let local = self.vault.export_sync_header().await?;
        if same_vault(&remote, &local) {
            return Ok(());
        }
        let vault_key = self.vault.require_key().await?;
        if !verify_rekey_attestation(&vault_key, &local, &remote)? {
            return Ok(());
        }
        self.vault.adopt_sync_header(&remote).await
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
            rekey_from: None,
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

    /// Replace the local password wrap after verifying a coordinated re-key.
    /// Keeps any recovery wrap intact (still wraps the same vault key).
    pub async fn adopt_sync_header(&self, header: &SyncedVaultHeader) -> Result<()> {
        let mut local = self.with_db(|db| db.read_header()).await?;
        local.salt = header.salt.clone();
        local.argon2 = header.argon2;
        local.wrapped_vault_key = header.wrapped_vault_key.clone();
        local.created_at = header.created_at;
        self.with_db_mut(|db| db.write_header(&local)).await
    }

    /// All non-`local_only` rows, including tombstones.
    pub async fn list_sync_eligible_items(&self) -> Result<Vec<ItemRow>> {
        self.require_key().await?;
        self.with_db(|db| {
            let mut rows = Vec::new();
            for kind in [
                ItemKind::Host,
                ItemKind::Identity,
                ItemKind::Project,
                ItemKind::RunningSession,
                ItemKind::ApiKey,
            ] {
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
    use crate::model::{AuthMaterial, SecretString};
    use crate::ssh::AuthProvider;
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
    async fn two_devices_share_hosts_not_passwords_by_default() {
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
                sync_secret: false,
                color: Some("#4C8DF6".into()),
                shell_integration: Default::default(),
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
        assert!(!hosts[0].sync_secret);

        let host = repo_b.get_host(created.id).await.unwrap();
        let err = repo_b.credentials_for(&host).await.unwrap_err();
        assert!(matches!(err, Error::IdentityNotFound(_)));
        let msg = err.to_string();
        assert!(
            msg.contains("password not available on this device"),
            "unexpected message: {msg}"
        );

        // Peer can attach a local password (optionally with sync_secret).
        let updated = repo_b
            .update_host(
                created.id,
                CreateHostRequest {
                    label: "lab".into(),
                    hostname: "10.0.0.1".into(),
                    port: 22,
                    username: "anthony".into(),
                    password: Some(SecretString::new("s3cret-on-b")),
                    sync_secret: true,
                    color: Some("#4C8DF6".into()),
                    shell_integration: Default::default(),
                },
            )
            .await
            .unwrap();
        assert!(updated.has_password);
        assert!(updated.sync_secret);
        let host = repo_b.get_host(created.id).await.unwrap();
        match repo_b.credentials_for(&host).await.unwrap() {
            AuthMaterial::Password { ref password } => {
                assert_eq!(password.expose(), "s3cret-on-b");
            }
            _ => panic!("expected password"),
        }
    }

    #[tokio::test]
    async fn sync_secret_password_reaches_second_device() {
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
                sync_secret: true,
                color: None,
                shell_integration: Default::default(),
            })
            .await
            .unwrap();
        assert!(created.sync_secret);

        let engine_a = SyncEngine::new(
            Arc::clone(&device_a),
            Arc::new(FileBackend::new(&sync_dir)),
            "file",
        );
        let report = engine_a.sync_now().await.unwrap();
        assert_eq!(report.pushed, 2); // host + identity

        let device_b = vault_at(&root.path().join("b")).await;
        let engine_b = SyncEngine::new(
            Arc::clone(&device_b),
            Arc::new(FileBackend::new(&sync_dir)),
            "file",
        );
        assert!(engine_b.bootstrap_from_backend_if_needed().await.unwrap());
        device_b
            .unlock(&SecretString::new("shared-password"))
            .await
            .unwrap();
        engine_b.sync_now().await.unwrap();

        let repo_b = VaultRepository::new(device_b);
        let hosts = repo_b.list_hosts().await.unwrap();
        assert_eq!(hosts.len(), 1);
        assert!(hosts[0].has_password);
        assert!(hosts[0].sync_secret);
        let host = repo_b.get_host(created.id).await.unwrap();
        match repo_b.credentials_for(&host).await.unwrap() {
            AuthMaterial::Password { ref password } => {
                assert_eq!(password.expose(), "s3cret");
            }
            _ => panic!("expected password"),
        }
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
        let remote = backend.get_header().await.unwrap().unwrap();
        assert!(same_vault(&remote, &published));
    }

    #[tokio::test]
    async fn coordinated_rekey_lets_peer_adopt_new_password() {
        let root = tempdir().unwrap();
        let sync_dir = root.path().join("sync");
        std::fs::create_dir_all(&sync_dir).unwrap();

        let device_a = vault_at(&root.path().join("a")).await;
        device_a
            .create(&SecretString::new("old-password"), false)
            .await
            .unwrap();
        let engine_a = SyncEngine::new(
            Arc::clone(&device_a),
            Arc::new(FileBackend::new(&sync_dir)),
            "file",
        );
        engine_a.sync_now().await.unwrap();

        let device_b = vault_at(&root.path().join("b")).await;
        let engine_b = SyncEngine::new(
            Arc::clone(&device_b),
            Arc::new(FileBackend::new(&sync_dir)),
            "file",
        );
        assert!(engine_b.bootstrap_from_backend_if_needed().await.unwrap());
        device_b
            .unlock(&SecretString::new("old-password"))
            .await
            .unwrap();
        engine_b.sync_now().await.unwrap();

        let previous = device_a.export_sync_header().await.unwrap();
        device_a
            .change_password(
                &SecretString::new("old-password"),
                &SecretString::new("new-password"),
            )
            .await
            .unwrap();
        engine_a.publish_password_rekey(&previous).await.unwrap();

        // Peer still unlocked under the old wrap adopts the re-key on sync.
        engine_b.sync_now().await.unwrap();
        device_b.lock().await.unwrap();
        device_b
            .unlock(&SecretString::new("new-password"))
            .await
            .unwrap();
        assert!(
            device_b
                .unlock(&SecretString::new("old-password"))
                .await
                .is_err()
        );
    }
}
