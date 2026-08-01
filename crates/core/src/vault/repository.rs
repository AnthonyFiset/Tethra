//! Vault-backed host CRUD, SSH config import, and SSH adapters.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::records::{HostRecord, PasswordIdentityRecord};
use super::store::{ItemKind, ItemRow};
use super::{Vault, get_encrypted_json, put_encrypted_json};
use crate::model::{AuthMaterial, Host, KnownHostKey, SecretString, ShellIntegration};
use crate::ssh::{AuthProvider, HostStore};
use crate::ssh_config::{SshConfigHost, parse_ssh_config, proxy_jump_alias};
use crate::{Error, Result};

/// Non-secret host metadata for UI / IPC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostSummary {
    pub id: Uuid,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub has_password: bool,
    /// Whether the password identity is opted into vault sync.
    pub sync_secret: bool,
    pub color: Option<String>,
    pub shell_integration: ShellIntegration,
}

impl From<&Host> for HostSummary {
    fn from(host: &Host) -> Self {
        Self {
            id: host.id,
            label: host.label.clone(),
            hostname: host.hostname.clone(),
            port: host.port,
            username: host.username.clone(),
            has_password: host.identity_id.is_some(),
            sync_secret: false,
            color: host.color.clone(),
            shell_integration: host.shell_integration,
        }
    }
}

/// Create/update payload. Password is optional and never returned.
#[derive(Debug)]
pub struct CreateHostRequest {
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub password: Option<SecretString>,
    /// Opt-in: sync the password identity ciphertext. Default false.
    pub sync_secret: bool,
    pub color: Option<String>,
    pub shell_integration: ShellIntegration,
}

/// High-level vault operations for hosts and SSH wiring.
pub struct VaultRepository {
    vault: Arc<Vault>,
}

impl VaultRepository {
    pub fn new(vault: Arc<Vault>) -> Self {
        Self { vault }
    }

    pub fn vault(&self) -> &Arc<Vault> {
        &self.vault
    }

