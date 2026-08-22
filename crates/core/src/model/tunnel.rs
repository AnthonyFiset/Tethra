//! Port-forward tunnel definitions (persisted on the host; no secrets).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Local (`-L`) or remote (`-R`) TCP forward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TunnelDirection {
    #[default]
    Local,
    Remote,
}

/// Saved tunnel on a host. Vault-synced as host metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TunnelDefinition {
    pub id: Uuid,
    pub label: String,
    #[serde(default)]
    pub direction: TunnelDirection,
    /// Port we listen on (local for `-L`, remote for `-R`).
    pub bind_port: u16,
    /// Target host as seen from the listener's peer side.
    /// For local forwards, `localhost` means the SSH server itself.
    #[serde(default = "default_target_host")]
    pub target_host: String,
    pub target_port: u16,
    /// Start when a session to this host connects.
    #[serde(default)]
    pub auto_start: bool,
    /// Bind `0.0.0.0` instead of `127.0.0.1` (LAN access). Default off.
    #[serde(default)]
    pub allow_lan: bool,
}

fn default_target_host() -> String {
    "localhost".into()
}

impl TunnelDefinition {
    pub fn new_local(bind_port: u16, target_port: u16) -> Self {
        Self {
            id: Uuid::now_v7(),
            label: format!("{bind_port} → localhost:{target_port}"),
            direction: TunnelDirection::Local,
            bind_port,
            target_host: "localhost".into(),
            target_port,
            auto_start: false,
            allow_lan: false,
        }
    }

    pub fn bind_addr(&self) -> &'static str {
        if self.allow_lan {
            "0.0.0.0"
        } else {
            "127.0.0.1"
        }
    }
}
