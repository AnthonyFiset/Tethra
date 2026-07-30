//! Shared sync DTOs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::vault::{Argon2Params, EncryptedBlob};

/// Opaque sync cursor. For FileBackend this is a revision counter string.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncCursor(pub String);

impl SyncCursor {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn parse_revision(&self) -> u64 {
        self.0.parse().unwrap_or(0)
    }

    pub fn from_revision(revision: u64) -> Self {
        Self(revision.to_string())
    }
}

/// Row shape every backend stores. Ciphertext only — never plaintext.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncItem {
    pub id: Uuid,
    pub kind: String,
    pub version: u64,
    pub updated_at: DateTime<Utc>,
    pub deleted: bool,
    /// Base64-encoded nonce.
    pub nonce: String,
    /// Base64-encoded ciphertext.
    pub ciphertext: String,
}

/// Shared vault header published into the sync backend.
///
/// Recovery wraps stay device-local (keyring) and are intentionally omitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncedVaultHeader {
    pub salt: Vec<u8>,
    pub argon2: Argon2Params,
    pub wrapped_vault_key: EncryptedBlob,
    pub created_at: DateTime<Utc>,
}

/// Tombstones are retained this many days before optional GC.
pub const TOMBSTONE_RETENTION_DAYS: i64 = 30;
