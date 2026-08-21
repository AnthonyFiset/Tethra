//! Serialisable plaintext payloads stored inside encrypted vault items.
//!
//! These DTOs intentionally avoid [`crate::model::SecretString`] so they can be
//! JSON-encoded before AEAD. Callers must drop plaintext promptly after use.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{
    ApiKey, AssistProviderKind, Host, KnownHostKey, Project, ProjectLocation, RunningSession,
    ShellIntegration,
};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostRecord {
    pub id: Uuid,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub identity_id: Option<Uuid>,
    pub jump_host_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    pub known_host_key: Option<KnownHostKey>,
    pub tags: Vec<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub shell_integration: ShellIntegration,
}

impl From<&Host> for HostRecord {
    fn from(host: &Host) -> Self {
        Self {
            id: host.id,
            label: host.label.clone(),
            hostname: host.hostname.clone(),
            port: host.port,
            username: host.username.clone(),
            identity_id: host.identity_id,
            jump_host_id: host.jump_host_id,
            folder_id: host.folder_id,
            known_host_key: host.known_host_key.clone(),
            tags: host.tags.clone(),
            color: host.color.clone(),
            shell_integration: host.shell_integration,
        }
    }
}

impl From<HostRecord> for Host {
    fn from(record: HostRecord) -> Self {
        Self {
            id: record.id,
            label: record.label,
            hostname: record.hostname,
            port: record.port,
            username: record.username,
            identity_id: record.identity_id,
            jump_host_id: record.jump_host_id,
            folder_id: record.folder_id,
            known_host_key: record.known_host_key,
            tags: record.tags,
            color: record.color,
            shell_integration: record.shell_integration,
        }
    }
}

/// Password identity payload. Private-key identities stay device-local.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordIdentityRecord {
    pub id: Uuid,
    pub label: String,
    pub password: String,
    /// When true, the encrypted identity syncs like a host. Default off.
    /// Does not apply to private keys (`PROJECT.md` §7).
    #[serde(default)]
    pub sync_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub id: Uuid,
    pub name: String,
    pub location: ProjectLocation,
    pub default_agent: Option<String>,
    #[serde(default)]
    pub assist_key_id: Option<Uuid>,
    pub last_opened: Option<DateTime<Utc>>,
}

impl From<&Project> for ProjectRecord {
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

impl From<ProjectRecord> for Project {
    fn from(record: ProjectRecord) -> Self {
        Self {
            id: record.id,
            name: record.name,
            location: record.location,
            default_agent: record.default_agent,
            assist_key_id: record.assist_key_id,
            last_opened: record.last_opened,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningSessionRecord {
    pub id: Uuid,
    pub project_id: Uuid,
    pub host_id: Uuid,
    pub agent_id: Option<String>,
    pub mux_session: String,
    pub started_at: DateTime<Utc>,
    pub last_attached_at: DateTime<Utc>,
    pub started_on_device: String,
}

impl From<&RunningSession> for RunningSessionRecord {
    fn from(session: &RunningSession) -> Self {
        Self {
            id: session.id,
            project_id: session.project_id,
            host_id: session.host_id,
            agent_id: session.agent_id.clone(),
            mux_session: session.mux_session.clone(),
            started_at: session.started_at,
            last_attached_at: session.last_attached_at,
            started_on_device: session.started_on_device.clone(),
        }
    }
}

impl From<RunningSessionRecord> for RunningSession {
    fn from(record: RunningSessionRecord) -> Self {
        Self {
            id: record.id,
            project_id: record.project_id,
            host_id: record.host_id,
            agent_id: record.agent_id,
            mux_session: record.mux_session,
            started_at: record.started_at,
            last_attached_at: record.last_attached_at,
            started_on_device: record.started_on_device,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyRecord {
    pub id: Uuid,
    pub label: String,
    pub provider: AssistProviderKind,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_key: String,
    #[serde(default)]
    pub sync_secret: bool,
}

impl From<&ApiKey> for ApiKeyRecord {
    fn from(key: &ApiKey) -> Self {
        Self {
            id: key.id,
            label: key.label.clone(),
            provider: key.provider,
            base_url: key.base_url.clone(),
            model: key.model.clone(),
            api_key: key.api_key.expose().to_string(),
            sync_secret: key.sync_secret,
        }
    }
}

impl From<ApiKeyRecord> for ApiKey {
    fn from(record: ApiKeyRecord) -> Self {
        Self {
            id: record.id,
            label: record.label,
            provider: record.provider,
            base_url: record.base_url,
            model: record.model,
            api_key: crate::model::SecretString::new(record.api_key),
            sync_secret: record.sync_secret,
        }
    }
}
