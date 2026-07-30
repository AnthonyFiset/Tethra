//! russh client Handler that enforces host-key policy.

use std::sync::Arc;

use tokio::sync::Mutex;
use uuid::Uuid;

use super::fingerprint::{PresentedHostKey, presented_from_public_key};
use super::session::{HostKeyDecision, HostKeyPolicy};
use crate::Error;
use crate::model::KnownHostKey;

pub(crate) struct ClientHandler {
    pub host_id: Uuid,
    pub known: Option<KnownHostKey>,
    pub policy: Arc<dyn HostKeyPolicy>,
    /// Set when the policy accepts and wants the key remembered.
    pub accepted: Arc<Mutex<Option<KnownHostKey>>>,
}

impl russh::client::Handler for ClientHandler {
    type Error = Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let presented = presented_from_public_key(server_public_key);

        // Strict mismatch: never auto-accept a changed key.
        if let Some(known) = &self.known {
            if known.algorithm == presented.algorithm
                && known.fingerprint_sha256 == presented.fingerprint_sha256
            {
                return Ok(true);
            }
            tracing::warn!(
                host_id = %self.host_id,
                expected = %known.fingerprint_sha256,
                presented = %presented.fingerprint_sha256,
                "host key mismatch — refusing connection"
            );
            return Err(Error::HostKeyMismatch {
                expected_fingerprint: known.fingerprint_sha256.clone(),
                presented_fingerprint: presented.fingerprint_sha256.clone(),
            });
        }

        match self
            .policy
            .decide(self.host_id, &presented, self.known.as_ref())
            .await?
        {
            HostKeyDecision::AcceptAndRemember => {
                let known = presented.to_known();
                *self.accepted.lock().await = Some(known);
                Ok(true)
            }
            HostKeyDecision::AcceptOnce => Ok(true),
            HostKeyDecision::Reject => Err(Error::HostKeyRejected),
        }
    }
}

/// Used by unit tests that need a Handler without networking.
#[allow(dead_code)]
pub(crate) fn compare_keys(known: &KnownHostKey, presented: &PresentedHostKey) -> bool {
    known.algorithm == presented.algorithm
        && known.fingerprint_sha256 == presented.fingerprint_sha256
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_keys_requires_match() {
        let known = KnownHostKey {
            algorithm: "ssh-ed25519".into(),
            fingerprint_sha256: "abc".into(),
            openssh: "ssh-ed25519 AAA".into(),
        };
        let good = PresentedHostKey {
            algorithm: "ssh-ed25519".into(),
            fingerprint_sha256: "abc".into(),
            openssh: "ssh-ed25519 AAA".into(),
        };
        let bad = PresentedHostKey {
            algorithm: "ssh-ed25519".into(),
            fingerprint_sha256: "xyz".into(),
            openssh: "ssh-ed25519 BBB".into(),
        };
        assert!(compare_keys(&known, &good));
        assert!(!compare_keys(&known, &bad));
    }
}