    pub async fn list_hosts(&self) -> Result<Vec<HostSummary>> {
        let key = self.vault.require_key().await?;
        let rows = self
            .vault
            .with_db(|db| db.list_items(ItemKind::Host, false))
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let plaintext = super::crypto::decrypt_item(&key, row.id, row.version, &row.blob)?;
            let record: HostRecord = serde_json::from_slice(&plaintext)?;
            let has_password = match record.identity_id {
                Some(identity_id) => self
                    .vault
                    .with_db(|db| db.get_item(identity_id))
                    .await?
                    .is_some_and(|item| !item.deleted && item.kind == ItemKind::Identity),
                None => false,
            };
            let sync_secret = match record.identity_id {
                Some(identity_id) if has_password => {
                    match get_encrypted_json::<PasswordIdentityRecord>(&self.vault, identity_id)
                        .await
                    {
                        Ok((identity, _)) => identity.sync_secret,
                        Err(_) => false,
                    }
                }
                _ => false,
            };
            let host = Host::from(record);
            let mut summary = HostSummary::from(&host);
            summary.has_password = has_password;
            summary.sync_secret = sync_secret;
            out.push(summary);
        }
        Ok(out)
    }

    pub async fn create_host(&self, request: CreateHostRequest) -> Result<HostSummary> {
        let mut host =
            Host::new(request.label, request.hostname, request.username).with_port(request.port);
        host.color = validate_host_color(request.color)?;
        host.shell_integration = request.shell_integration;

        if let Some(password) = request.password {
            let identity_id = Uuid::now_v7();
            let identity = PasswordIdentityRecord {
                id: identity_id,
                label: format!("{} password", host.label),
                password: password.expose().to_string(),
                sync_secret: request.sync_secret,
            };
            put_encrypted_json(
                &self.vault,
                identity_id,
                ItemKind::Identity,
                1,
                !request.sync_secret,
                false,
                &identity,
            )
            .await?;
            host.identity_id = Some(identity_id);
        }

        let record = HostRecord::from(&host);
        put_encrypted_json(
            &self.vault,
            host.id,
            ItemKind::Host,
            1,
            false,
            false,
            &record,
        )
        .await?;
        let mut summary = HostSummary::from(&host);
        summary.sync_secret = request.sync_secret && host.identity_id.is_some();
        Ok(summary)
    }

    /// Import selected aliases from OpenSSH configuration in one SQLite transaction.
    ///
    /// Existing hosts with the same label are updated while preserving their
    /// identity and trusted host key. Referenced jump-host aliases are imported
    /// automatically so `jump_host_id` never points at a missing record.
    pub async fn import_ssh_config(
        &self,
        contents: &str,
        selected_aliases: &[String],
    ) -> Result<Vec<HostSummary>> {
        let preview = parse_ssh_config(contents)?;
        let parsed_by_alias: HashMap<&str, &SshConfigHost> = preview
            .hosts
            .iter()
            .map(|host| (host.alias.as_str(), host))
            .collect();
        let import_order = import_order(&parsed_by_alias, selected_aliases)?;

        let key = self.vault.require_key().await?;
        let existing_rows = self
            .vault
            .with_db(|db| db.list_items(ItemKind::Host, false))
            .await?;
        let mut existing_by_label = HashMap::new();
        for row in existing_rows {
            let plaintext = Zeroizing::new(super::crypto::decrypt_item(
                &key,
                row.id,
                row.version,
                &row.blob,
            )?);
            let record: HostRecord = serde_json::from_slice(&plaintext)?;
            existing_by_label
                .entry(record.label.clone())
                .or_insert((record, row));
        }

        let mut ids: HashMap<String, Uuid> = existing_by_label
            .iter()
            .map(|(label, (record, _))| (label.clone(), record.id))
            .collect();
        for alias in &import_order {
            ids.entry(alias.clone()).or_insert_with(Uuid::now_v7);
        }

        let mut encrypted_rows = Vec::with_capacity(import_order.len());
        let mut summaries = Vec::with_capacity(import_order.len());
        for alias in import_order {
            let imported = parsed_by_alias.get(alias.as_str()).ok_or_else(|| {
                Error::InvalidArgument(format!("unknown SSH host alias: {alias}"))
            })?;
            let host_id = ids
                .get(alias.as_str())
                .copied()
                .ok_or_else(|| Error::Other("SSH import ID mapping is incomplete".into()))?;
            let existing = existing_by_label.get(&alias);
            let mut host = existing
                .map(|(record, _)| Host::from(record.clone()))
                .unwrap_or_else(|| {
                    Host::new(
                        imported.alias.clone(),
                        imported.hostname.clone(),
                        imported.username.clone(),
                    )
                });
            host.id = host_id;
            host.label = imported.alias.clone();
            host.hostname = imported.hostname.clone();
            host.port = imported.port;
            host.username = imported.username.clone();
            host.jump_host_id = imported
                .proxy_jump
                .as_deref()
                .and_then(proxy_jump_alias)
                .and_then(|jump_alias| ids.get(jump_alias).copied());

            let version = existing.map_or(1, |(_, row)| row.version + 1);
            let record = HostRecord::from(&host);
            let plaintext = Zeroizing::new(serde_json::to_vec(&record)?);
            let blob = super::crypto::encrypt_item(&key, host.id, version, &plaintext)?;
            encrypted_rows.push(ItemRow {
                id: host.id,
                kind: ItemKind::Host,
                version,
                updated_at: Utc::now(),
                deleted: false,
                local_only: false,
                blob,
            });
            summaries.push(HostSummary::from(&host));
        }

        self.vault
            .with_db_mut(|db| db.upsert_items_transaction(&encrypted_rows))
            .await?;
        Ok(summaries)
    }

    pub async fn update_host(&self, id: Uuid, request: CreateHostRequest) -> Result<HostSummary> {
        let (mut record, row) = get_encrypted_json::<HostRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::Host {
            return Err(Error::InvalidArgument("item is not a host".into()));
        }

        record.label = request.label;
        record.hostname = request.hostname;
        record.port = request.port;
        record.username = request.username;
        record.color = validate_host_color(request.color)?;
        record.shell_integration = request.shell_integration;

        if let Some(password) = request.password {
            let identity_id = record.identity_id.unwrap_or_else(Uuid::now_v7);
            let identity = PasswordIdentityRecord {
                id: identity_id,
                label: format!("{} password", record.label),
                password: password.expose().to_string(),
                sync_secret: request.sync_secret,
            };
            let version = if record.identity_id.is_some() {
                self.next_version(identity_id).await?
            } else {
                1
            };
            put_encrypted_json(
                &self.vault,
                identity_id,
                ItemKind::Identity,
                version,
                !request.sync_secret,
                false,
                &identity,
            )
            .await?;
            record.identity_id = Some(identity_id);
        } else if let Some(identity_id) = record.identity_id
            && let Ok((mut identity, irow)) =
                get_encrypted_json::<PasswordIdentityRecord>(&self.vault, identity_id).await
            && identity.sync_secret != request.sync_secret
        {
            identity.sync_secret = request.sync_secret;
            put_encrypted_json(
                &self.vault,
                identity_id,
                ItemKind::Identity,
                irow.version + 1,
                !request.sync_secret,
                false,
                &identity,
            )
            .await?;
        }

        let next = row.version + 1;
        put_encrypted_json(&self.vault, id, ItemKind::Host, next, false, false, &record).await?;
        let host = Host::from(record);
        let mut summary = HostSummary::from(&host);
        summary.sync_secret = request.sync_secret && host.identity_id.is_some();
        Ok(summary)
    }

    pub async fn delete_host(&self, id: Uuid) -> Result<()> {
        let (record, row) = get_encrypted_json::<HostRecord>(&self.vault, id).await?;
        if let Some(identity_id) = record.identity_id
            && let Ok((identity, irow)) =
                get_encrypted_json::<PasswordIdentityRecord>(&self.vault, identity_id).await
        {
            put_encrypted_json(
                &self.vault,
                identity_id,
                ItemKind::Identity,
                irow.version + 1,
                !identity.sync_secret,
                true,
                &identity,
            )
            .await?;
        }
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::Host,
            row.version + 1,
            false,
            true,
            &record,
        )
        .await?;
        Ok(())
    }

    pub async fn get_host(&self, id: Uuid) -> Result<Host> {
        let (record, _) = get_encrypted_json::<HostRecord>(&self.vault, id).await?;
        Ok(Host::from(record))
    }

    async fn next_version(&self, id: Uuid) -> Result<u64> {
        Ok(self
            .vault
            .with_db(|db| db.get_item(id))
            .await?
            .map(|row| row.version + 1)
            .unwrap_or(1))
    }
}

