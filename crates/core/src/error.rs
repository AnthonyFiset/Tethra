//! Core error types. `thiserror` only — no `anyhow` in this crate.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("host not found: {0}")]
    HostNotFound(uuid::Uuid),

    #[error(
        "password not available on this device — edit the host and re-enter it \
(enable “Sync password to other devices” if you want it on every machine)"
    )]
    IdentityNotFound(uuid::Uuid),

    #[error("authentication failed")]
    AuthenticationFailed,

    #[error("host key mismatch: refused to connect")]
    HostKeyMismatch {
        expected_fingerprint: String,
        presented_fingerprint: String,
    },

    #[error("host key rejected by policy")]
    HostKeyRejected,

    #[error("action denied by approval gate")]
    ApprovalDenied,

    #[error("SSH protocol error: {0}")]
    Ssh(String),

    #[error("SFTP error: {0}")]
    Sftp(String),

    #[error("SSH config error: {0}")]
    SshConfig(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid private key: {0}")]
    InvalidKey(String),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("session closed")]
    SessionClosed,

    #[error("channel closed")]
    ChannelClosed,

    #[error("transfer cancelled")]
    TransferCancelled,

    #[error("vault is locked")]
    VaultLocked,

    #[error("vault already exists")]
    VaultAlreadyExists,

    #[error("vault does not exist")]
    VaultNotFound,

    #[error("incorrect master password")]
    IncorrectPassword,

    #[error("vault recovery is unavailable")]
    RecoveryUnavailable,

    #[error("cryptographic error: {0}")]
    Crypto(String),

    #[error("database error: {0}")]
    Database(String),

    #[error("platform error: {0}")]
    Platform(String),

    #[error("sync error: {0}")]
    Sync(String),

    #[error("unsupported: {0}")]
    Unsupported(String),

    #[error("{0}")]
    Other(String),
}

impl From<russh::Error> for Error {
    fn from(value: russh::Error) -> Self {
        Self::Ssh(value.to_string())
    }
}

impl From<russh::keys::Error> for Error {
    fn from(value: russh::keys::Error) -> Self {
        Self::InvalidKey(value.to_string())
    }
}

impl From<rusqlite::Error> for Error {
    fn from(value: rusqlite::Error) -> Self {
        Self::Database(value.to_string())
    }
}

impl From<platform::PlatformError> for Error {
    fn from(value: platform::PlatformError) -> Self {
        Self::Platform(value.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(value: serde_json::Error) -> Self {
        Self::Other(value.to_string())
    }
}
