//! Approval gate seam for agent-initiated commands (no-op in v1).

use async_trait::async_trait;
use uuid::Uuid;

use crate::{Error, Result};

/// Action that must pass the approval gate before execution.
#[derive(Debug, Clone)]
pub enum Action {
    OpenPty {
        host_id: Uuid,
    },
    Exec {
        host_id: Uuid,
        command: String,
    },
    Sftp {
        host_id: Uuid,
    },
    OpenLocalPty {
        program: String,
    },
    LocalExec {
        command: String,
    },
    /// Assist wants to place a command in the shell input (never auto-executes).
    AssistInsert {
        command: String,
    },
}

impl Action {
    pub fn host_id(&self) -> Option<Uuid> {
        match self {
            Self::OpenPty { host_id } | Self::Exec { host_id, .. } | Self::Sftp { host_id } => {
                Some(*host_id)
            }
            Self::OpenLocalPty { .. } | Self::LocalExec { .. } | Self::AssistInsert { .. } => None,
        }
    }
}

/// Hook invoked before PTY / exec / SFTP. No-op in v1; agent layer plugs in later.
#[async_trait]
pub trait ApprovalGate: Send + Sync {
    async fn approve(&self, action: &Action) -> Result<()>;
}

/// Always allows every action.
#[derive(Debug, Default, Clone, Copy)]
pub struct AlwaysApprove;

#[async_trait]
impl ApprovalGate for AlwaysApprove {
    async fn approve(&self, _action: &Action) -> Result<()> {
        Ok(())
    }
}

/// Always denies — useful in unit tests.
#[derive(Debug, Default, Clone, Copy)]
pub struct AlwaysDeny;

#[async_trait]
impl ApprovalGate for AlwaysDeny {
    async fn approve(&self, _action: &Action) -> Result<()> {
        Err(Error::ApprovalDenied)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn always_approve_ok() {
        let gate = AlwaysApprove;
        gate.approve(&Action::Exec {
            host_id: Uuid::nil(),
            command: "true".into(),
        })
        .await
        .expect("approve");
    }

    #[tokio::test]
    async fn always_deny_blocks() {
        let gate = AlwaysDeny;
        let err = gate
            .approve(&Action::OpenPty {
                host_id: Uuid::nil(),
            })
            .await
            .expect_err("deny");
        assert!(matches!(err, Error::ApprovalDenied));
    }
}