fn validate_host_color(color: Option<String>) -> Result<Option<String>> {
    let Some(color) = color else {
        return Ok(None);
    };
    let valid = color.len() == 7
        && color.starts_with('#')
        && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if !valid {
        return Err(Error::InvalidArgument(
            "host color must be a #RRGGBB value".into(),
        ));
    }
    Ok(Some(color.to_ascii_uppercase()))
}

fn import_order(
    parsed_by_alias: &HashMap<&str, &SshConfigHost>,
    selected_aliases: &[String],
) -> Result<Vec<String>> {
    let mut queue: VecDeque<String> = selected_aliases.iter().cloned().collect();
    let mut seen = HashSet::new();
    let mut order = Vec::new();

    while let Some(alias) = queue.pop_front() {
        let host = parsed_by_alias
            .get(alias.as_str())
            .ok_or_else(|| Error::InvalidArgument(format!("unknown SSH host alias: {alias}")))?;
        if !seen.insert(alias.clone()) {
            continue;
        }
        order.push(alias);
        if let Some(jump_alias) = host.proxy_jump.as_deref().and_then(proxy_jump_alias)
            && parsed_by_alias.contains_key(jump_alias)
        {
            queue.push_back(jump_alias.to_owned());
        }
    }
    Ok(order)
}

