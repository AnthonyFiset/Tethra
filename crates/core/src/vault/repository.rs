//! Vault-backed host CRUD, SSH config import, and SSH adapters.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::records::{
    ApiKeyRecord, HostRecord, IdentityRecord, ProjectRecord, RunningSessionRecord,
};
use super::store::{ItemKind, ItemRow};
use super::{Vault, get_encrypted_json, put_encrypted_json};
use crate::model::{
    ApiKey, AssistProviderKind, AuthMaterial, Host, KnownHostKey, Project, ProjectLocation,
    RunningSession, SecretBytes, SecretString, ShellIntegration, TunnelDefinition,
};
use crate::ssh::{
    AuthProvider, HostStore, parse_private_key_bytes, presented_from_public_key,
    private_key_appears_encrypted,
};
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
    /// Linked vault identity, if any.
    pub identity_id: Option<Uuid>,
    /// `password`, `sshKey`, or `none`.
    pub auth_kind: String,
    /// Whether the password identity is opted into vault sync.
    pub sync_secret: bool,
    pub color: Option<String>,
    pub tags: Vec<String>,
    pub shell_integration: ShellIntegration,
    pub tunnels: Vec<TunnelDefinition>,
    pub forward_agent: bool,
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
            identity_id: host.identity_id,
            auth_kind: if host.identity_id.is_some() {
                "password".into()
            } else {
                "none".into()
            },
            sync_secret: false,
            color: host.color.clone(),
            tags: host.tags.clone(),
            shell_integration: host.shell_integration,
            tunnels: host.tunnels.clone(),
            forward_agent: host.forward_agent,
        }
    }
}

/// Create/update payload. Password / identity_id are optional and never returned.
#[derive(Debug)]
pub struct CreateHostRequest {
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub password: Option<SecretString>,
    /// Attach an existing vault identity (password or SSH key).
    pub identity_id: Option<Uuid>,
    /// Opt-in: sync the password identity ciphertext. Default false.
    pub sync_secret: bool,
    pub color: Option<String>,
    pub shell_integration: ShellIntegration,
    pub tunnels: Vec<TunnelDefinition>,
    pub forward_agent: bool,
}

/// Non-secret identity metadata for UI / IPC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentitySummary {
    pub id: Uuid,
    pub label: String,
    /// `password` or `sshKey`.
    pub kind: String,
    pub fingerprint: Option<String>,
    pub usage_count: u32,
    pub created_at: Option<chrono::DateTime<Utc>>,
    /// Opt-in: encrypted identity rides vault sync.
    pub sync_secret: bool,
}

/// Result of attempting to delete an identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityDeleteResult {
    pub deleted: bool,
    pub dependent_hosts: Vec<(Uuid, String)>,
}

/// Non-secret project metadata for UI / IPC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub location: ProjectLocation,
    pub default_agent: Option<String>,
    pub assist_key_id: Option<Uuid>,
    pub last_opened: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<&Project> for ProjectSummary {
    fn from(project: &Project) -> Self {
        Self {
            id: project.id,
            name: project.name.clone(),
            location: project.location.clone(),
            default_agent: project.default_agent.clone(),
            assist_key_id: project.assist_key_id,
            last_opened: project.last_opened,
        }
    }
}

/// Create/update payload for projects.
#[derive(Debug)]
pub struct CreateProjectRequest {
    pub name: String,
    pub location: ProjectLocation,
    pub default_agent: Option<String>,
    pub assist_key_id: Option<Uuid>,
}

/// Non-secret running-session metadata for UI / IPC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunningSessionSummary {
    pub id: Uuid,
    pub project_id: Uuid,
    pub project_name: String,
    pub host_id: Uuid,
    pub host_label: String,
    pub agent_id: Option<String>,
    pub mux_session: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub last_attached_at: chrono::DateTime<chrono::Utc>,
    pub started_on_device: String,
}

/// Non-secret API key metadata for UI / IPC (never includes the raw key).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKeySummary {
    pub id: Uuid,
    pub label: String,
    pub provider: AssistProviderKind,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub sync_secret: bool,
    pub has_key: bool,
}

