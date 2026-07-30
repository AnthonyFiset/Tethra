//! Serialisable plaintext payloads stored inside encrypted vault items.
//!
//! These DTOs intentionally avoid [`crate::model::SecretString`] so they can be
//! JSON-encoded before AEAD. Callers must drop plaintext promptly after use.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{Host, KnownHostKey};

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
        }
    }
}

/// Password identity payload. Private-key identities arrive in M4.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordIdentityRecord {
    pub id: Uuid,
    pub label: String,
    pub password: String,
}
