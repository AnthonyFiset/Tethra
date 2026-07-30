//! Identity kinds. Private keys do not sync in v1.

use uuid::Uuid;

use super::auth::SecretBytes;

/// Reference to a secret held outside plaintext model storage.
#[derive(Debug, Clone)]
pub enum SecretRef {
    /// Opaque ID into the platform [`platform::SecretStore`].
    StoreKey(String),
    /// In-memory only — used by the CLI harness and tests. Never persist.
    Ephemeral(SecretBytes),
}

/// How we authenticate to a host.
#[derive(Debug, Clone)]
pub enum Identity {
    Password {
        id: Uuid,
        label: String,
        secret_ref: SecretRef,
    },
    PrivateKey {
        id: Uuid,
        label: String,
        /// Encrypted-at-rest key bytes (vault). For M1 harness, plaintext OpenSSH PEM.
        key: SecretBytes,
        passphrase: Option<SecretRef>,
    },
    HardwareKey {
        id: Uuid,
        label: String,
        key_id: String,
    },
    Agent {
        id: Uuid,
        label: String,
    },
}

impl Identity {
    pub fn id(&self) -> Uuid {
        match self {
            Self::Password { id, .. }
            | Self::PrivateKey { id, .. }
            | Self::HardwareKey { id, .. }
            | Self::Agent { id, .. } => *id,
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::Password { label, .. }
            | Self::PrivateKey { label, .. }
            | Self::HardwareKey { label, .. }
            | Self::Agent { label, .. } => label,
        }
    }
}
