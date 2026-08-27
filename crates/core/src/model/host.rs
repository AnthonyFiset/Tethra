//! Host records and PTY sizing.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::ShellIntegration;
use crate::model::TunnelDefinition;

/// Saved SSH host. Credentials live in [`super::Identity`], referenced by ID.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Host {
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
    /// OSC 133 / OSC 7 injection preference. Default [`ShellIntegration::Auto`].
    #[serde(default)]
    pub shell_integration: ShellIntegration,
    /// Port-forward definitions (no secrets). Default empty.
    #[serde(default)]
    pub tunnels: Vec<TunnelDefinition>,
    /// Opt-in SSH agent forwarding (`ssh -A`). Default off.
    #[serde(default)]
    pub forward_agent: bool,
    /// Authenticate with the machine's default SSH keys (~/.ssh/id_*) —
    /// for servers that already trust this machine. No secret stored.
    #[serde(default)]
    pub use_default_keys: bool,
    /// Last successful terminal open (UTC). Used for Arrange-by Recent.
    #[serde(default)]
    pub last_connected_at: Option<DateTime<Utc>>,
}

impl Host {
    pub fn new(
        label: impl Into<String>,
        hostname: impl Into<String>,
        username: impl Into<String>,
    ) -> Self {
        Self {
            id: Uuid::now_v7(),
            label: label.into(),
            hostname: hostname.into(),
            port: 22,
            username: username.into(),
            identity_id: None,
            jump_host_id: None,
            folder_id: None,
            known_host_key: None,
            tags: Vec::new(),
            color: None,
            shell_integration: ShellIntegration::Auto,
            tunnels: Vec::new(),
            forward_agent: false,
            use_default_keys: false,
            last_connected_at: None,
        }
    }

    pub fn with_port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    pub fn address(&self) -> (&str, u16) {
        (&self.hostname, self.port)
    }
}

/// Trusted host key recorded after TOFU acceptance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownHostKey {
    pub algorithm: String,
    /// Base64 (unpadded) SHA-256 fingerprint of the public key blob.
    pub fingerprint_sha256: String,
    /// OpenSSH-format public key string (`ssh-ed25519 AAAA...`).
    pub openssh: String,
}

/// Pseudo-terminal dimensions requested from the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtySize {
    pub cols: u32,
    pub rows: u32,
    pub pixel_width: u32,
    pub pixel_height: u32,
}

impl PtySize {
    pub fn new(cols: u32, rows: u32) -> Self {
        Self {
            cols: cols.max(1),
            rows: rows.max(1),
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

impl Default for PtySize {
    fn default() -> Self {
        Self::new(80, 24)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_defaults_port_22() {
        let h = Host::new("lab", "example.com", "alice");
        assert_eq!(h.port, 22);
        assert!(h.known_host_key.is_none());
    }

    #[test]
    fn pty_size_clamps_zero() {
        let s = PtySize::new(0, 0);
        assert_eq!(s.cols, 1);
        assert_eq!(s.rows, 1);
    }
}