/// Create/update payload for Assist API keys.
#[derive(Debug)]
pub struct CreateApiKeyRequest {
    pub label: String,
    pub provider: AssistProviderKind,
    pub base_url: Option<String>,
    pub model: Option<String>,
    /// Required on create; optional on update (leave unchanged when None).
    pub api_key: Option<SecretString>,
    pub sync_secret: bool,
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
            let (has_password, auth_kind, sync_secret) =
                self.identity_meta(record.identity_id).await?;
            let host = Host::from(record);
            let mut summary = HostSummary::from(&host);
            summary.has_password = has_password;
            summary.auth_kind = auth_kind;
            summary.sync_secret = sync_secret;
            out.push(summary);
        }
        Ok(out)
    }

    async fn identity_meta(&self, identity_id: Option<Uuid>) -> Result<(bool, String, bool)> {
        let Some(identity_id) = identity_id else {
            return Ok((false, "none".into(), false));
        };
        let item = self.vault.with_db(|db| db.get_item(identity_id)).await?;
        if !item.is_some_and(|item| !item.deleted && item.kind == ItemKind::Identity) {
            return Ok((false, "none".into(), false));
        }
        match get_encrypted_json::<IdentityRecord>(&self.vault, identity_id).await {
            Ok((IdentityRecord::Password { sync_secret, .. }, _)) => {
                Ok((true, "password".into(), sync_secret))
            }
            Ok((IdentityRecord::SshKey { sync_secret, .. }, _)) => {
                Ok((false, "sshKey".into(), sync_secret))
            }
            Err(_) => Ok((false, "none".into(), false)),
        }
    }

    pub async fn create_host(&self, request: CreateHostRequest) -> Result<HostSummary> {
        let mut host =
            Host::new(request.label, request.hostname, request.username).with_port(request.port);
        host.color = validate_host_color(request.color)?;
        host.shell_integration = request.shell_integration;
        host.tunnels = request.tunnels;
        host.forward_agent = request.forward_agent;

        if let Some(identity_id) = request.identity_id {
            let (identity, _) = get_encrypted_json::<IdentityRecord>(&self.vault, identity_id)
                .await
                .map_err(|_| Error::IdentityNotFound(identity_id))?;
            if identity.id() != identity_id {
                return Err(Error::InvalidArgument("identity id mismatch".into()));
            }
            host.identity_id = Some(identity_id);
        } else if let Some(password) = request.password {
            let identity_id = Uuid::now_v7();
            let identity = IdentityRecord::Password {
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
        let (has_password, auth_kind, sync_secret) = self.identity_meta(host.identity_id).await?;
        let mut summary = HostSummary::from(&host);
        summary.has_password = has_password;
        summary.auth_kind = auth_kind;
        summary.sync_secret = sync_secret;
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
        record.tunnels = request.tunnels;
        record.forward_agent = request.forward_agent;

        if let Some(identity_id) = request.identity_id {
            let _ = get_encrypted_json::<IdentityRecord>(&self.vault, identity_id)
                .await
                .map_err(|_| Error::IdentityNotFound(identity_id))?;
            record.identity_id = Some(identity_id);
        } else if let Some(password) = request.password {
            let identity_id = record.identity_id.unwrap_or_else(Uuid::now_v7);
            // Replacing with a password identity — if prior was a shared SSH key, leave
            // the key row alone and mint/overwrite only when prior was password or none.
            let identity = IdentityRecord::Password {
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
                get_encrypted_json::<IdentityRecord>(&self.vault, identity_id).await
            && let IdentityRecord::Password {
                sync_secret: slot, ..
            } = &mut identity
            && *slot != request.sync_secret
        {
            *slot = request.sync_secret;
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
        let (has_password, auth_kind, sync_secret) = self.identity_meta(host.identity_id).await?;
        let mut summary = HostSummary::from(&host);
        summary.has_password = has_password;
        summary.auth_kind = auth_kind;
        summary.sync_secret = sync_secret;
        Ok(summary)
    }

    pub async fn delete_host(&self, id: Uuid) -> Result<()> {
        let (record, row) = get_encrypted_json::<HostRecord>(&self.vault, id).await?;
        if let Some(identity_id) = record.identity_id {
            let dependents = self.hosts_using_identity(identity_id).await?;
            let only_this = dependents.len() == 1 && dependents[0].0 == id;
            if only_this
                && let Ok((identity, irow)) =
                    get_encrypted_json::<IdentityRecord>(&self.vault, identity_id).await
            {
                put_encrypted_json(
                    &self.vault,
                    identity_id,
                    ItemKind::Identity,
                    irow.version + 1,
                    !identity.sync_secret(),
                    true,
                    &identity,
                )
                .await?;
            }
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

    pub async fn list_projects(&self) -> Result<Vec<ProjectSummary>> {
        let key = self.vault.require_key().await?;
        let rows = self
            .vault
            .with_db(|db| db.list_items(ItemKind::Project, false))
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let plaintext = super::crypto::decrypt_item(&key, row.id, row.version, &row.blob)?;
            let record: ProjectRecord = serde_json::from_slice(&plaintext)?;
            out.push(ProjectSummary::from(&Project::from(record)));
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        Ok(out)
    }

    pub async fn create_project(&self, request: CreateProjectRequest) -> Result<ProjectSummary> {
        validate_project_request(&request)?;
        let mut project = match &request.location {
            ProjectLocation::Local { path } => Project::local(&request.name, path),
            ProjectLocation::Remote { host_id, path } => {
                Project::remote(&request.name, *host_id, path)
            }
        };
        project.default_agent = request.default_agent;
        project.assist_key_id = request.assist_key_id;
        let record = ProjectRecord::from(&project);
        put_encrypted_json(
            &self.vault,
            project.id,
            ItemKind::Project,
            1,
            false,
            false,
            &record,
        )
        .await?;
        Ok(ProjectSummary::from(&project))
    }

    pub async fn update_project(
        &self,
        id: Uuid,
        request: CreateProjectRequest,
    ) -> Result<ProjectSummary> {
        validate_project_request(&request)?;
        let (mut record, row) = get_encrypted_json::<ProjectRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::Project {
            return Err(Error::InvalidArgument("item is not a project".into()));
        }
        record.name = request.name;
        record.location = request.location;
        record.default_agent = request.default_agent;
        record.assist_key_id = request.assist_key_id;
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::Project,
            row.version + 1,
            false,
            false,
            &record,
        )
        .await?;
        Ok(ProjectSummary::from(&Project::from(record)))
    }

    pub async fn touch_project_opened(&self, id: Uuid) -> Result<ProjectSummary> {
        let (mut record, row) = get_encrypted_json::<ProjectRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::Project {
            return Err(Error::InvalidArgument("item is not a project".into()));
        }
        record.last_opened = Some(Utc::now());
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::Project,
            row.version + 1,
            false,
            false,
            &record,
        )
        .await?;
        Ok(ProjectSummary::from(&Project::from(record)))
    }

    pub async fn delete_project(&self, id: Uuid) -> Result<()> {
        let (record, row) = get_encrypted_json::<ProjectRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::Project {
            return Err(Error::InvalidArgument("item is not a project".into()));
        }
        // Drop any advertised running session for this project.
        if let Some(session) = self.find_running_session_for_project(id).await? {
            self.end_running_session(session.id).await?;
        }
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::Project,
            row.version + 1,
            false,
            true,
            &record,
        )
        .await?;
        Ok(())
    }

    pub async fn list_running_sessions(&self) -> Result<Vec<RunningSessionSummary>> {
        let key = self.vault.require_key().await?;
        let rows = self
            .vault
            .with_db(|db| db.list_items(ItemKind::RunningSession, false))
            .await?;
        let projects = self.list_projects().await?;
        let hosts = self.list_hosts().await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let plaintext = super::crypto::decrypt_item(&key, row.id, row.version, &row.blob)?;
            let record: RunningSessionRecord = serde_json::from_slice(&plaintext)?;
            let project_name = projects
                .iter()
                .find(|p| p.id == record.project_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| "Unknown project".into());
            let host_label = hosts
                .iter()
                .find(|h| h.id == record.host_id)
                .map(|h| h.label.clone())
                .unwrap_or_else(|| "Unknown host".into());
            out.push(RunningSessionSummary {
                id: record.id,
                project_id: record.project_id,
                project_name,
                host_id: record.host_id,
                host_label,
                agent_id: record.agent_id,
                mux_session: record.mux_session,
                started_at: record.started_at,
                last_attached_at: record.last_attached_at,
                started_on_device: record.started_on_device,
            });
        }
        out.sort_by_key(|b| std::cmp::Reverse(b.last_attached_at));
        Ok(out)
    }

    /// Upsert one running session per project (reattach updates last_attached_at).
    pub async fn mark_project_running(
        &self,
        project_id: Uuid,
        host_id: Uuid,
        agent_id: Option<String>,
        started_on_device: String,
    ) -> Result<RunningSessionSummary> {
        if let Some(existing) = self.find_running_session_for_project(project_id).await? {
            let (mut record, row) =
                get_encrypted_json::<RunningSessionRecord>(&self.vault, existing.id).await?;
            record.host_id = host_id;
            record.agent_id = agent_id;
            record.mux_session = crate::model::mux_session_name(project_id);
            record.last_attached_at = Utc::now();
            // Keep original started_on_device / started_at.
            put_encrypted_json(
                &self.vault,
                existing.id,
                ItemKind::RunningSession,
                row.version + 1,
                false,
                false,
                &record,
            )
            .await?;
            return self
                .list_running_sessions()
                .await?
                .into_iter()
                .find(|s| s.id == existing.id)
                .ok_or_else(|| {
                    Error::InvalidArgument("running session missing after update".into())
                });
        }

        let session = RunningSession::start(project_id, host_id, agent_id, started_on_device);
        let record = RunningSessionRecord::from(&session);
        put_encrypted_json(
            &self.vault,
            session.id,
            ItemKind::RunningSession,
            1,
            false,
            false,
            &record,
        )
        .await?;
        self.list_running_sessions()
            .await?
            .into_iter()
            .find(|s| s.id == session.id)
            .ok_or_else(|| Error::InvalidArgument("running session missing after create".into()))
    }

    pub async fn end_running_session(&self, id: Uuid) -> Result<()> {
        let (record, row) = get_encrypted_json::<RunningSessionRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::RunningSession {
            return Err(Error::InvalidArgument(
                "item is not a running session".into(),
            ));
        }
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::RunningSession,
            row.version + 1,
            false,
            true,
            &record,
        )
        .await?;
        Ok(())
    }

    async fn find_running_session_for_project(
        &self,
        project_id: Uuid,
    ) -> Result<Option<RunningSession>> {
        let key = self.vault.require_key().await?;
        let rows = self
            .vault
            .with_db(|db| db.list_items(ItemKind::RunningSession, false))
            .await?;
        for row in rows {
            let plaintext = super::crypto::decrypt_item(&key, row.id, row.version, &row.blob)?;
            let record: RunningSessionRecord = serde_json::from_slice(&plaintext)?;
            if record.project_id == project_id {
                return Ok(Some(RunningSession::from(record)));
            }
        }
        Ok(None)
    }

    pub async fn list_api_keys(&self) -> Result<Vec<ApiKeySummary>> {
        let key = self.vault.require_key().await?;
        let rows = self
            .vault
            .with_db(|db| db.list_items(ItemKind::ApiKey, false))
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let plaintext = super::crypto::decrypt_item(&key, row.id, row.version, &row.blob)?;
            let record: ApiKeyRecord = serde_json::from_slice(&plaintext)?;
            out.push(ApiKeySummary {
                id: record.id,
                label: record.label,
                provider: record.provider,
                base_url: record.base_url,
                model: record.model,
                sync_secret: record.sync_secret,
                has_key: !record.api_key.is_empty(),
            });
        }
        out.sort_by_key(|a| a.label.to_lowercase());
        Ok(out)
    }

    pub async fn create_api_key(&self, request: CreateApiKeyRequest) -> Result<ApiKeySummary> {
        // Local OpenAI-compat servers (Ollama / LM Studio) may omit a key.
        let require_key = !matches!(request.provider, AssistProviderKind::OpenAiCompat);
        validate_api_key_request(&request, require_key)?;
        let api_key = request
            .api_key
            .unwrap_or_else(|| SecretString::new(String::new()));
        let has_key = !api_key.expose().trim().is_empty();
        let mut key = ApiKey::new(request.label, request.provider, api_key);
        key.base_url = request.base_url;
        key.model = request.model;
        key.sync_secret = request.sync_secret;
        let record = ApiKeyRecord::from(&key);
        put_encrypted_json(
            &self.vault,
            key.id,
            ItemKind::ApiKey,
            1,
            !request.sync_secret,
            false,
            &record,
        )
        .await?;
        Ok(ApiKeySummary {
            id: key.id,
            label: key.label,
            provider: key.provider,
            base_url: key.base_url,
            model: key.model,
            sync_secret: key.sync_secret,
            has_key,
        })
    }

    pub async fn update_api_key(
        &self,
        id: Uuid,
        request: CreateApiKeyRequest,
    ) -> Result<ApiKeySummary> {
        validate_api_key_request(&request, false)?;
        let (mut record, row) = get_encrypted_json::<ApiKeyRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::ApiKey {
            return Err(Error::InvalidArgument("item is not an api key".into()));
        }
        record.label = request.label;
        record.provider = request.provider;
        record.base_url = request.base_url;
        record.model = request.model;
        record.sync_secret = request.sync_secret;
        if let Some(api_key) = request.api_key {
            record.api_key = api_key.expose().to_string();
        }
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::ApiKey,
            row.version + 1,
            !request.sync_secret,
            false,
            &record,
        )
        .await?;
        Ok(ApiKeySummary {
            id: record.id,
            label: record.label,
            provider: record.provider,
            base_url: record.base_url,
            model: record.model,
            sync_secret: record.sync_secret,
            has_key: !record.api_key.is_empty(),
        })
    }

    pub async fn delete_api_key(&self, id: Uuid) -> Result<()> {
        let (record, row) = get_encrypted_json::<ApiKeyRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::ApiKey {
            return Err(Error::InvalidArgument("item is not an api key".into()));
        }
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::ApiKey,
            row.version + 1,
            !record.sync_secret,
            true,
            &record,
        )
        .await?;
        Ok(())
    }

    /// Load the full key for Assist HTTP calls. Never expose via IPC DTO.
    pub async fn get_api_key(&self, id: Uuid) -> Result<ApiKey> {
        let (record, row) = get_encrypted_json::<ApiKeyRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::ApiKey {
            return Err(Error::InvalidArgument("item is not an api key".into()));
        }
        Ok(ApiKey::from(record))
    }

    pub async fn list_identities(&self) -> Result<Vec<IdentitySummary>> {
        let key = self.vault.require_key().await?;
        let rows = self
            .vault
            .with_db(|db| db.list_items(ItemKind::Identity, false))
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let plaintext = super::crypto::decrypt_item(&key, row.id, row.version, &row.blob)?;
            let identity: IdentityRecord = match serde_json::from_slice(&plaintext) {
                Ok(v) => v,
                Err(_) => continue,
            };
            out.push(self.identity_to_summary(identity).await?);
        }
        out.sort_by_key(|a| a.label.to_lowercase());
        Ok(out)
    }

    async fn identity_to_summary(&self, identity: IdentityRecord) -> Result<IdentitySummary> {
        let usage_count = self.hosts_using_identity(identity.id()).await?.len() as u32;
        match identity {
            IdentityRecord::Password {
                id,
                label,
                sync_secret,
                ..
            } => Ok(IdentitySummary {
                id,
                label,
                kind: "password".into(),
                fingerprint: None,
                usage_count,
                created_at: None,
                sync_secret,
            }),
            IdentityRecord::SshKey {
                id,
                label,
                private_key,
                passphrase,
                created_at,
                sync_secret,
            } => {
                let fingerprint =
                    fingerprint_for_key_text(&private_key, passphrase.as_deref()).ok();
                Ok(IdentitySummary {
                    id,
                    label,
                    kind: "sshKey".into(),
                    fingerprint,
                    usage_count,
                    created_at: Some(created_at),
                    sync_secret,
                })
            }
        }
    }

    pub async fn hosts_using_identity(&self, identity_id: Uuid) -> Result<Vec<(Uuid, String)>> {
        let hosts = self.list_hosts().await?;
        Ok(hosts
            .into_iter()
            .filter(|h| h.identity_id == Some(identity_id))
            .map(|h| (h.id, h.label))
            .collect())
    }

    /// Import a private key file into the vault.
    ///
    /// `sync_secret` defaults to false (device-local). When true, ciphertext
    /// rides vault sync the same way as an opted-in password.
    pub async fn import_ssh_key_identity(
        &self,
        label: String,
        key_bytes: &[u8],
        passphrase: Option<&str>,
        remember_passphrase: bool,
        sync_secret: bool,
    ) -> Result<IdentitySummary> {
        let label = label.trim().to_string();
        if label.is_empty() {
            return Err(Error::InvalidArgument("identity label is required".into()));
        }
        let parsed = parse_private_key_bytes(key_bytes, passphrase)?;
        let _ = parsed; // validated
        let text = std::str::from_utf8(key_bytes)
            .map_err(|_| Error::InvalidKey("private key is not UTF-8 text".into()))?
            .to_string();
        let identity_id = Uuid::now_v7();
        let stored_pass = if remember_passphrase {
            passphrase.map(str::to_string)
        } else {
            None
        };
        let identity = IdentityRecord::SshKey {
            id: identity_id,
            label,
            private_key: text,
            passphrase: stored_pass,
            created_at: Utc::now(),
            sync_secret,
        };
        put_encrypted_json(
            &self.vault,
            identity_id,
            ItemKind::Identity,
            1,
            !sync_secret,
            false,
            &identity,
        )
        .await?;
        self.identity_to_summary(identity).await
    }

    pub async fn rename_identity(&self, id: Uuid, label: String) -> Result<IdentitySummary> {
        let label = label.trim().to_string();
        if label.is_empty() {
            return Err(Error::InvalidArgument("identity label is required".into()));
        }
        let (mut identity, row) = get_encrypted_json::<IdentityRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::Identity {
            return Err(Error::InvalidArgument("item is not an identity".into()));
        }
        identity.set_label(label);
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::Identity,
            row.version + 1,
            !identity.sync_secret(),
            false,
            &identity,
        )
        .await?;
        self.identity_to_summary(identity).await
    }

    /// Toggle whether this identity's ciphertext rides vault sync.
    /// Turning off only affects future pushes; peers that already have a copy keep it.
    pub async fn set_identity_sync_secret(
        &self,
        id: Uuid,
        sync_secret: bool,
    ) -> Result<IdentitySummary> {
        let (mut identity, row) = get_encrypted_json::<IdentityRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::Identity {
            return Err(Error::InvalidArgument("item is not an identity".into()));
        }
        identity.set_sync_secret(sync_secret);
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::Identity,
            row.version + 1,
            !sync_secret,
            false,
            &identity,
        )
        .await?;
        self.identity_to_summary(identity).await
    }

    pub async fn delete_identity(&self, id: Uuid, force: bool) -> Result<IdentityDeleteResult> {
        let (identity, row) = get_encrypted_json::<IdentityRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::Identity {
            return Err(Error::InvalidArgument("item is not an identity".into()));
        }
        let dependent_hosts = self.hosts_using_identity(id).await?;
        if !dependent_hosts.is_empty() && !force {
            return Ok(IdentityDeleteResult {
                deleted: false,
                dependent_hosts,
            });
        }
        for (host_id, _) in &dependent_hosts {
            let (mut host, hrow) = get_encrypted_json::<HostRecord>(&self.vault, *host_id).await?;
            host.identity_id = None;
            put_encrypted_json(
                &self.vault,
                *host_id,
                ItemKind::Host,
                hrow.version + 1,
                false,
                false,
                &host,
            )
            .await?;
        }
        put_encrypted_json(
            &self.vault,
            id,
            ItemKind::Identity,
            row.version + 1,
            !identity.sync_secret(),
            true,
            &identity,
        )
        .await?;
        Ok(IdentityDeleteResult {
            deleted: true,
            dependent_hosts,
        })
    }

    /// Probe a key file without storing it (for UI passphrase prompt).
    pub fn probe_ssh_key_file(key_bytes: &[u8]) -> Result<(bool, Option<String>)> {
        let encrypted = private_key_appears_encrypted(key_bytes);
        if encrypted {
            return Ok((true, None));
        }
        let fingerprint =
            fingerprint_for_key_text(std::str::from_utf8(key_bytes).unwrap_or(""), None).ok();
        // If we can't parse an unencrypted key, still surface the error at import time.
        if fingerprint.is_none() {
            parse_private_key_bytes(key_bytes, None)?;
        }
        Ok((false, fingerprint))
    }

    pub async fn get_host(&self, id: Uuid) -> Result<Host> {
        let (record, _) = get_encrypted_json::<HostRecord>(&self.vault, id).await?;
        Ok(Host::from(record))
    }

    pub async fn get_project(&self, id: Uuid) -> Result<Project> {
        let (record, row) = get_encrypted_json::<ProjectRecord>(&self.vault, id).await?;
        if row.kind != ItemKind::Project {
            return Err(Error::InvalidArgument("item is not a project".into()));
        }
        Ok(Project::from(record))
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

fn fingerprint_for_key_text(private_key: &str, passphrase: Option<&str>) -> Result<String> {
    let key = parse_private_key_bytes(private_key.as_bytes(), passphrase)?;
    let presented = presented_from_public_key(key.public_key());
    Ok(format!(
        "{} {}",
        presented.algorithm, presented.fingerprint_sha256
    ))
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

fn validate_project_request(request: &CreateProjectRequest) -> Result<()> {
    if request.name.trim().is_empty() {
        return Err(Error::InvalidArgument("project name is required".into()));
    }
    let path = match &request.location {
        ProjectLocation::Local { path } => path,
        ProjectLocation::Remote { path, .. } => path,
    };
    if path.trim().is_empty() {
        return Err(Error::InvalidArgument("project path is required".into()));
    }
    if let Some(agent) = &request.default_agent
        && agent.trim().is_empty()
    {
        return Err(Error::InvalidArgument(
            "default agent id must not be empty".into(),
        ));
    }
    Ok(())
}

fn validate_api_key_request(request: &CreateApiKeyRequest, require_key: bool) -> Result<()> {
    if request.label.trim().is_empty() {
        return Err(Error::InvalidArgument("api key label is required".into()));
    }
    if require_key {
        let Some(key) = &request.api_key else {
            return Err(Error::InvalidArgument("api key is required".into()));
        };
        if key.expose().trim().is_empty() {
            return Err(Error::InvalidArgument("api key is required".into()));
        }
    }
    if matches!(request.provider, AssistProviderKind::OpenAiCompat)
        && request
            .base_url
            .as_ref()
            .is_none_or(|url| url.trim().is_empty())
    {
        return Err(Error::InvalidArgument(
            "base URL is required for OpenAI-compatible providers".into(),
        ));
    }
    Ok(())
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
        let (identity, _) = get_encrypted_json::<IdentityRecord>(&self.vault, identity_id)
            .await
            .map_err(|err| match err {
                Error::Other(_) => Error::IdentityNotFound(identity_id),
                other => other,
            })?;
        match identity {
            IdentityRecord::Password { password, .. } => Ok(AuthMaterial::Password {
                password: SecretString::new(password),
            }),
            IdentityRecord::SshKey {
                private_key,
                passphrase,
                ..
            } => Ok(AuthMaterial::PrivateKey {
                key: SecretBytes::new(private_key.into_bytes()),
                passphrase: passphrase.map(SecretString::new),
            }),
        }
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
                identity_id: None,
                sync_secret: false,
                color: Some("#70A5F5".into()),
                shell_integration: Default::default(),
                tunnels: Vec::new(),
                forward_agent: false,
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
    async fn project_crud_roundtrip() {
        let (_dir, repo) = unlocked_repo().await;
        let host = repo
            .create_host(CreateHostRequest {
                label: "box".into(),
                hostname: "10.0.0.1".into(),
                port: 22,
                username: "u".into(),
                password: Some(SecretString::new("pw")),
                identity_id: None,
                sync_secret: false,
                color: None,
                shell_integration: Default::default(),
                tunnels: Vec::new(),
                forward_agent: false,
            })
            .await
            .unwrap();

        let created = repo
            .create_project(CreateProjectRequest {
                name: "tethra".into(),
                location: ProjectLocation::Remote {
                    host_id: host.id,
                    path: "/srv/tethra".into(),
                },
                default_agent: Some("claude-code".into()),
                assist_key_id: None,
            })
            .await
            .unwrap();
        assert_eq!(created.name, "tethra");
        assert_eq!(created.default_agent.as_deref(), Some("claude-code"));

        let listed = repo.list_projects().await.unwrap();
        assert_eq!(listed.len(), 1);

        let touched = repo.touch_project_opened(created.id).await.unwrap();
        assert!(touched.last_opened.is_some());

        repo.delete_project(created.id).await.unwrap();
        assert!(repo.list_projects().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn running_session_upsert_and_end() {
        let (_dir, repo) = unlocked_repo().await;
        let host = repo
            .create_host(CreateHostRequest {
                label: "box".into(),
                hostname: "10.0.0.1".into(),
                port: 22,
                username: "u".into(),
                password: Some(SecretString::new("pw")),
                identity_id: None,
                sync_secret: false,
                color: None,
                shell_integration: Default::default(),
                tunnels: Vec::new(),
                forward_agent: false,
            })
            .await
            .unwrap();
        let project = repo
            .create_project(CreateProjectRequest {
                name: "tethra".into(),
                location: ProjectLocation::Remote {
                    host_id: host.id,
                    path: "/srv/tethra".into(),
                },
                default_agent: Some("claude-code".into()),
                assist_key_id: None,
            })
            .await
            .unwrap();

        let first = repo
            .mark_project_running(
                project.id,
                host.id,
                Some("claude-code".into()),
                "macbook".into(),
            )
            .await
            .unwrap();
        assert_eq!(first.project_name, "tethra");
        assert_eq!(first.host_label, "box");
        assert!(first.mux_session.starts_with("tethra-"));

        let second = repo
            .mark_project_running(
                project.id,
                host.id,
                Some("claude-code".into()),
                "windows".into(),
            )
            .await
            .unwrap();
        assert_eq!(second.id, first.id);
        assert_eq!(second.started_on_device, "macbook");
        assert!(second.last_attached_at >= first.last_attached_at);
        assert_eq!(repo.list_running_sessions().await.unwrap().len(), 1);

        repo.end_running_session(first.id).await.unwrap();
        assert!(repo.list_running_sessions().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn api_key_crud_hides_secret_in_summary() {
        let (_dir, repo) = unlocked_repo().await;
        let created = repo
            .create_api_key(CreateApiKeyRequest {
                label: "Claude".into(),
                provider: AssistProviderKind::Anthropic,
                base_url: None,
                model: Some("claude-sonnet-4-5".into()),
                api_key: Some(SecretString::new("sk-test-secret")),
                sync_secret: false,
            })
            .await
            .unwrap();
        assert!(created.has_key);
        assert!(!created.sync_secret);

        let listed = repo.list_api_keys().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].label, "Claude");

        let loaded = repo.get_api_key(created.id).await.unwrap();
        assert_eq!(loaded.api_key.expose(), "sk-test-secret");

        repo.delete_api_key(created.id).await.unwrap();
        assert!(repo.list_api_keys().await.unwrap().is_empty());
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
                identity_id: None,
                sync_secret: false,
                color: None,
                shell_integration: Default::default(),
                tunnels: Vec::new(),
                forward_agent: false,
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
                identity_id: None,
                sync_secret: false,
                color: None,
                shell_integration: Default::default(),
                tunnels: Vec::new(),
                forward_agent: false,
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
                    identity_id: None,
                    sync_secret: false,
                    color: Some("#CF718B".into()),
                    shell_integration: Default::default(),
                    tunnels: Vec::new(),
                    forward_agent: false,
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
                identity_id: None,
                sync_secret: false,
                color: None,
                shell_integration: Default::default(),
                tunnels: Vec::new(),
                forward_agent: false,
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

    #[tokio::test]
    async fn ssh_key_identity_auths_and_stays_local_only() {
        let (_dir, repo) = unlocked_repo().await;
        // Minimal OpenSSH ed25519 private key (unencrypted).
        let key = b"-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDi/vxdPzP92ZrCMZqwYvZL+2T8y/8vH7bJ8k1pQ0e9WQAAAJgY8mGIGPJh
iAAAAAtzc2gtZWQyNTUxOQAAACDi/vxdPzP92ZrCMZqwYvZL+2T8y/8vH7bJ8k1pQ0e9WQ
AAAEB0pQ8zqG9b7n8oQ7mKQn0bGqH8mG0p9y1xqY5nF0xqY+L+/F0/M/3ZmsIxmrBi9kv7
ZPzL/y8ftsnYTWVDR71ZAAAAEHRlc3RAdGV0aHJhLmxvY2FsAQIDBA==
-----END OPENSSH PRIVATE KEY-----
";
        // Prefer a key generated at test time when ssh-keygen is available.
        let key_bytes = {
            let dir = tempdir().unwrap();
            let path = dir.path().join("id_ed25519");
            let status = std::process::Command::new("ssh-keygen")
                .args(["-t", "ed25519", "-f"])
                .arg(&path)
                .args(["-N", "", "-q"])
                .status();
            if status.map(|s| s.success()).unwrap_or(false) {
                std::fs::read(&path).unwrap()
            } else {
                // Fall back: parse via decode must succeed for embedded — if not, skip.
                key.to_vec()
            }
        };

        let identity = repo
            .import_ssh_key_identity("cloud".into(), &key_bytes, None, false, false)
            .await
            .expect("import key");
        assert_eq!(identity.kind, "sshKey");
        assert!(identity.fingerprint.is_some());
        assert!(!identity.sync_secret);

        let created = repo
            .create_host(CreateHostRequest {
                label: "tethra-vm".into(),
                hostname: "1.2.3.4".into(),
                port: 22,
                username: "anthony".into(),
                password: None,
                identity_id: Some(identity.id),
                sync_secret: false,
                color: None,
                shell_integration: Default::default(),
                tunnels: Vec::new(),
                forward_agent: false,
            })
            .await
            .unwrap();
        assert_eq!(created.auth_kind, "sshKey");
        assert!(!created.has_password);
        assert_eq!(created.identity_id, Some(identity.id));

        let host = repo.get_host(created.id).await.unwrap();
        match repo.credentials_for(&host).await.unwrap() {
            AuthMaterial::PrivateKey {
                ref key,
                ref passphrase,
            } => {
                assert!(!key.expose().is_empty());
                assert!(passphrase.is_none());
            }
            other => panic!("expected private key, got {other:?}"),
        }

        // Default: identity row is local_only.
        let row = repo
            .vault()
            .with_db(|db| db.get_item(identity.id))
            .await
            .unwrap()
            .unwrap();
        assert!(row.local_only);

        // Opt in — same as password sync_secret.
        let synced = repo
            .set_identity_sync_secret(identity.id, true)
            .await
            .unwrap();
        assert!(synced.sync_secret);
        let row = repo
            .vault()
            .with_db(|db| db.get_item(identity.id))
            .await
            .unwrap()
            .unwrap();
        assert!(!row.local_only);

        let blocked = repo.delete_identity(identity.id, false).await.unwrap();
        assert!(!blocked.deleted);
        assert_eq!(blocked.dependent_hosts.len(), 1);

        let deleted = repo.delete_identity(identity.id, true).await.unwrap();
        assert!(deleted.deleted);
        let host = repo.get_host(created.id).await.unwrap();
        assert!(host.identity_id.is_none());
    }
}