#[async_trait]
impl HostStore for VaultRepository {
    async fn get(&self, id: Uuid) -> Result<Host> {
        self.get_host(id).await.map_err(|err| match err {
            Error::Other(msg) if msg.contains("not found") || msg.contains("deleted") => {
                Error::HostNotFound(id)
            }
            Error::VaultLocked => Error::VaultLocked,
            other => other,
        })
    }

    async fn set_known_host_key(&self, id: Uuid, key: KnownHostKey) -> Result<()> {
        let (mut record, row) = get_encrypted_json::<HostRecord>(&self.vault, id)
            .await
            .map_err(|err| match err {
                Error::Other(_) => Error::HostNotFound(id),
                other => other,
            })?;
        record.known_host_key = Some(key);
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::Host,
            row.version + 1,
            false,
            false,
            &record,
        )
        .await?;
        Ok(())
    }
}

#[async_trait]
impl AuthProvider for VaultRepository {
    async fn credentials_for(&self, host: &Host) -> Result<AuthMaterial> {
        let identity_id = host
            .identity_id
            .ok_or_else(|| Error::InvalidArgument("host has no identity".into()))?;
        let (identity, _) = get_encrypted_json::<PasswordIdentityRecord>(&self.vault, identity_id)
            .await
            .map_err(|err| match err {
                Error::Other(_) => Error::IdentityNotFound(identity_id),
                other => other,
            })?;
        Ok(AuthMaterial::Password {
            password: SecretString::new(identity.password),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SecretString;
    use crate::vault::Vault;
    use platform_desktop::{FixedAppPaths, MemorySecretStore};
    use std::time::Duration;
    use tempfile::tempdir;

    async fn unlocked_repo() -> (tempfile::TempDir, VaultRepository) {
        let dir = tempdir().unwrap();
        let paths = Arc::new(FixedAppPaths {
            data: dir.path().join("data"),
            cache: dir.path().join("cache"),
        });
        let secrets = Arc::new(MemorySecretStore::default());
        let vault =
            Arc::new(Vault::open_with_idle(paths, secrets, Duration::from_secs(3600)).unwrap());
        vault.create(&SecretString::new("pw"), true).await.unwrap();
        (dir, VaultRepository::new(vault))
    }

    #[tokio::test]
    async fn host_crud_and_auth() {
        let (_dir, repo) = unlocked_repo().await;
        let created = repo
            .create_host(CreateHostRequest {
                label: "lab".into(),
                hostname: "127.0.0.1".into(),
                port: 2222,
                username: "testuser".into(),
                password: Some(SecretString::new("testpass")),
                sync_secret: false,
                color: Some("#70A5F5".into()),
            shell_integration: Default::default(),
            })
            .await
            .unwrap();
        assert!(created.has_password);

        let listed = repo.list_hosts().await.unwrap();
        assert_eq!(listed.len(), 1);

        let host = repo.get_host(created.id).await.unwrap();
        let auth = repo.credentials_for(&host).await.unwrap();
        match &auth {
            AuthMaterial::Password { password } => assert_eq!(password.expose(), "testpass"),
            _ => panic!("expected password"),
        }

        repo.delete_host(created.id).await.unwrap();
        assert!(repo.list_hosts().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn known_host_key_persists_across_reload() {
        let (_dir, repo) = unlocked_repo().await;
        let created = repo
            .create_host(CreateHostRequest {
                label: "lab".into(),
                hostname: "127.0.0.1".into(),
                port: 2222,
                username: "testuser".into(),
                password: Some(SecretString::new("testpass")),
                sync_secret: false,
                color: None,
            shell_integration: Default::default(),
            })
            .await
            .unwrap();

        let key = KnownHostKey {
            algorithm: "ssh-ed25519".into(),
            fingerprint_sha256: "abc".into(),
            openssh: "ssh-ed25519 AAAA".into(),
        };
        repo.set_known_host_key(created.id, key.clone())
            .await
            .unwrap();
        let host = repo.get_host(created.id).await.unwrap();
        assert_eq!(host.known_host_key.as_ref(), Some(&key));

        repo.vault().lock().await.unwrap();
        assert!(matches!(
            repo.list_hosts().await.unwrap_err(),
            Error::VaultLocked
        ));
        repo.vault().unlock(&SecretString::new("pw")).await.unwrap();
        let host = repo.get_host(created.id).await.unwrap();
        assert_eq!(host.known_host_key.as_ref(), Some(&key));
    }

    #[tokio::test]
    async fn update_host_password_and_metadata() {
        let (_dir, repo) = unlocked_repo().await;
        let created = repo
            .create_host(CreateHostRequest {
                label: "old".into(),
                hostname: "10.0.0.1".into(),
                port: 22,
                username: "alice".into(),
                password: Some(SecretString::new("one")),
                sync_secret: false,
                color: None,
            shell_integration: Default::default(),
            })
            .await
            .unwrap();

        let updated = repo
            .update_host(
                created.id,
                CreateHostRequest {
                    label: "new".into(),
                    hostname: "10.0.0.2".into(),
                    port: 2222,
                    username: "bob".into(),
                    password: Some(SecretString::new("two")),
                    sync_secret: false,
                    color: Some("#CF718B".into()),
                shell_integration: Default::default(),
                },
            )
            .await
            .unwrap();
        assert_eq!(updated.label, "new");
        assert_eq!(updated.port, 2222);
        assert!(updated.has_password);
        assert_eq!(updated.color.as_deref(), Some("#CF718B"));

        let host = repo.get_host(created.id).await.unwrap();
        match &repo.credentials_for(&host).await.unwrap() {
            AuthMaterial::Password { password } => assert_eq!(password.expose(), "two"),
            _ => panic!("expected password"),
        }
    }

    #[tokio::test]
    async fn ssh_config_import_updates_hosts_and_links_jump_dependency() {
        let (_dir, repo) = unlocked_repo().await;
        let existing = repo
            .create_host(CreateHostRequest {
                label: "target".into(),
                hostname: "old.example.com".into(),
                port: 22,
                username: "old-user".into(),
                password: Some(SecretString::new("keep-me")),
                sync_secret: false,
                color: None,
            shell_integration: Default::default(),
            })
            .await
            .unwrap();
        let config = r#"
            Host target
              HostName private.example.com
              User deploy
              Port 2222
              ProxyJump bastion

            Host bastion
              HostName jump.example.com
              User ops
        "#;

        let imported = repo
            .import_ssh_config(config, &["target".to_owned()])
            .await
            .unwrap();
        assert_eq!(imported.len(), 2);
        let listed = repo.list_hosts().await.unwrap();
        assert_eq!(listed.len(), 2);

        let target = repo.get_host(existing.id).await.unwrap();
        assert_eq!(target.hostname, "private.example.com");
        assert_eq!(target.username, "deploy");
        assert_eq!(target.port, 2222);
        let bastion = listed.iter().find(|host| host.label == "bastion").unwrap();
        assert_eq!(target.jump_host_id, Some(bastion.id));
        match &repo.credentials_for(&target).await.unwrap() {
            AuthMaterial::Password { password } => assert_eq!(password.expose(), "keep-me"),
            _ => panic!("expected preserved password"),
        }

        repo.import_ssh_config(config, &["target".to_owned()])
            .await
            .unwrap();
        assert_eq!(repo.list_hosts().await.unwrap().len(), 2);
    }
}
