//! Serialisable plaintext payloads stored inside encrypted vault items.
//!
//! These DTOs intentionally avoid [`crate::model::SecretString`] so they can be
//! JSON-encoded before AEAD. Callers must drop plaintext promptly after use.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{
    ApiKey, AssistProviderKind, Host, KnownHostKey, Project, ProjectLocation, RunningSession,
    ShellIntegration, TunnelDefinition,
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
    #[serde(default)]
    pub tunnels: Vec<TunnelDefinition>,
    #[serde(default)]
    pub forward_agent: bool,
    #[serde(default)]
    pub use_default_keys: bool,
    #[serde(default)]
    pub last_connected_at: Option<DateTime<Utc>>,
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
            tunnels: host.tunnels.clone(),
            forward_agent: host.forward_agent,
            use_default_keys: host.use_default_keys,
            last_connected_at: host.last_connected_at,
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
            tunnels: record.tunnels,
            forward_agent: record.forward_agent,
            use_default_keys: record.use_default_keys,
            last_connected_at: record.last_connected_at,
        }
    }
}

/// Password identity payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordIdentityRecord {
    pub id: Uuid,
    pub label: String,
    pub password: String,
    /// When true, the encrypted identity syncs like a host. Default off.
    #[serde(default)]
    pub sync_secret: bool,
}

/// SSH private-key identity. Defaults to device-local; opt-in `sync_secret`
/// rides vault sync as ciphertext (same pattern as passwords).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKeyIdentityRecord {
    pub id: Uuid,
    pub label: String,
    /// OpenSSH or PEM private key text.
    pub private_key: String,
    /// Optional passphrase when the user chose "remember passphrase".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
    pub created_at: DateTime<Utc>,
    /// When true, the encrypted key (+ passphrase) syncs like a host. Default off.
    #[serde(default)]
    pub sync_secret: bool,
}

/// Vault identity payloads. Tagged for forward compatibility (`Agent` later);
/// legacy password rows without `kind` still deserialize.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IdentityRecord {
    Password {
        id: Uuid,
        label: String,
        password: String,
        #[serde(default)]
        sync_secret: bool,
    },
    SshKey {
        id: Uuid,
        label: String,
        private_key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        passphrase: Option<String>,
        created_at: DateTime<Utc>,
        #[serde(default)]
        sync_secret: bool,
    },
}

impl IdentityRecord {
    pub fn id(&self) -> Uuid {
        match self {
            Self::Password { id, .. } | Self::SshKey { id, .. } => *id,
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::Password { label, .. } | Self::SshKey { label, .. } => label,
        }
    }

    pub fn set_label(&mut self, label: String) {
        match self {
            Self::Password { label: slot, .. } | Self::SshKey { label: slot, .. } => {
                *slot = label;
            }
        }
    }

    pub fn is_ssh_key(&self) -> bool {
        matches!(self, Self::SshKey { .. })
    }

    pub fn sync_secret(&self) -> bool {
        match self {
            Self::Password { sync_secret, .. } | Self::SshKey { sync_secret, .. } => *sync_secret,
        }
    }

    pub fn set_sync_secret(&mut self, value: bool) {
        match self {
            Self::Password { sync_secret, .. } | Self::SshKey { sync_secret, .. } => {
                *sync_secret = value;
            }
        }
    }

    pub fn from_password(record: PasswordIdentityRecord) -> Self {
        Self::Password {
            id: record.id,
            label: record.label,
            password: record.password,
            sync_secret: record.sync_secret,
        }
    }

    pub fn from_ssh_key(record: SshKeyIdentityRecord) -> Self {
        Self::SshKey {
            id: record.id,
            label: record.label,
            private_key: record.private_key,
            passphrase: record.passphrase,
            created_at: record.created_at,
            sync_secret: record.sync_secret,
        }
    }
}

impl<'de> Deserialize<'de> for IdentityRecord {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        if let Some(kind) = value.get("kind").and_then(|v| v.as_str()) {
            return match kind {
                "password" => {
                    let id = uuid_field(&value, "id")?;
                    let label = string_field(&value, "label")?;
                    let password = string_field(&value, "password")?;
                    let sync_secret = value
                        .get("sync_secret")
                        .and_then(|v| v.as_bool())
                        .or_else(|| value.get("syncSecret").and_then(|v| v.as_bool()))
                        .unwrap_or(false);
                    Ok(Self::Password {
                        id,
                        label,
                        password,
                        sync_secret,
                    })
                }
                "sshKey" | "ssh_key" => {
                    let id = uuid_field(&value, "id")?;
                    let label = string_field(&value, "label")?;
                    let private_key = value
                        .get("private_key")
                        .or_else(|| value.get("privateKey"))
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| serde::de::Error::missing_field("private_key"))?
                        .to_string();
                    let passphrase = value
                        .get("passphrase")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    let created_at = value
                        .get("created_at")
                        .or_else(|| value.get("createdAt"))
                        .ok_or_else(|| serde::de::Error::missing_field("created_at"))
                        .and_then(|v| {
                            serde_json::from_value(v.clone()).map_err(serde::de::Error::custom)
                        })?;
                    let sync_secret = value
                        .get("sync_secret")
                        .and_then(|v| v.as_bool())
                        .or_else(|| value.get("syncSecret").and_then(|v| v.as_bool()))
                        .unwrap_or(false);
                    Ok(Self::SshKey {
                        id,
                        label,
                        private_key,
                        passphrase,
                        created_at,
                        sync_secret,
                    })
                }
                other => Err(serde::de::Error::unknown_variant(
                    other,
                    &["password", "sshKey"],
                )),
            };
        }
        if value.get("private_key").is_some() || value.get("privateKey").is_some() {
            let record: SshKeyIdentityRecord =
                serde_json::from_value(value).map_err(serde::de::Error::custom)?;
            return Ok(Self::from_ssh_key(record));
        }
        let record: PasswordIdentityRecord =
            serde_json::from_value(value).map_err(serde::de::Error::custom)?;
        Ok(Self::from_password(record))
    }
}

fn uuid_field<E: serde::de::Error>(
    value: &serde_json::Value,
    key: &'static str,
) -> std::result::Result<Uuid, E> {
    let raw = value.get(key).ok_or_else(|| E::missing_field(key))?;
    serde_json::from_value(raw.clone()).map_err(E::custom)
}

fn string_field<E: serde::de::Error>(
    value: &serde_json::Value,
    key: &'static str,
) -> std::result::Result<String, E> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| E::missing_field(key))
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
